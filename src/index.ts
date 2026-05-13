#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cancel, intro, isCancel, multiselect, outro } from '@clack/prompts';
import { dim, italic } from 'colorette';

import {
  buildSkillPlan,
  getBundledLookupTable,
  getLookupTableWithOptions,
  getSkillsCliArgs,
  scanProjectLibraries,
  validateRootDirectory,
} from './core.js';
import type { InstalledSkill, Scope, SkillPlan } from './core.js';
import { error, info, printBanner, section, success, warn } from './logger.js';
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
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${getUsage()}\n`);
    return;
  }

  if (options.version) {
    process.stdout.write(`${getPackageVersion()}\n`);
    return;
  }

  const useJson = options.json;
  const useQuiet = options.quiet || useJson;

  if (!options.noBanner && !useJson) {
    printBanner();
  }

  const lookup = await getLookupTableWithOptions({
    disableRemoteLookup: options.disableRemoteLookup,
  });

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
  const plan = buildSkillPlan(scan, installedSkills, lookup);

  if (useJson) {
    printPlanJson(plan, options);
  } else {
    printPlan(plan, options.scope);
  }

  if (options.command === 'report') {
    if (!useQuiet) {
      outro('Report complete. No changes applied.');
    }
    return;
  }

  if (options.command === 'auto') {
    await applyChanges({
      rootDirectory: options.rootDirectory,
      scope: options.scope,
      installs: plan.missingSkills.map((skill) => skill.ref),
      removals: options.remove
        ? plan.extraInstalledSkills.map((skill) => skill.name)
        : [],
      quiet: useQuiet,
    });
    if (!useQuiet) {
      outro('Finished applying recommended skill changes.');
    }
    return;
  }

  const installRefs = await askForInstalls(
    plan.missingSkills.map((skill) => skill.ref),
    lookup
  );
  const removalNames = await askForRemovals(
    options.remove ? plan.extraInstalledSkills.map((skill) => skill.name) : []
  );

  await applyChanges({
    rootDirectory: options.rootDirectory,
    scope: options.scope,
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

function formatDeclaredIn(paths: string[]): string {
  if (paths.length === 0) {
    return '';
  }

  return `\n  declared in: ${paths.join(', ')}`;
}

function printPlan(plan: SkillPlan, scope: Scope): void {
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
          (library) => `${library.name}${formatDeclaredIn(library.declaredIn)}`
        )
        .join('\n  ');

      process.stdout.write(
        `- ${skill.name} from ${skill.sourceRepo}\n` +
          `  matches:\n  ${libraryLines}\n` +
          `  reason: ${skill.description}\n`
      );
    }
  }

  section('Missing Skills');
  if (plan.missingSkills.length === 0) {
    success('No missing skills.');
  } else {
    for (const skill of plan.missingSkills) {
      process.stdout.write(`- ${skill.name} from ${skill.sourceRepo}\n`);
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

async function applyChanges(options: {
  rootDirectory: string;
  scope: Scope;
  installs: string[];
  removals: string[];
  quiet: boolean;
}): Promise<void> {
  if (options.installs.length === 0 && options.removals.length === 0) {
    if (!options.quiet) {
      info('Nothing to change.');
    }
    return;
  }

  for (const ref of options.installs) {
    const [sourceRepo, skillName] = ref.split(':');
    if (!options.quiet) {
      info(
        `Installing ${skillName} from ${sourceRepo} using the Vercel Skills CLI (${dim(
          italic('npx skills add')
        )})`
      );
    }
    execFileSync(
      'npx',
      [
        '-y',
        'skills',
        'add',
        sourceRepo,
        '--skill',
        skillName,
        '--yes',
        ...getSkillsCliArgs(options.scope),
      ],
      {
        cwd: options.rootDirectory,
        stdio: 'inherit',
      }
    );
  }

  for (const skillName of options.removals) {
    if (!options.quiet) {
      info(`Removing ${skillName}`);
    }
    execFileSync(
      'npx',
      [
        '-y',
        'skills',
        'remove',
        skillName,
        '--yes',
        ...getSkillsCliArgs(options.scope),
      ],
      {
        cwd: options.rootDirectory,
        stdio: 'inherit',
      }
    );
  }

  if (!options.quiet) {
    success('Skill changes applied.');
  }
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  error(message);
  process.exit(1);
});
