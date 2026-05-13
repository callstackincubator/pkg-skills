import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSkillPlan,
  createTempProject,
  discoverPackageJsonPaths,
  getBundledLookupTable,
  getLookupTableWithOptions,
  removeTempProject,
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
      'react-native-testing',
      'upgrading-react-native',
    ]);
    expect(plan.extraInstalledSkills.map((skill) => skill.name)).toEqual([]);
    expect(plan.ignoredInstalledSkills.map((skill) => skill.name)).toEqual([
      'github',
    ]);
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
      'react-native-brownfield-migration',
    ]);
    expect(plan.ignoredInstalledSkills.map((skill) => skill.name)).toEqual([
      'github',
    ]);
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

describe('getLookupTableWithOptions', () => {
  it('does not attempt a remote fetch when disableRemoteLookup is true', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: unknown[][] = [];

    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;

    try {
      const lookup = await getLookupTableWithOptions({
        disableRemoteLookup: true,
      });
      expect(lookup).toEqual(getBundledLookupTable());
      expect(fetchCalls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
