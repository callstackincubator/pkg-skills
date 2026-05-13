import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Argument, Command, CommanderError } from 'commander';
import { bold, cyan, dim, magenta, white } from 'colorette';

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
  dryRun: boolean;
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
  dryRun?: boolean;
  banner?: boolean;
  workspacesOnly?: boolean;
  ignore: string[];
  ignorePath?: string;
  version?: boolean;
};

const COMMAND_CHOICES: CommandName[] = [
  'auto',
  'interactive',
  'report',
  'list-supported',
];

const EXAMPLES_HELP = `
Examples:
  pkg-skills --help                                    # print usage
  pkg-skills --version                                 # print version
  pkg-skills report --cwd /path/to/repo                # scan a repo and print recommendations
  pkg-skills report --json --no-mapping-update         # machine-readable report with bundled mappings
  pkg-skills auto --global                             # apply recommendations to global skills
  pkg-skills auto --no-remove                          # install missing skills without pruning extras
  pkg-skills report --no-mapping-update                # report using bundled mappings only
  pkg-skills report --workspaces-only --cwd /path/to/monorepo  # scan workspace packages only
  pkg-skills list-supported --json                     # list curated mappings as JSON
`;

export function createProgram(): Command {
  return new Command()
    .name('pkg-skills')
    .description(
      'Recommend and manage React Native agent skills from project dependencies.'
    )
    .configureHelp({ sortOptions: true })
    .addArgument(
      new Argument('[command]', 'Command to run')
        .choices(COMMAND_CHOICES)
        .default('interactive')
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
    .option(
      '--dry-run',
      'Show installs and removals without running the Vercel Skills CLI'
    )
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
  const raw = normalizeCommandArgumentHelp(
    `${createProgram().helpInformation()}${EXAMPLES_HELP}`
  );
  return formatHelpText(raw);
}

function normalizeCommandArgumentHelp(text: string): string {
  const choiceLines = COMMAND_CHOICES.map((choice) => `                          ${choice}`).join(
    '\n'
  );

  return text.replace(
    /  command\s+Command to run[^\n]*\n(?:                        .+\n)+/,
    `  command               Command to run (default: interactive)\n                        choices:\n${choiceLines}\n`
  );
}

function formatHelpText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('Usage:')) {
        return bold(magenta(line));
      }

      if (
        line === 'Arguments:' ||
        line === 'Options:' ||
        line === 'Examples:'
      ) {
        return bold(magenta(line));
      }

      if (line.startsWith('  pkg-skills')) {
        return formatExampleLine(line);
      }

      if (line.trim() === 'choices:') {
        return `                        ${helpDescription('choices:')}`;
      }

      const commandChoice = line.match(/^ {26}(\S+)$/);
      if (
        commandChoice &&
        COMMAND_CHOICES.includes(commandChoice[1] as CommandName)
      ) {
        return `                          ${bold(commandChoice[1])}`;
      }

      if (/^  (?:--|-\w)/.test(line) || line.startsWith('  command')) {
        return formatFlagLine(line);
      }

      if (line.trim() === '') {
        return line;
      }

      if (/^ {10,}\S/.test(line)) {
        return helpDescription(line);
      }

      if (!line.startsWith(' ')) {
        return helpDescription(line);
      }

      return helpDescription(line);
    })
    .join('\n');
}

function helpDescription(text: string): string {
  return white(text);
}

function formatFlagLine(line: string): string {
  const match = line.match(/^(\s*)(.+?)\s{2,}(.+)$/);
  if (!match) {
    return helpDescription(line);
  }

  const [, indent, flag, description] = match;
  const flagPadding = ' '.repeat(
    Math.max(2, line.length - indent.length - flag.length - description.length)
  );

  return `${indent}${cyan(flag)}${flagPadding}${helpDescription(description)}`;
}

function formatExampleLine(line: string): string {
  const commentIndex = line.indexOf('#');
  const indent = line.match(/^\s*/)?.[0] ?? '';

  if (commentIndex === -1) {
    return `${indent}${highlightExampleCommand(line.trimStart())}`;
  }

  const commandText = line.slice(indent.length, commentIndex).trimEnd();
  const comment = line.slice(commentIndex);

  return `${indent}${highlightExampleCommand(commandText)}  ${dim(comment)}`;
}

function highlightExampleCommand(command: string): string {
  return command
    .split(/(\s+|--[\w-]+)/g)
    .map((part) => {
      if (part === 'pkg-skills') {
        return bold(white(part));
      }

      if (part.startsWith('--')) {
        return cyan(part);
      }

      return part;
    })
    .join('');
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
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

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
    dryRun: Boolean(flags.dryRun),
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
    command: 'interactive',
    scope: 'project',
    rootDirectory: cwd(),
    help: false,
    version: false,
    remove: true,
    disableRemoteLookup: false,
    json: false,
    quiet: false,
    noBanner: false,
    dryRun: false,
    workspacesOnly: false,
    ignoreGlobs: [],
    ...overrides,
  };
}
