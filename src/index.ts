#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { cancel, intro, isCancel, multiselect, outro } from '@clack/prompts';
import { dim, gray, italic, white, magenta, red } from 'colorette';

import {
  buildInteractiveActionOptions,
  showInteractiveKeyboardHints,
} from './interactive-hints.js';
import type { InteractiveAction } from './interactive-hints.js';

import {
  buildSkillPlan,
  buildSkillsAddCommandArgs,
  buildSkillsRemoveCommandArgs,
  buildSkillsUpdateCommandArgs,
  getBundledLookupTable,
  getInstalledManagedSkillNames,
  getInstalledRecommendedSkillNames,
  getLookupTableFetchStatus,
  getLookupTableWithOptions,
  getSkillsCliArgs,
  groupInstallsBySource,
  loadDeterredSkillNames,
  loadPreservedSkillNames,
  persistLookupTableCacheIfNeeded,
  scanProjectLibraries,
  validateRootDirectory,
} from './core.js';
import type { InstalledSkill, Scope, SkillPlan } from './core.js';
import {
  error,
  info,
  printBanner,
  section,
  setVerboseLogging,
  success,
  verbose,
  warn,
} from './logger.js';
import { getPackageVersion, getUsage, parseArgs } from './parse-args.js';
import type { CliOptions } from './parse-args.js';

const REPORT_JSON_SCHEMA_VERSION = 1;

async function getInstalledSkills(
  scope: Scope,
  rootDirectory: string
): Promise<InstalledSkill[]> {
  try {
    const output = execFileSync(
      'npx',
      ['-y', 'skills', 'list', '--json', ...getSkillsCliArgs(scope)],
      {
        cwd: rootDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    return JSON.parse(output) as InstalledSkill[];
  } catch (cause) {
    const details =
      cause instanceof Error && 'stderr' in cause
        ? String(
            (cause as NodeJS.ErrnoException & { stderr?: string }).stderr ?? ''
          )
        : '';

    throw new Error(
      [
        'Failed to list installed skills via `npx skills list`.',
        'Ensure Node.js and network access are available so the Vercel Skills CLI can run.',
        details ? `Details: ${details.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

async function main(): Promise<void> {
  let runSucceeded = true;

  try {
    await run();
  } catch (cause) {
    runSucceeded = false;
    throw cause;
  } finally {
    if (runSucceeded) {
      await persistLookupTableCacheIfNeeded();
    }
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    if (!options.noBanner) {
      printBanner();
    }
    process.stdout.write(`${getUsage()}\n`);
    return;
  }

  if (options.version) {
    process.stdout.write(`${getPackageVersion()}\n`);
    return;
  }

  const useJson = options.json;
  const useQuiet = options.quiet || useJson;

  setVerboseLogging(options.verbose && !useQuiet);

  if (!options.noBanner && !useJson) {
    printBanner();
  }

  if (options.disableRemoteLookup) {
    verbose('Skipping remote lookup table fetch (--no-mapping-update)');
  }

  const lookup = await getLookupTableWithOptions({
    disableRemoteLookup: options.disableRemoteLookup,
  });

  const lookupFetchStatus = getLookupTableFetchStatus();
  if (lookupFetchStatus) {
    verbose(`Lookup table resolution: ${lookupFetchStatus}`);
  }
  verbose(
    `Loaded lookup catalogVersion ${lookup.catalogVersion}, lastSyncedAt ${lookup.lastSyncedAt}`
  );

  if (!useQuiet && lookupFetchStatus === 'up-to-date') {
    info('Lookup table is up to date.');
  }

  if (options.command === 'list-supported') {
    if (useJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: REPORT_JSON_SCHEMA_VERSION,
            libraries: Object.entries(lookup.libraries)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([libraryName, library]) => ({
                library: libraryName,
                skills: library.skillRefs.map((skillRef) => {
                  const [sourceRepo, skillName] = skillRef.split(':');
                  const source = lookup.sources[sourceRepo];
                  const skill = source?.skills.find(
                    (candidate) => candidate.name === skillName
                  );

                  return {
                    ref: skillRef,
                    name: skillName,
                    sourceRepo,
                    sourceDisplayName: source?.displayName,
                    description: skill?.description,
                  };
                }),
              })),
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!useQuiet) {
      intro('Listing curated React Native library mappings');
    }
    printSupportedMappings(lookup);
    if (!useQuiet) {
      outro('Listed supported libraries and skills.');
    }
    return;
  }

  await validateRootDirectory(options.rootDirectory);

  if (options.command === 'update') {
    if (!useQuiet) {
      intro(`Updating skills in ${options.rootDirectory}`);
      info(
        'Using the Vercel Skills CLI documented at https://vercel.com/docs/agent-resources/skills'
      );
    }

    const installedSkills = await getInstalledSkills(
      options.scope,
      options.rootDirectory
    );
    const updates = getInstalledManagedSkillNames(installedSkills, lookup);

    if (!useQuiet) {
      if (updates.length === 0) {
        info('No managed pkg skills are installed.');
      } else {
        info(`Updating ${updates.join(', ')}`);
      }
    }

    await applyChanges({
      rootDirectory: options.rootDirectory,
      scope: options.scope,
      updates,
      installs: [],
      removals: [],
      quiet: useQuiet,
    });

    if (!useQuiet) {
      outro(
        updates.length === 0
          ? 'No updates applied.'
          : 'Finished updating installed skills.'
      );
    }
    return;
  }

  if (!useQuiet) {
    intro(`Inspecting ${options.rootDirectory}`);
    info(
      'Using the Vercel Skills CLI documented at https://vercel.com/docs/agent-resources/skills'
    );
  }

  const scan = await scanProjectLibraries(options.rootDirectory, {
    workspacesOnly: options.workspacesOnly,
    ignoreGlobs: options.ignoreGlobs,
    ignorePath: options.ignorePath,
  });
  const installedSkills = await getInstalledSkills(
    options.scope,
    options.rootDirectory
  );
  const [preservedSkillNames, deterredSkillNames] = await Promise.all([
    loadPreservedSkillNames(options.rootDirectory),
    loadDeterredSkillNames(options.rootDirectory),
  ]);
  const plan = buildSkillPlan(scan, installedSkills, lookup, {
    preservedSkillNames: new Set(preservedSkillNames),
    deterredSkillNames: new Set(deterredSkillNames),
  });

  verbose(
    `Discovered ${scan.packageJsonPaths.length} package.json file(s) and ${scan.libraries.length} dependency name(s)`
  );
  verbose(
    `Found ${installedSkills.length} installed ${options.scope} skill(s)`
  );
  verbose(
    `Plan: ${plan.recommendedSkills.length} recommended, ${plan.missingSkills.length} missing, ${plan.extraInstalledSkills.length} extra managed`
  );

  if (useJson) {
    printPlanJson(plan, options);
  } else {
    printPlan(plan, options.scope, options.rootDirectory);
  }

  if (options.command === 'report') {
    if (!useQuiet) {
      outro('Report complete. No changes applied.');
    }
    return;
  }

  if (
    options.command === 'auto' ||
    (options.command === 'interactive' && options.dryRun)
  ) {
    await applyChanges({
      rootDirectory: options.rootDirectory,
      scope: options.scope,
      updates: options.dryRun
        ? []
        : getInstalledRecommendedSkillNames(plan, installedSkills),
      installs: plan.missingSkills.map((skill) => skill.ref),
      removals: options.remove
        ? plan.extraInstalledSkills.map((skill) => skill.name)
        : [],
      quiet: useQuiet,
      dryRun: options.dryRun,
    });
    if (!useQuiet) {
      outro(
        options.dryRun
          ? 'Dry run complete. No changes applied.'
          : 'Finished applying recommended skill changes.'
      );
    }
    return;
  }

  if (options.command === 'interactive' && !useQuiet) {
    showInteractiveKeyboardHints();
  }

  const updatableSkillNames = getInstalledRecommendedSkillNames(
    plan,
    installedSkills
  );
  const installRefsAvailable = plan.missingSkills.map((skill) => skill.ref);
  const removalNamesAvailable = options.remove
    ? plan.extraInstalledSkills.map((skill) => skill.name)
    : [];

  const selectedActions = await askForActionGroups({
    updateCount: updatableSkillNames.length,
    installCount: installRefsAvailable.length,
    removeCount: removalNamesAvailable.length,
    removeEnabled: options.remove,
  });

  const updateNames = selectedActions.includes('update')
    ? await askForUpdates(updatableSkillNames)
    : [];
  const installRefs = selectedActions.includes('install')
    ? await askForInstalls(installRefsAvailable, lookup)
    : [];
  const removalNames = selectedActions.includes('remove')
    ? await askForRemovals(removalNamesAvailable)
    : [];

  await applyChanges({
    rootDirectory: options.rootDirectory,
    scope: options.scope,
    updates: updateNames,
    installs: installRefs,
    removals: removalNames,
    quiet: useQuiet,
  });

  if (!useQuiet) {
    outro('Finished applying selected skill changes.');
  }
}

function printSupportedMappings(
  lookup: Awaited<ReturnType<typeof getLookupTableWithOptions>>
): void {
  const sortedLibraries = Object.entries(lookup.libraries).sort(
    ([left], [right]) => left.localeCompare(right)
  );

  info(
    `The CLI provides the following ${sortedLibraries.length} curated library mappings.`
  );

  for (const [libraryName, library] of sortedLibraries) {
    process.stdout.write(`- ${libraryName}\n`);

    for (const skillRef of library.skillRefs) {
      const [sourceRepo, skillName] = skillRef.split(':');
      const source = lookup.sources[sourceRepo];
      const hint = source
        ? `\t· ${skillName} from ${source.displayName}`
        : skillRef;

      process.stdout.write(`  ${hint}\n`);
    }
  }
}

const MAX_DECLARED_IN_PATHS = 3;

function formatDeclaredIn(paths: string[], rootDirectory: string): string {
  if (paths.length === 0) {
    return '';
  }

  const root = resolve(rootDirectory);
  const relativePaths = paths.map((path) => {
    const relativePath = relative(root, resolve(path));
    return relativePath.startsWith('..') ? path : relativePath;
  });

  const visiblePaths = relativePaths.slice(0, MAX_DECLARED_IN_PATHS);
  const overflowCount = relativePaths.length - visiblePaths.length;
  const overflowSuffix =
    overflowCount > 0
      ? `, ${`+${overflowCount} ${overflowCount === 1 ? 'other' : 'others'}`}`
      : '';

  return `${dim(' declared in:')} ${dim(
    visiblePaths.join(', ')
  )}${overflowSuffix}`;
}

function printPlan(plan: SkillPlan, scope: Scope, rootDirectory: string): void {
  section('Project Scan');
  info(
    `Found ${plan.packageJsonPaths.length} package.json file(s) and ${plan.libraries.length} dependency name(s).`
  );
  info(`Comparing against ${scope} skills installed via \`npx skills\`.`);

  section('Recommended Skills');
  if (plan.recommendedSkills.length === 0) {
    warn('No recommended skills matched the detected libraries.');
  } else {
    for (const skill of plan.recommendedSkills) {
      const libraryLines = skill.matchedLibraryDetails
        .map(
          (library) =>
            `\t${white(library.name)}${formatDeclaredIn(
              library.declaredIn,
              rootDirectory
            )}`
        )
        .join('\n  ');

      process.stdout.write(
        `- ${magenta(skill.name)} ${dim('from')} ${gray(skill.sourceRepo)}\n` +
          `  ${dim('matches:')}\n  ${libraryLines}\n` +
          `  ${dim('reason:')} ${gray(skill.description ?? '')}\n\n`
      );
    }
  }

  section('Missing Skills');
  if (plan.missingSkills.length === 0) {
    success('No missing skills.');
  } else {
    for (const skill of plan.missingSkills) {
      process.stdout.write(`- ${red(skill.name)} from ${skill.sourceRepo}\n`);
    }
  }

  section('Installed But Not Needed');
  if (plan.extraInstalledSkills.length === 0) {
    success('No extra managed pkg skills detected.');
  } else {
    for (const skill of plan.extraInstalledSkills) {
      process.stdout.write(`- ${skill.name}\n`);
    }
  }

  if (plan.ignoredInstalledSkills.length > 0) {
    section('Ignored Installed Skills');
    info(
      `Leaving ${
        plan.ignoredInstalledSkills.length
      } installed skill(s) alone because they are outside the RN lookup table: ${plan.ignoredInstalledSkills
        .map((skill) => skill.name)
        .join(', ')}`
    );
  }
}

function printPlanJson(plan: SkillPlan, options: CliOptions): void {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: REPORT_JSON_SCHEMA_VERSION,
        scope: options.scope,
        rootDirectory: options.rootDirectory,
        workspacesOnly: options.workspacesOnly,
        packageJsonPaths: plan.packageJsonPaths,
        libraries: plan.libraries,
        librarySources: plan.librarySources,
        recommendedSkills: plan.recommendedSkills,
        missingSkills: plan.missingSkills,
        extraInstalledSkills: plan.extraInstalledSkills,
        ignoredInstalledSkills: plan.ignoredInstalledSkills,
      },
      null,
      2
    )}\n`
  );
}

async function askForActionGroups(options: {
  updateCount: number;
  installCount: number;
  removeCount: number;
  removeEnabled: boolean;
}): Promise<InteractiveAction[]> {
  const actionOptions = buildInteractiveActionOptions(options);
  const hasSelectableActions = actionOptions.some((option) => !option.disabled);

  const selection = await multiselect<InteractiveAction>({
    message: 'Which actions should pkg-skills run?',
    withGuide: true,
    required: hasSelectableActions,
    options: actionOptions,
  });

  if (isCancel(selection)) {
    cancel('Interactive action selection cancelled.');
    process.exit(1);
  }

  return selection;
}

async function askForInstalls(
  skillRefs: string[],
  lookup: Awaited<
    ReturnType<typeof getLookupTableWithOptions>
  > = getBundledLookupTable()
): Promise<string[]> {
  if (skillRefs.length === 0) {
    return [];
  }
  const selection = await multiselect<string>({
    message: 'Which missing skills should pkg-skills install?',
    withGuide: true,
    options: skillRefs.map((ref) => {
      const [sourceRepo, skillName] = ref.split(':');
      const source = lookup.sources[sourceRepo];

      return {
        value: ref,
        label: skillName,
        hint: source?.displayName ?? sourceRepo,
        selected: true,
      };
    }),
  });

  if (isCancel(selection)) {
    cancel('Interactive install selection cancelled.');
    process.exit(1);
  }

  return selection;
}

async function askForRemovals(skillNames: string[]): Promise<string[]> {
  if (skillNames.length === 0) {
    return [];
  }

  const selection = await multiselect<string>({
    message: 'Which extra skills should pkg-skills remove?',
    withGuide: true,
    options: skillNames.map((skillName) => ({
      value: skillName,
      label: skillName,
      selected: true,
    })),
  });

  if (isCancel(selection)) {
    cancel('Interactive removal selection cancelled.');
    process.exit(1);
  }

  return selection;
}

async function askForUpdates(skillNames: string[]): Promise<string[]> {
  if (skillNames.length === 0) {
    return [];
  }

  const selection = await multiselect<string>({
    message: 'Which installed skills should pkg-skills update?',
    withGuide: true,
    options: skillNames.map((skillName) => ({
      value: skillName,
      label: skillName,
      selected: true,
    })),
  });

  if (isCancel(selection)) {
    cancel('Interactive update selection cancelled.');
    process.exit(1);
  }

  return selection;
}

async function applyChanges(options: {
  rootDirectory: string;
  scope: Scope;
  updates: string[];
  installs: string[];
  removals: string[];
  quiet: boolean;
  dryRun?: boolean;
}): Promise<void> {
  const dryRun = options.dryRun ?? false;

  if (
    options.updates.length === 0 &&
    options.installs.length === 0 &&
    options.removals.length === 0
  ) {
    if (!options.quiet) {
      info(dryRun ? 'Nothing would change.' : 'Nothing to change.');
    }
    return;
  }

  if (options.updates.length > 0 && !dryRun) {
    if (!options.quiet) {
      info(
        `Updating ${options.updates.join(', ')} using the Vercel Skills CLI (${dim(
          italic('npx skills update')
        )})`
      );
    }

    const updateArgs = buildSkillsUpdateCommandArgs(
      options.updates,
      options.scope
    );
    verbose(`Running npx ${updateArgs.join(' ')}`);
    execFileSync('npx', updateArgs, {
      cwd: options.rootDirectory,
      stdio: 'inherit',
    });
  }

  for (const batch of groupInstallsBySource(options.installs)) {
    if (!options.quiet) {
      info(
        dryRun
          ? `Would install ${batch.skillNames.join(', ')} from ${
              batch.sourceRepo
            } using the Vercel Skills CLI (${dim(italic('npx skills add'))})`
          : `Installing ${batch.skillNames.join(', ')} from ${
              batch.sourceRepo
            } using the Vercel Skills CLI (${dim(italic('npx skills add'))})`
      );
    }
    if (!dryRun) {
      const addArgs = buildSkillsAddCommandArgs(batch, options.scope);
      verbose(`Running npx ${addArgs.join(' ')}`);
      execFileSync('npx', addArgs, {
        cwd: options.rootDirectory,
        stdio: 'inherit',
      });
    }
  }

  if (options.removals.length > 0) {
    if (!options.quiet) {
      info(
        dryRun
          ? `Would remove ${options.removals.join(', ')}`
          : `Removing ${options.removals.join(', ')}`
      );
    }
    if (!dryRun) {
      const removeArgs = buildSkillsRemoveCommandArgs(
        options.removals,
        options.scope
      );
      verbose(`Running npx ${removeArgs.join(' ')}`);
      execFileSync('npx', removeArgs, {
        cwd: options.rootDirectory,
        stdio: 'inherit',
      });
    }
  }

  if (!options.quiet) {
    success(
      dryRun
        ? 'Dry run complete. No changes applied.'
        : 'Skill changes applied.'
    );
  }
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  error(message);
  process.exit(1);
});
