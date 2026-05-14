import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSkillPlan,
  buildSkillsAddCommandArgs,
  buildSkillsRemoveCommandArgs,
  configureLookupTablePathsForTests,
  createTempProject,
  discoverPackageJsonPaths,
  getBundledLookupTable,
  getLookupTableFetchStatus,
  getLookupTableWithOptions,
  groupInstallsBySource,
  persistLookupTableCacheIfNeeded,
  removeTempProject,
  resetRemoteLookupStateForTests,
  resolveWorkspaceRoots,
  scanProjectLibraries,
  shouldIgnorePath,
  validateRootDirectory,
} from '../src/core';

const tempDirectories: string[] = [];

afterEach(async () => {
  while (tempDirectories.length > 0) {
    await removeTempProject(tempDirectories.pop()!);
  }
});

describe('discoverPackageJsonPaths', () => {
  it('finds package.json files across a monorepo', async () => {
    const root = await createTempProject({
      'package.json': {
        private: true,
      },
      'apps/mobile/package.json': {
        dependencies: {
          expo: '^54.0.0',
        },
      },
      'packages/ui/package.json': {
        peerDependencies: {
          'react-native-svg': '^15.0.0',
        },
      },
      'node_modules/ignored/package.json': {
        dependencies: {
          react: '^19.0.0',
        },
      },
    });

    tempDirectories.push(root);

    const packageJsonPaths = await discoverPackageJsonPaths(root);
    expect(packageJsonPaths).toHaveLength(3);
    expect(
      packageJsonPaths.some((entry) => entry.includes('node_modules'))
    ).toBeFalsy();
  });

  it('limits discovery to workspace packages when workspacesOnly is true', async () => {
    const root = await createTempProject({
      'package.json': {
        private: true,
        workspaces: ['packages/*'],
      },
      'packages/mobile/package.json': {
        dependencies: {
          expo: '^54.0.0',
        },
      },
      'packages/ui/package.json': {
        dependencies: {
          react: '^19.0.0',
        },
      },
      'experiments/old-app/package.json': {
        dependencies: {
          'react-native': '0.82.0',
        },
      },
    });

    tempDirectories.push(root);

    const allPaths = await discoverPackageJsonPaths(root);
    const workspacePaths = await discoverPackageJsonPaths(root, {
      workspacesOnly: true,
    });

    expect(allPaths.length).toBeGreaterThan(workspacePaths.length);
    expect(workspacePaths).toHaveLength(2);
    expect(
      workspacePaths.every((entry) => entry.includes('/packages/'))
    ).toBeTruthy();
    expect(
      workspacePaths.some((entry) => entry.includes('experiments'))
    ).toBeFalsy();
  });

  it('reads workspace patterns from pnpm-workspace.yaml', async () => {
    const root = await createTempProject({
      'pnpm-workspace.yaml': `packages:\n  - 'apps/*'\n`,
      'apps/mobile/package.json': {
        dependencies: {
          expo: '^54.0.0',
        },
      },
      'outside/package.json': {
        dependencies: {
          react: '^19.0.0',
        },
      },
    });

    tempDirectories.push(root);

    const workspaceRoots = await resolveWorkspaceRoots(root);
    expect(workspaceRoots).toHaveLength(1);
    expect(workspaceRoots?.[0]).toContain('apps/mobile');

    const packageJsonPaths = await discoverPackageJsonPaths(root, {
      workspacesOnly: true,
    });
    expect(packageJsonPaths).toHaveLength(1);
    expect(packageJsonPaths[0]).toContain('apps/mobile');
  });

  it('skips paths matched by ignore globs and .pkg-skillsignore', async () => {
    const root = await createTempProject({
      '.pkg-skillsignore': 'experiments/**\n',
      'apps/mobile/package.json': {
        dependencies: {
          expo: '^54.0.0',
        },
      },
      'experiments/old-app/package.json': {
        dependencies: {
          'react-native': '0.82.0',
        },
      },
    });

    tempDirectories.push(root);

    const packageJsonPaths = await discoverPackageJsonPaths(root, {
      ignoreGlobs: ['apps/legacy/**'],
    });

    expect(packageJsonPaths).toHaveLength(1);
    expect(packageJsonPaths[0]).toContain('apps/mobile');
  });
});

describe('shouldIgnorePath', () => {
  it('matches simple and recursive ignore patterns', () => {
    expect(shouldIgnorePath('experiments/old-app', ['experiments/**'])).toBe(
      true
    );
    expect(shouldIgnorePath('apps/mobile', ['experiments/**'])).toBe(false);
    expect(shouldIgnorePath('apps/legacy/pkg', ['apps/legacy'])).toBe(true);
  });
});

describe('scanProjectLibraries', () => {
  it('merges dependency names across all dependency sections', async () => {
    const root = await createTempProject({
      'apps/mobile/package.json': {
        dependencies: {
          'react-native': '0.82.0',
          'react-native-reanimated': '^4.0.0',
        },
        devDependencies: {
          '@testing-library/react-native': '^13.0.0',
        },
        peerDependencies: {
          expo: '^54.0.0',
        },
      },
    });

    tempDirectories.push(root);

    const scan = await scanProjectLibraries(root);
    expect(scan.libraries).toEqual([
      '@testing-library/react-native',
      'expo',
      'react-native',
      'react-native-reanimated',
    ]);
  });

  it('records which package.json files declare each library', async () => {
    const root = await createTempProject({
      'apps/mobile/package.json': {
        dependencies: {
          'react-native': '0.82.0',
        },
      },
      'packages/shared/package.json': {
        peerDependencies: {
          'react-native': '0.82.0',
        },
      },
    });

    tempDirectories.push(root);

    const scan = await scanProjectLibraries(root);
    const mobilePath = scan.packageJsonPaths.find((entry) =>
      entry.includes('apps/mobile')
    );
    const sharedPath = scan.packageJsonPaths.find((entry) =>
      entry.includes('packages/shared')
    );

    expect(scan.librarySources['react-native']).toEqual(
      [mobilePath, sharedPath].sort()
    );
  });
});

describe('lookup table mappings', () => {
  it('pairs every catalog skill with at least one library', () => {
    const lookup = getBundledLookupTable();
    const mappedSkillRefs = new Set(
      Object.values(lookup.libraries).flatMap((library) => library.skillRefs)
    );

    for (const [sourceRepo, source] of Object.entries(lookup.sources)) {
      for (const skill of source.skills) {
        expect(
          mappedSkillRefs,
          `${sourceRepo}:${skill.name}`
        ).toContain(`${sourceRepo}:${skill.name}`);
      }
    }
  });
});

describe('buildSkillPlan', () => {
  it('detects missing and extra pkg skills', () => {
    const plan = buildSkillPlan(
      {
        packageJsonPaths: ['/repo/package.json'],
        libraries: [
          '@testing-library/react-native',
          'react-native',
          'react-native-reanimated',
        ],
        librarySources: {
          '@testing-library/react-native': ['/repo/package.json'],
          'react-native': ['/repo/package.json'],
          'react-native-reanimated': ['/repo/package.json'],
        },
      },
      [
        {
          name: 'github',
          path: '/repo/.agents/skills/github',
          scope: 'project',
          agents: ['Cursor'],
        },
        {
          name: 'react-native-best-practices',
          path: '/repo/.agents/skills/react-native-best-practices',
          scope: 'project',
          agents: ['Cursor'],
        },
      ]
    );

    expect(plan.missingSkills.map((skill) => skill.name)).toEqual([
      'agent-device',
      'dogfood',
      'github-actions',
      'radon-mcp',
      'react-native-testing',
      'upgrading-react-native',
      'vercel-composition-patterns',
      'vercel-react-best-practices',
      'vercel-react-view-transitions',
      'web-design-guidelines',
    ]);
    expect(plan.extraInstalledSkills.map((skill) => skill.name)).toEqual([]);
    expect(plan.ignoredInstalledSkills.map((skill) => skill.name)).toEqual([]);
  });

  it('marks managed but unmatched installed skills as extra', () => {
    const plan = buildSkillPlan(
      {
        packageJsonPaths: ['/repo/package.json'],
        libraries: ['@testing-library/react-native'],
        librarySources: {
          '@testing-library/react-native': ['/repo/package.json'],
        },
      },
      [
        {
          name: 'react-native-brownfield-migration',
          path: '/repo/.agents/skills/react-native-brownfield-migration',
          scope: 'project',
          agents: ['Cursor'],
        },
        {
          name: 'github',
          path: '/repo/.agents/skills/github',
          scope: 'project',
          agents: ['Cursor'],
        },
      ]
    );

    expect(plan.missingSkills.map((skill) => skill.name)).toEqual([
      'react-native-testing',
    ]);
    expect(plan.extraInstalledSkills.map((skill) => skill.name)).toEqual([
      'github',
      'react-native-brownfield-migration',
    ]);
    expect(plan.ignoredInstalledSkills.map((skill) => skill.name)).toEqual([]);
  });

  it('includes per-library declaring package.json paths on recommendations', () => {
    const plan = buildSkillPlan(
      {
        packageJsonPaths: [
          '/repo/apps/mobile/package.json',
          '/repo/packages/ui/package.json',
        ],
        libraries: ['react-native', 'react-native-reanimated'],
        librarySources: {
          'react-native': ['/repo/packages/ui/package.json'],
          'react-native-reanimated': ['/repo/apps/mobile/package.json'],
        },
      },
      []
    );

    const reanimatedSkill = plan.recommendedSkills.find(
      (skill) =>
        skill.name === 'react-native-best-practices' &&
        skill.sourceRepo === 'software-mansion-labs/skills'
    );

    expect(reanimatedSkill?.matchedLibraryDetails).toEqual([
      {
        name: 'react-native-reanimated',
        declaredIn: ['/repo/apps/mobile/package.json'],
      },
    ]);

    const upgradingSkill = plan.recommendedSkills.find(
      (skill) => skill.name === 'upgrading-react-native'
    );

    expect(upgradingSkill?.matchedLibraryDetails).toEqual([
      {
        name: 'react-native',
        declaredIn: ['/repo/packages/ui/package.json'],
      },
    ]);
  });
});

describe('validateRootDirectory', () => {
  it('rejects missing directories', async () => {
    await expect(
      validateRootDirectory('/tmp/pkg-skills-missing-directory')
    ).rejects.toThrow('does not exist');
  });

  it('accepts existing directories', async () => {
    const root = await createTempProject({
      'package.json': {
        private: true,
      },
    });
    tempDirectories.push(root);

    await expect(validateRootDirectory(root)).resolves.toBeUndefined();
  });
});

describe('groupInstallsBySource', () => {
  it('groups skill refs by source repository', () => {
    expect(
      groupInstallsBySource([
        'callstackincubator/agent-skills:react-native-best-practices',
        'callstackincubator/agent-skills:upgrading-react-native',
        'callstack/react-native-testing-library:react-native-testing',
        'vercel-labs/agent-skills:vercel-react-native-skills',
      ])
    ).toEqual([
      {
        sourceRepo: 'callstack/react-native-testing-library',
        skillNames: ['react-native-testing'],
      },
      {
        sourceRepo: 'callstackincubator/agent-skills',
        skillNames: ['react-native-best-practices', 'upgrading-react-native'],
      },
      {
        sourceRepo: 'vercel-labs/agent-skills',
        skillNames: ['vercel-react-native-skills'],
      },
    ]);
  });
});

describe('buildSkillsAddCommandArgs', () => {
  it('passes multiple --skill flags in one add invocation', () => {
    expect(
      buildSkillsAddCommandArgs(
        {
          sourceRepo: 'callstackincubator/agent-skills',
          skillNames: [
            'react-native-best-practices',
            'upgrading-react-native',
          ],
        },
        'project'
      )
    ).toEqual([
      '-y',
      'skills',
      'add',
      'callstackincubator/agent-skills',
      '--skill',
      'react-native-best-practices',
      '--skill',
      'upgrading-react-native',
      '--yes',
    ]);
  });
});

describe('buildSkillsRemoveCommandArgs', () => {
  it('removes multiple skills in one invocation', () => {
    expect(
      buildSkillsRemoveCommandArgs(
        ['react-native-brownfield-migration', 'react-native-testing'],
        'global'
      )
    ).toEqual([
      '-y',
      'skills',
      'remove',
      'react-native-brownfield-migration',
      'react-native-testing',
      '--yes',
      '-g',
    ]);
  });
});

describe('getLookupTableWithOptions', () => {
  const lookupCacheDirectories: string[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetRemoteLookupStateForTests();

    while (lookupCacheDirectories.length > 0) {
      await rm(lookupCacheDirectories.pop()!, { recursive: true, force: true });
    }
  });

  async function createInstalledLookup(
    lookupTable = getBundledLookupTable(),
    etag = '"cached-etag"'
  ): Promise<{ tablePath: string; etagPath: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'pkg-skills-lookup-cache-'));
    lookupCacheDirectories.push(directory);
    const tablePath = join(directory, 'lookup-table.json');
    const etagPath = join(directory, 'lookup-table.etag');
    configureLookupTablePathsForTests({ tablePath, etagPath });
    await writeFile(
      tablePath,
      `${JSON.stringify(lookupTable, null, 2)}\n`,
      'utf8'
    );
    await writeFile(etagPath, `${etag}\n`, 'utf8');
    return { tablePath, etagPath };
  }

  it('does not attempt a remote fetch when disableRemoteLookup is true', async () => {
    const fetchCalls: unknown[][] = [];

    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;

    const lookup = await getLookupTableWithOptions({
      disableRemoteLookup: true,
    });
    expect(lookup).toEqual(getBundledLookupTable());
    expect(fetchCalls).toHaveLength(0);
  });

  it('uses installed lookup table when remote responds with 304', async () => {
    const cachedLookup = getBundledLookupTable();
    cachedLookup.catalogVersion = 99;
    await createInstalledLookup(cachedLookup);

    globalThis.fetch = (async (_url, init) => {
      expect(init?.headers).toMatchObject({
        'If-None-Match': '"cached-etag"',
      });

      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;

    const lookup = await getLookupTableWithOptions();
    expect(lookup.catalogVersion).toBe(99);
    expect(getLookupTableFetchStatus()).toBe('up-to-date');
  });

  it('persists an updated lookup table and etag to the install directory after fetch', async () => {
    const { tablePath, etagPath } = await createInstalledLookup();
    const remoteLookup = getBundledLookupTable();
    remoteLookup.catalogVersion = 42;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(remoteLookup), {
        status: 200,
        headers: {
          etag: '"remote-etag"',
        },
      })) as unknown as typeof fetch;

    const lookup = await getLookupTableWithOptions();
    expect(lookup.catalogVersion).toBe(42);
    expect(getLookupTableFetchStatus()).toBe('updated');

    await persistLookupTableCacheIfNeeded();

    const persisted = JSON.parse(await readFile(tablePath, 'utf8')) as {
      catalogVersion: number;
    };
    expect(persisted.catalogVersion).toBe(42);
    expect((await readFile(etagPath, 'utf8')).trim()).toBe('"remote-etag"');
  });
});
