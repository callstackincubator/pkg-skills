import { describe, expect, it } from 'vitest';

import { getUsage, parseArgs } from '../src/parse-args';
import { stripAnsi } from './strip-ansi';

describe('parseArgs', () => {
  it('returns help defaults', () => {
    expect(parseArgs(['--help'])).toMatchObject({
      help: true,
      command: 'interactive',
    });
  });

  it('defaults to interactive when no command is passed', () => {
    expect(parseArgs([])).toMatchObject({
      command: 'interactive',
    });
  });

  it('returns version defaults', () => {
    expect(parseArgs(['--version'])).toMatchObject({
      version: true,
    });
  });

  it('parses report json and discovery flags', () => {
    expect(
      parseArgs([
        'report',
        '--cwd',
        '/repo',
        '--json',
        '--workspaces-only',
        '--ignore',
        'experiments/**',
        '--ignore-path',
        'custom.ignore',
        '--no-mapping-update',
      ])
    ).toEqual({
      command: 'report',
      scope: 'project',
      rootDirectory: '/repo',
      help: false,
      version: false,
      remove: true,
      disableRemoteLookup: true,
      json: true,
      quiet: false,
      noBanner: false,
      dryRun: false,
      workspacesOnly: true,
      ignoreGlobs: ['experiments/**'],
      ignorePath: 'custom.ignore',
    });
  });

  it('enables quiet and no-banner together', () => {
    expect(parseArgs(['report', '--quiet'])).toMatchObject({
      quiet: true,
      noBanner: true,
    });
  });

  it('parses dry-run', () => {
    expect(parseArgs(['auto', '--dry-run'])).toMatchObject({
      command: 'auto',
      dryRun: true,
    });
  });

  it('throws for unknown arguments', () => {
    expect(() => parseArgs(['report', '--unknown'])).toThrow(/unknown option/);
  });

  it('includes new flags in usage text', () => {
    const usage = stripAnsi(getUsage());

    expect(usage).toContain('--json');
    expect(usage).toContain('--dry-run');
    expect(usage).toContain('--workspaces-only');
    expect(usage).toContain('--ignore');
    expect(usage).toContain('Examples:');
    expect(usage).toContain('pkg-skills auto --no-remove');
  });
});
