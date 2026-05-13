import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Argument, Command, CommanderError } from 'commander';

import type { Scope } from './core.js';

export type CommandName = 'auto' | 'interactive' | 'report' | 'list-supported';

export type CliOptions = {
  command: CommandName;
  scope: Scope;
  rootDirectory: string;
  help: boolean;
  version: boolean;
  remove: boolean;
  disableRemoteLookup: boolean;
  json: boolean;
  quiet: boolean;
  noBanner: boolean;
  workspacesOnly: boolean;
  ignoreGlobs: string[];
  ignorePath?: string;
};

type ParsedFlags = {
  global?: boolean;
  cwd: string;
  remove?: boolean;
  mappingUpdate?: boolean;
  json?: boolean;
  quiet?: boolean;
  banner?: boolean;
  workspacesOnly?: boolean;
  ignore: string[];
  ignorePath?: string;
  version?: boolean;
};

export function createProgram(): Command {
  return new Command()
    .name('pkg-skills')
    .description(
      'Recommend and manage React Native agent skills from project dependencies.'
    )
    .configureHelp({ sortOptions: true })
    .addArgument(
      new Argument('[command]', 'Command to run')
        .choices(['auto', 'interactive', 'report', 'list-supported'])
        .default('auto')
    )
    .option('--global', 'Compare against and modify global skills')
    .option(
      '--cwd <path>',
      'Scan and operate on a different project root',
      cwd()
    )
    .option(
      '--no-remove',
      'Keep extra managed skills installed; only add missing skills'
    )
    .option(
      '--no-mapping-update',
      'Use the bundled lookup table instead of fetching the latest one'
    )
    .option('--json', 'Emit machine-readable JSON (report and list-supported)')
    .option('--quiet', 'Reduce CLI output')
    .option('--no-banner', 'Skip the startup banner')
    .option(
      '--workspaces-only',
      'Limit discovery to npm or pnpm workspace packages'
    )
    .option(
      '--ignore <glob>',
      'Ignore paths matching a glob (repeatable)',
      collectValues,
      []
    )
    .option(
      '--ignore-path <file>',
      'Load ignore globs from a file instead of `.pkg-skillsignore`'
    )
    .option('-v, --version', 'Print the CLI version');
}

export function getUsage(): string {
  return createProgram().helpInformation();
}

export function getPackageVersion(): string {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json'
  );
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version: string;
  };
  return packageJson.version;
}

export function parseArgs(argv: string[]): CliOptions {
  const program = createProgram();
  program.exitOverride();

  let help = false;

  try {
    program.parse(argv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      throw error;
    }

    if (error.code === 'commander.helpDisplayed') {
      help = true;
    } else {
      throw new Error(error.message);
    }
  }

  const flags = program.opts<ParsedFlags>();

  if (flags.version) {
    return createDefaultOptions({ version: true });
  }

  if (help) {
    return createDefaultOptions({ help: true });
  }

  const command = program.processedArgs[0] as CommandName;

  return {
    command,
    scope: flags.global ? 'global' : 'project',
    rootDirectory: flags.cwd,
    help: false,
    version: false,
    remove: flags.remove !== false,
    disableRemoteLookup: flags.mappingUpdate === false,
    json: Boolean(flags.json),
    quiet: Boolean(flags.quiet),
    noBanner: Boolean(flags.quiet || flags.banner === false),
    workspacesOnly: Boolean(flags.workspacesOnly),
    ignoreGlobs: flags.ignore,
    ignorePath: flags.ignorePath,
  };
}

function collectValues(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

function createDefaultOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    command: 'auto',
    scope: 'project',
    rootDirectory: cwd(),
    help: false,
    version: false,
    remove: true,
    disableRemoteLookup: false,
    json: false,
    quiet: false,
    noBanner: false,
    workspacesOnly: false,
    ignoreGlobs: [],
    ...overrides,
  };
}
