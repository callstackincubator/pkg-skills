import { describe, expect, it } from 'vitest';

import { getUsage, parseArgs } from '../src/parse-args';

describe('parseArgs', () => {
  it('returns help defaults', () => {
    expect(parseArgs(['--help'])).toMatchObject({
      help: true,
      command: 'auto',
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

  it('throws for unknown arguments', () => {
    expect(() => parseArgs(['report', '--unknown'])).toThrow(/unknown option/);
  });

  it('includes new flags in usage text', () => {
    expect(getUsage()).toContain('--json');
    expect(getUsage()).toContain('--workspaces-only');
    expect(getUsage()).toContain('--ignore');
  });
});
