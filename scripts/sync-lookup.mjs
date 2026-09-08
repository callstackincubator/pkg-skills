#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const lookupPath = path.join(packageRoot, 'src', 'lookup-table.json');
const readmePath = path.join(packageRoot, 'README.md');
const licensePath = path.join(packageRoot, 'LICENSE');
const SKILL_REPOSITORIES_START =
  '<!-- START:skill-repositories - do not modify -->';
const SKILL_REPOSITORIES_END =
  '<!-- END:skill-repositories - do not modify -->';
const LICENSE_FILE_CANDIDATES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];

const remoteSources = [
  {
    repo: 'callstackincubator/agent-skills',
    displayName: 'Callstack Agent Skills',
  },
  {
    repo: 'callstackincubator/agent-device',
    displayName: 'Callstack Agent Device Skills',
  },
  {
    repo: 'software-mansion-labs/skills',
    displayName: "Software Mansion's Skills",
  },
  {
    repo: 'callstack/react-native-testing-library',
    displayName: 'React Native Testing Library Skills',
  },
  {
    repo: 'vercel-labs/agent-skills',
    displayName: 'Vercel Agent Skills',
  },
  {
    repo: 'expo/skills',
    displayName: 'Expo Skills',
    skillsPath: 'plugins/expo/skills',
    // expo-dom and expo-web-to-native are migration guides for code that has
    // not adopted React Native yet, so no package.json signals them.
    // expo-app-clip covers a feature almost no app ships, and
    // expo-skill-feedback is a feedback and telemetry channel rather than
    // engineering guidance - both would fire on every Expo project.
    excludedSkills: [
      'expo-app-clip',
      'expo-dom',
      'expo-skill-feedback',
      'expo-web-to-native',
    ],
  },
];

async function main() {
  const lookup = JSON.parse(await readFile(lookupPath, 'utf8'));
  const nextSources = {};

  for (const source of remoteSources) {
    nextSources[source.repo] = {
      repo: source.repo,
      displayName: source.displayName,
      skills: preserveExistingDescriptions(
        lookup,
        source.repo,
        excludeSkills(
          await fetchRemoteSkills(source.repo, source.skillsPath),
          source.excludedSkills
        )
      ),
    };
  }

  lookup.lastSyncedAt = new Date().toISOString();
  lookup.sources = nextSources;
  await writeFile(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`, 'utf8');
  await writeFile(
    readmePath,
    updateReadmeSkillRepositories(
      await readFile(readmePath, 'utf8'),
      remoteSources
    ),
    'utf8'
  );
  await writeFile(
    licensePath,
    replaceMarkedSection(
      await readFile(licensePath, 'utf8'),
      SKILL_REPOSITORIES_START,
      SKILL_REPOSITORIES_END,
      await buildLicenseSkillRepositoriesSection(remoteSources)
    ),
    'utf8'
  );

  process.stdout.write(`Synced pkg-skills lookup table: ${lookupPath}\n`);
  process.stdout.write(`Updated skill repositories in: ${readmePath}\n`);
  process.stdout.write(
    `Updated skill repository licenses in: ${licensePath}\n`
  );
}

async function fetchRemoteSkills(repo, skillsPath = 'skills') {
  const directoryResponse = await fetch(
    `https://api.github.com/repos/${repo}/contents/${skillsPath}`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'pkg-skills-sync',
      },
    }
  );

  if (!directoryResponse.ok) {
    throw new Error(
      `Failed to list skills for ${repo}: ${directoryResponse.status} ${directoryResponse.statusText}`
    );
  }

  const entries = await directoryResponse.json();
  const directories = entries
    .filter((entry) => entry.type === 'dir')
    .map((entry) => entry.name)
    .sort();
  const skills = [];

  for (const directory of directories) {
    const rawSkillUrl = `https://raw.githubusercontent.com/${repo}/main/${skillsPath}/${directory}/SKILL.md`;
    const response = await fetch(rawSkillUrl, {
      headers: {
        'User-Agent': 'pkg-skills-sync',
      },
    });

    if (!response.ok) {
      continue;
    }

    const skillMarkdown = await response.text();
    skills.push({
      name: extractName(skillMarkdown, directory),
      description: extractDescription(skillMarkdown),
    });
  }

  return skills;
}

function excludeSkills(skills, excludedSkills) {
  if (!excludedSkills?.length) {
    return skills;
  }

  return skills.filter((skill) => !excludedSkills.includes(skill.name));
}

function preserveExistingDescriptions(lookup, repo, skills) {
  const existingDescriptionsBySkillName = new Map(
    (lookup.sources?.[repo]?.skills ?? []).map((skill) => [
      skill.name,
      skill.description,
    ])
  );

  return skills.map((skill) => ({
    ...skill,
    description:
      existingDescriptionsBySkillName.get(skill.name) ?? skill.description,
  }));
}

function replaceMarkedSection(contents, startMarker, endMarker, sectionBody) {
  const startIndex = contents.indexOf(startMarker);
  const endIndex = contents.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Could not find markers ${startMarker} / ${endMarker}`);
  }

  const replacement = `${startMarker}\n\n${sectionBody}\n${endMarker}`;

  return (
    contents.slice(0, startIndex) +
    replacement +
    contents.slice(endIndex + endMarker.length)
  );
}

function updateReadmeSkillRepositories(readmeContents, sources) {
  const repositoryLines = sources
    .map(
      (source) => `- [${source.displayName}](https://github.com/${source.repo})`
    )
    .join('\n');

  return replaceMarkedSection(
    readmeContents,
    SKILL_REPOSITORIES_START,
    SKILL_REPOSITORIES_END,
    repositoryLines
  );
}

async function fetchRemoteLicense(repo) {
  for (const filename of LICENSE_FILE_CANDIDATES) {
    const response = await fetch(
      `https://raw.githubusercontent.com/${repo}/main/${filename}`,
      {
        headers: {
          'User-Agent': 'pkg-skills-sync',
        },
      }
    );

    if (response.ok) {
      return (await response.text()).trimEnd();
    }
  }

  return null;
}

async function buildLicenseSkillRepositoriesSection(sources) {
  const sections = [];

  for (const source of sources) {
    const repositoryLink = `https://github.com/${source.repo}`;
    const licenseText = await fetchRemoteLicense(source.repo);
    sections.push(
      licenseText
        ? `## ${source.repo}\n\n${repositoryLink}\n\n${licenseText}`
        : `## ${source.repo}\n\n${repositoryLink}\n\n_No LICENSE file found in the repository root._`
    );
  }

  return sections.join('\n\n');
}

function parseFrontmatter(skillMarkdown) {
  const frontmatterMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  return frontmatterMatch[1].split('\n');
}

function extractName(skillMarkdown, fallback) {
  const frontmatterLines = parseFrontmatter(skillMarkdown);
  if (!frontmatterLines) {
    return fallback;
  }

  for (const line of frontmatterLines) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (!nameMatch) {
      continue;
    }

    const value = nameMatch[1].trim();
    if (value && !['>', '|', '>-', '|-'].includes(value)) {
      return value;
    }
  }

  return fallback;
}

function extractDescription(skillMarkdown) {
  const frontmatterLines = parseFrontmatter(skillMarkdown);
  if (!frontmatterLines) {
    return '';
  }

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    const descriptionMatch = line.match(/^description:\s*(.*)$/);
    if (!descriptionMatch) {
      continue;
    }

    const inlineValue = descriptionMatch[1].trim();
    if (
      inlineValue &&
      inlineValue !== '>' &&
      inlineValue !== '|' &&
      inlineValue !== '>-' &&
      inlineValue !== '|-'
    ) {
      return stripSurroundingQuotes(inlineValue);
    }

    const descriptionLines = [];
    for (
      let nextIndex = index + 1;
      nextIndex < frontmatterLines.length;
      nextIndex += 1
    ) {
      const nextLine = frontmatterLines[nextIndex];
      if (/^\S/.test(nextLine)) {
        break;
      }

      descriptionLines.push(nextLine.replace(/^\s+/, ''));
    }

    return descriptionLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

// YAML requires quoting a scalar that contains ': ', so some descriptions
// arrive wrapped in delimiters that are not part of the text.
function stripSurroundingQuotes(value) {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.length < 2) {
    return value;
  }

  return value.endsWith(quote) ? value.slice(1, -1) : value;
}

await main();
