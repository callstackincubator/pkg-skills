import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import packageJson from '../package.json';
import { stripAnsi } from './strip-ansi';

const tempDirectories: string[] = [];
const testRoot = import.meta.dirname;
const fixtureRoot = join(testRoot, 'fixtures');
const templatePath = join(testRoot, 'template', 'fake-npx.cjs');

const cliPath = resolve(testRoot, '..', 'src', 'index.ts');
const cliCwd = dirname(cliPath);

function spawnCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync('tsx', [cliPath, ...args], {
    cwd: options.cwd ?? cliCwd,
    env: { ...process.env, NO_COLOR: '1', ...options.env },
    encoding: 'utf-8',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    exitCode: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

afterEach(async () => {
  while (tempDirectories.length > 0) {
    await rm(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('pkg-skills e2e', () => {
  it('prints usage for --help', () => {
    const processResult = spawnCli(['--help', '--no-mapping-update']);
    const stdout = stripAnsi(processResult.stdout);

    expect(processResult.exitCode).toBe(0);
    expect(stdout).toContain('Usage: pkg-skills');
    expect(stdout.match(/Usage: pkg-skills/g)?.length ?? 0).toBe(1);
    expect(stdout).toContain('Pkg Skills by Callstack');
    expect(stdout).toContain('Examples:');
    expect(stdout).toContain('pkg-skills report --cwd /path/to/repo');
    expect(stdout).toContain('pkg-skills list-supported --json');
  });

  it('lists curated supported libraries and skills', () => {
    const processResult = spawnCli(['list-supported', '--no-mapping-update']);

    const stdout = processResult.stdout;

    expect(processResult.exitCode).toBe(0);
    expect(stdout).toContain('@testing-library/react-native');
    expect(stdout).toContain(
      'react-native-testing from React Native Testing Library Skills'
    );
    expect(stdout).toContain('react-native-reanimated');
  });

  it('adds the expected Callstack, Vercel, and testing skills for expo-app', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'expo-app',
      installedSkills: [],
      expectedAdds: [
        ['callstackincubator/agent-skills', 'react-native-best-practices'],
        ['callstack/react-native-testing-library', 'react-native-testing'],
        ['callstackincubator/agent-skills', 'upgrading-react-native'],
        ['vercel-labs/agent-skills', 'vercel-react-native-skills'],
      ],
      expectedRemovals: [],
      command: ['auto'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('adds the brownfield migration skill for brownfield-app', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'brownfield-app',
      installedSkills: [],
      expectedAdds: [
        [
          'callstackincubator/agent-skills',
          'react-native-brownfield-migration',
        ],
      ],
      expectedRemovals: [],
      command: ['auto'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('adds the Software Mansion skill for reanimated-app', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'reanimated-app',
      installedSkills: [],
      expectedAdds: [
        ['software-mansion-labs/skills', 'react-native-best-practices'],
      ],
      expectedRemovals: [],
      command: ['auto'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('does not remove installed skills that are outside the RN lookup', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'brownfield-app',
      installedSkills: [
        {
          name: 'github',
          path: '/tmp/.agents/skills/github',
          scope: 'project',
          agents: ['Cursor'],
        },
        {
          name: 'validate-skills',
          path: '/tmp/.agents/skills/validate-skills',
          scope: 'project',
          agents: ['Claude Code'],
        },
      ],
      expectedAdds: [
        [
          'callstackincubator/agent-skills',
          'react-native-brownfield-migration',
        ],
      ],
      expectedRemovals: [],
      command: ['auto'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('prints package version for --version', () => {
    const processResult = spawnCli(['--version']);

    expect(processResult.exitCode).toBe(0);
    expect(processResult.stdout.trim()).toBe(packageJson.version);
    expect(processResult.stdout).not.toContain('Pkg Skills by Callstack');
  });

  it('prints machine-readable JSON for report --json', async () => {
    const result = await runReportWithFixture({
      fixtureName: 'expo-app',
      command: ['report', '--json'],
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.schemaVersion).toBe(1);
    expect(
      payload.missingSkills.map((skill: { name: string }) => skill.name)
    ).toContain('vercel-react-native-skills');
    expect(payload.recommendedSkills[0].matchedLibraryDetails).toBeDefined();
    expect(result.stdout).not.toContain('Pkg Skills by Callstack');
  });

  it('suppresses the banner with --no-banner', async () => {
    const result = await runReportWithFixture({
      fixtureName: 'expo-app',
      command: ['report', '--no-banner', '--no-mapping-update'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('Pkg Skills by Callstack');
    expect(result.stdout).toContain('Recommended Skills');
  });

  it('shows declaring package.json paths in report output', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'pkg-skills-e2e-'));
    tempDirectories.push(workspaceRoot);

    const projectDirectory = join(workspaceRoot, 'project');
    const binDirectory = join(workspaceRoot, 'bin');
    const logPath = join(workspaceRoot, 'skills-log.json');

    await mkdir(join(projectDirectory, 'apps/mobile'), { recursive: true });
    await mkdir(join(projectDirectory, 'packages/ui'), { recursive: true });
    await mkdir(binDirectory, { recursive: true });
    await writeFile(
      join(projectDirectory, 'apps/mobile/package.json'),
      JSON.stringify(
        {
          dependencies: {
            'react-native-reanimated': '^4.0.0',
          },
        },
        null,
        2
      ),
      'utf8'
    );
    await writeFile(
      join(projectDirectory, 'packages/ui/package.json'),
      JSON.stringify(
        {
          peerDependencies: {
            'react-native': '0.82.0',
          },
        },
        null,
        2
      ),
      'utf8'
    );
    await writeFile(logPath, '[]\n', 'utf8');

    const fakeNpxPath = join(binDirectory, 'npx');
    const fakeNpxTemplate = await readFile(templatePath, 'utf8');
    await writeFile(
      fakeNpxPath,
      fakeNpxTemplate.replace(
        "'__INSTALLED_SKILLS_JSON__'",
        JSON.stringify(JSON.stringify([]))
      ),
      'utf8'
    );
    await chmod(fakeNpxPath, 0o755);

    const processResult = spawnCli(
      ['report', '--no-mapping-update', '--cwd', projectDirectory],
      {
        env: {
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          RN_SKILLS_E2E_LOG_PATH: logPath,
        },
      }
    );

    expect(processResult.exitCode).toBe(0);
    expect(processResult.stdout).toContain('declared in:');
    expect(processResult.stdout).toContain('apps/mobile/package.json');
    expect(processResult.stdout).toContain('packages/ui/package.json');
  });

  it('truncates long declared-in lists in report output', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'pkg-skills-e2e-'));
    tempDirectories.push(workspaceRoot);

    const projectDirectory = join(workspaceRoot, 'project');
    const binDirectory = join(workspaceRoot, 'bin');
    const logPath = join(workspaceRoot, 'skills-log.json');
    const packagePaths = [
      'apps/a/package.json',
      'apps/b/package.json',
      'apps/c/package.json',
      'apps/d/package.json',
      'apps/e/package.json',
    ];

    await mkdir(binDirectory, { recursive: true });
    for (const packagePath of packagePaths) {
      await mkdir(dirname(join(projectDirectory, packagePath)), {
        recursive: true,
      });
      await writeFile(
        join(projectDirectory, packagePath),
        JSON.stringify(
          {
            dependencies: {
              'react-native-reanimated': '^4.0.0',
            },
          },
          null,
          2
        ),
        'utf8'
      );
    }
    await writeFile(logPath, '[]\n', 'utf8');

    const fakeNpxPath = join(binDirectory, 'npx');
    const fakeNpxTemplate = await readFile(templatePath, 'utf8');
    await writeFile(
      fakeNpxPath,
      fakeNpxTemplate.replace(
        "'__INSTALLED_SKILLS_JSON__'",
        JSON.stringify(JSON.stringify([]))
      ),
      'utf8'
    );
    await chmod(fakeNpxPath, 0o755);

    const processResult = spawnCli(
      ['report', '--no-mapping-update', '--cwd', projectDirectory],
      {
        env: {
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          RN_SKILLS_E2E_LOG_PATH: logPath,
        },
      }
    );

    expect(processResult.exitCode).toBe(0);
    expect(processResult.stdout).toContain('apps/a/package.json');
    expect(processResult.stdout).toContain('apps/b/package.json');
    expect(processResult.stdout).toContain('apps/c/package.json');
    expect(processResult.stdout).not.toContain('apps/d/package.json');
    expect(processResult.stdout).not.toContain('apps/e/package.json');
    expect(processResult.stdout).toContain('+2 others');
  });

  it('fails with a helpful message for an invalid --cwd', () => {
    const processResult = spawnCli([
      'report',
      '--cwd',
      '/tmp/pkg-skills-missing-directory',
      '--no-mapping-update',
    ]);

    expect(processResult.exitCode).toBe(1);
    expect(processResult.stderr).toContain('does not exist');
  });

  it('does not remove extra managed skills when --no-remove is passed', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'expo-app',
      installedSkills: [
        {
          name: 'react-native-brownfield-migration',
          path: '/tmp/.agents/skills/react-native-brownfield-migration',
          scope: 'project',
          agents: ['Cursor'],
        },
      ],
      expectedAdds: [
        ['callstackincubator/agent-skills', 'react-native-best-practices'],
        ['callstack/react-native-testing-library', 'react-native-testing'],
        ['callstackincubator/agent-skills', 'upgrading-react-native'],
        ['vercel-labs/agent-skills', 'vercel-react-native-skills'],
      ],
      expectedRemovals: [],
      command: ['auto', '--no-remove'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('does not invoke the skills CLI during auto --dry-run', async () => {
    const result = await runAutoWithFixture({
      fixtureName: 'brownfield-app',
      installedSkills: [],
      expectedAdds: [],
      expectedRemovals: [],
      command: ['auto', '--dry-run'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Would install');
    expect(result.stdout).toContain('Dry run complete. No changes applied.');
  });
});

async function runAutoWithFixture(options: {
  fixtureName: string;
  installedSkills: Array<{
    name: string;
    path: string;
    scope: string;
    agents: string[];
  }>;
  expectedAdds: Array<[string, string]>;
  expectedRemovals: string[];
  command: string[];
}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'pkg-skills-e2e-'));
  tempDirectories.push(workspaceRoot);

  const fixturePath = join(fixtureRoot, options.fixtureName, 'package.json');
  const projectDirectory = join(workspaceRoot, 'project');
  const binDirectory = join(workspaceRoot, 'bin');
  const logPath = join(workspaceRoot, 'skills-log.json');

  await mkdir(projectDirectory, { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  await writeFile(
    join(projectDirectory, 'package.json'),
    await readFile(fixturePath, 'utf8'),
    'utf8'
  );
  await writeFile(logPath, '[]\n', 'utf8');

  const fakeNpxPath = join(binDirectory, 'npx');
  const fakeNpxTemplate = await readFile(templatePath, 'utf8');
  await writeFile(
    fakeNpxPath,
    fakeNpxTemplate.replace(
      "'__INSTALLED_SKILLS_JSON__'",
      JSON.stringify(JSON.stringify(options.installedSkills))
    ),
    'utf8'
  );
  await chmod(fakeNpxPath, 0o755);

  const processResult = spawnCli(
    [...options.command, '--no-mapping-update', '--cwd', projectDirectory],
    {
      env: {
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        RN_SKILLS_E2E_LOG_PATH: logPath,
      },
    }
  );

  const invocations = JSON.parse(await readFile(logPath, 'utf8')) as string[][];
  const addInvocations = parseSkillsAddInvocations(invocations);
  const removeInvocations = parseSkillsRemoveInvocations(invocations);

  expect(addInvocations).toEqual(
    [...options.expectedAdds].sort((left, right) =>
      left.join(' ').localeCompare(right.join(' '))
    )
  );
  expect(removeInvocations).toEqual(
    [...options.expectedRemovals].sort((left, right) =>
      left.localeCompare(right)
    )
  );

  return processResult;
}

function parseSkillsAddInvocations(
  invocations: string[][]
): Array<[string, string]> {
  const adds: Array<[string, string]> = [];

  for (const args of invocations) {
    if (args[0] !== '-y' || args[1] !== 'skills' || args[2] !== 'add') {
      continue;
    }

    const sourceRepo = args[3];
    for (let index = 4; index < args.length; index += 1) {
      if (args[index] === '--skill' && args[index + 1]) {
        adds.push([sourceRepo, args[index + 1]]);
        index += 1;
      }
    }
  }

  return adds.sort((left, right) =>
    left.join(' ').localeCompare(right.join(' '))
  );
}

function parseSkillsRemoveInvocations(invocations: string[][]): string[] {
  const removals: string[] = [];

  for (const args of invocations) {
    if (args[0] !== '-y' || args[1] !== 'skills' || args[2] !== 'remove') {
      continue;
    }

    for (let index = 3; index < args.length; index += 1) {
      if (args[index].startsWith('-')) {
        break;
      }

      removals.push(args[index]);
    }
  }

  return removals.sort((left, right) => left.localeCompare(right));
}

async function runReportWithFixture(options: {
  fixtureName: string;
  command: string[];
}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'pkg-skills-e2e-'));
  tempDirectories.push(workspaceRoot);

  const fixturePath = join(fixtureRoot, options.fixtureName, 'package.json');
  const projectDirectory = join(workspaceRoot, 'project');
  const binDirectory = join(workspaceRoot, 'bin');
  const logPath = join(workspaceRoot, 'skills-log.json');

  await mkdir(projectDirectory, { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  await writeFile(
    join(projectDirectory, 'package.json'),
    await readFile(fixturePath, 'utf8'),
    'utf8'
  );
  await writeFile(logPath, '[]\n', 'utf8');

  const fakeNpxPath = join(binDirectory, 'npx');
  const fakeNpxTemplate = await readFile(templatePath, 'utf8');
  await writeFile(
    fakeNpxPath,
    fakeNpxTemplate.replace(
      "'__INSTALLED_SKILLS_JSON__'",
      JSON.stringify(JSON.stringify([]))
    ),
    'utf8'
  );
  await chmod(fakeNpxPath, 0o755);

  return spawnCli(
    [...options.command, '--no-mapping-update', '--cwd', projectDirectory],
    {
      env: {
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        RN_SKILLS_E2E_LOG_PATH: logPath,
      },
    }
  );
}
