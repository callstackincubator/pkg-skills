#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const lookupPath = path.join(packageRoot, 'src', 'lookup-table.json');

const remoteSources = [
  {
    repo: 'callstackincubator/agent-skills',
    displayName: 'Callstack Agent Skills',
  },
  {
    repo: 'software-mansion-labs/skills',
    displayName: 'Software Mansion Skills',
  },
  {
    repo: 'callstack/react-native-testing-library',
    displayName: 'React Native Testing Library Skills',
  },
  {
    repo: 'vercel-labs/agent-skills',
    displayName: 'Vercel Agent Skills',
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
        await fetchRemoteSkills(source.repo)
      ),
    };
  }

  lookup.lastSyncedAt = new Date().toISOString();
  lookup.sources = nextSources;
  await writeFile(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`, 'utf8');

  process.stdout.write(`Synced pkg-skills lookup table: ${lookupPath}\n`);
}

async function fetchRemoteSkills(repo) {
  const directoryResponse = await fetch(
    `https://api.github.com/repos/${repo}/contents/skills`,
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
    const rawSkillUrl = `https://raw.githubusercontent.com/${repo}/main/skills/${directory}/SKILL.md`;
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
      name: directory,
      description: extractDescription(skillMarkdown),
    });
  }

  return skills;
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

function extractDescription(skillMarkdown) {
  const frontmatterMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return '';
  }

  const frontmatterLines = frontmatterMatch[1].split('\n');

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
      return inlineValue;
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

await main();
