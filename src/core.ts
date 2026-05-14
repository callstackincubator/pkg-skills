import { Dirent } from 'node:fs';
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import lookupTableJson from './lookup-table.json' with { type: 'json' };
import { warn, verbose } from './logger.js';

export type Scope = 'project' | 'global';

export type LookupSkill = {
  name: string;
  description: string;
};

export type LookupSource = {
  repo: string;
  displayName: string;
  skills: LookupSkill[];
};

export type LookupLibrary = {
  skillRefs: string[];
};

export type LookupTable = {
  catalogVersion: number;
  lastSyncedAt: string;
  sources: Record<string, LookupSource>;
  libraries: Record<string, LookupLibrary>;
};

export type InstalledSkill = {
  name: string;
  path: string;
  scope: string;
  agents: string[];
};

export type MatchedLibrary = {
  name: string;
  declaredIn: string[];
};

export type RecommendedSkill = {
  ref: string;
  sourceRepo: string;
  sourceDisplayName: string;
  name: string;
  description: string;
  matchedLibraries: string[];
  matchedLibraryDetails: MatchedLibrary[];
};

export type ProjectScan = {
  packageJsonPaths: string[];
  libraries: string[];
  librarySources: Record<string, string[]>;
};

export type SkillPlan = {
  packageJsonPaths: string[];
  libraries: string[];
  librarySources: Record<string, string[]>;
  recommendedSkills: RecommendedSkill[];
  missingSkills: RecommendedSkill[];
  extraInstalledSkills: InstalledSkill[];
  ignoredInstalledSkills: InstalledSkill[];
};

export type ScanOptions = {
  workspacesOnly?: boolean;
  ignoreGlobs?: string[];
  ignorePath?: string;
};

type PackageManifest = {
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const lookupTable = lookupTableJson as LookupTable;
const REMOTE_LOOKUP_TABLE_URL =
  'https://raw.githubusercontent.com/callstackincubator/pkg-skills/refs/heads/main/src/lookup-table.json';
const LOOKUP_TABLE_FETCH_TIMEOUT_MS = 1500;
const DEFAULT_IGNORE_FILE = '.pkg-skillsignore';

let remoteLookupTablePromise: Promise<LookupTable> | undefined;
let pendingLookupCache: { etag: string; lookupTable: LookupTable } | undefined;
let lookupFetchStatus: LookupTableFetchStatus | undefined;
let testLookupTablePathOverride: string | undefined;
let testLookupEtagPathOverride: string | undefined;

export type LookupTableFetchStatus = 'up-to-date' | 'updated' | 'bundled' | 'cache';

const lookupTableSchema = z.object({
  catalogVersion: z.number(),
  lastSyncedAt: z.string(),
  sources: z.record(
    z.string(),
    z.object({
      repo: z.string(),
      displayName: z.string(),
      skills: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        })
      ),
    })
  ),
  libraries: z.record(
    z.string(),
    z.object({
      skillRefs: z.array(z.string()),
    })
  ),
});

const IGNORE_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.next',
  '.turbo',
  '.yarn',
  'android',
  'build',
  'coverage',
  'dist',
  'ios',
  'node_modules',
  'Pods',
]);

export async function validateRootDirectory(
  rootDirectory: string
): Promise<void> {
  const absolutePath = resolve(rootDirectory);

  try {
    const stats = await stat(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(
        `The path "${absolutePath}" is not a directory. Pass a project root with --cwd.`
      );
    }
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message.includes('is not a directory')
    ) {
      throw cause;
    }

    throw new Error(
      `The directory "${absolutePath}" does not exist. Pass a valid project root with --cwd.`
    );
  }
}

export async function getLookupTableWithOptions(options?: {
  disableRemoteLookup?: boolean;
}): Promise<LookupTable> {
  if (options?.disableRemoteLookup) {
    return lookupTable;
  }

  if (!remoteLookupTablePromise) {
    remoteLookupTablePromise = fetchRemoteLookupTable();
  }

  return remoteLookupTablePromise;
}

export function getLookupTableFetchStatus():
  | LookupTableFetchStatus
  | undefined {
  return lookupFetchStatus;
}

export async function persistLookupTableCacheIfNeeded(): Promise<void> {
  if (!pendingLookupCache) {
    return;
  }

  const { tablePath, etagPath } = getInstalledLookupPaths();
  verbose(`Writing lookup table to ${tablePath}`);
  verbose(`Writing lookup ETag to ${etagPath}`);
  await mkdir(dirname(tablePath), { recursive: true });
  await writeFile(
    tablePath,
    `${JSON.stringify(pendingLookupCache.lookupTable, null, 2)}\n`,
    'utf8'
  );
  await writeFile(etagPath, `${pendingLookupCache.etag}\n`, 'utf8');
  pendingLookupCache = undefined;
}

export function resetRemoteLookupStateForTests(): void {
  remoteLookupTablePromise = undefined;
  pendingLookupCache = undefined;
  lookupFetchStatus = undefined;
  testLookupTablePathOverride = undefined;
  testLookupEtagPathOverride = undefined;
}

export function configureLookupTablePathsForTests(paths: {
  tablePath: string;
  etagPath: string;
}): void {
  assertTestEnvironment('configureLookupTablePathsForTests');
  testLookupTablePathOverride = paths.tablePath;
  testLookupEtagPathOverride = paths.etagPath;
}

function assertTestEnvironment(apiName: string): void {
  if (process.env.VITEST !== 'true') {
    throw new Error(`${apiName} is only available under Vitest.`);
  }
}

function getInstalledLookupPaths(): {
  tablePath: string;
  etagPath: string;
} {
  const packageDirectory = dirname(fileURLToPath(import.meta.url));

  return {
    tablePath:
      testLookupTablePathOverride ??
      join(packageDirectory, 'lookup-table.json'),
    etagPath:
      testLookupEtagPathOverride ??
      join(packageDirectory, 'lookup-table.etag'),
  };
}

async function readInstalledLookupState(): Promise<{
  lookupTable: LookupTable;
  etag?: string;
}> {
  const { tablePath, etagPath } = getInstalledLookupPaths();
  let etag: string | undefined;

  try {
    etag = (await readFile(etagPath, 'utf8')).trim() || undefined;
  } catch {
    // Optional sidecar ETag file.
  }

  try {
    const payload = lookupTableSchema.safeParse(
      JSON.parse(await readFile(tablePath, 'utf8'))
    );
    if (payload.success) {
      return { lookupTable: payload.data, etag };
    }
  } catch {
    // Fall back to the bundled lookup table.
  }

  return { lookupTable, etag };
}

export function getBundledLookupTable(): LookupTable {
  return lookupTable;
}

export async function loadIgnoreGlobs(
  rootDirectory: string,
  options?: ScanOptions
): Promise<string[]> {
  const globs = [...(options?.ignoreGlobs ?? [])];

  const ignoreFilePath = options?.ignorePath
    ? resolve(rootDirectory, options.ignorePath)
    : join(rootDirectory, DEFAULT_IGNORE_FILE);

  try {
    await access(ignoreFilePath);
    const contents = await readFile(ignoreFilePath, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      globs.push(trimmed);
    }
  } catch {
    // Optional ignore file.
  }

  return globs;
}

export async function resolveWorkspaceRoots(
  rootDirectory: string
): Promise<string[] | undefined> {
  const patterns = await readWorkspacePatterns(rootDirectory);
  if (!patterns || patterns.length === 0) {
    return undefined;
  }

  const roots = new Set<string>();
  for (const pattern of patterns) {
    const matches = await expandWorkspaceGlob(rootDirectory, pattern);
    for (const match of matches) {
      roots.add(match);
    }
  }

  return Array.from(roots).sort();
}

export async function discoverPackageJsonPaths(
  rootDirectory: string,
  options?: ScanOptions
): Promise<string[]> {
  const ignoreGlobs = await loadIgnoreGlobs(rootDirectory, options);
  const workspaceRoots = options?.workspacesOnly
    ? await resolveWorkspaceRoots(rootDirectory)
    : undefined;

  if (options?.workspacesOnly && (!workspaceRoots || workspaceRoots.length === 0)) {
    return [];
  }

  const results: string[] = [];
  const scanRoots = workspaceRoots ?? [rootDirectory];

  for (const scanRoot of scanRoots) {
    await walk(scanRoot);
  }

  return results.sort();

  async function walk(directory: string): Promise<void> {
    const relativeDirectory = relative(rootDirectory, directory) || '.';
    if (shouldIgnorePath(relativeDirectory, ignoreGlobs)) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldSkipEntry(entry)) {
        continue;
      }

      const fullPath = join(directory, entry.name);
      const relativePath = relative(rootDirectory, fullPath);

      if (shouldIgnorePath(relativePath, ignoreGlobs)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'package.json') {
        results.push(fullPath);
      }
    }
  }
}

function shouldSkipEntry(entry: Dirent): boolean {
  if (!entry.isDirectory()) {
    return false;
  }

  return IGNORE_DIRECTORY_NAMES.has(entry.name);
}

export async function scanProjectLibraries(
  rootDirectory: string,
  options?: ScanOptions
): Promise<ProjectScan> {
  const packageJsonPaths = await discoverPackageJsonPaths(
    rootDirectory,
    options
  );
  const libraries = new Set<string>();
  const librarySources: Record<string, string[]> = {};

  for (const packageJsonPath of packageJsonPaths) {
    const manifest = await readJsonFile<PackageManifest>(packageJsonPath);
    for (const dependencyGroup of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ]) {
      if (!dependencyGroup) {
        continue;
      }

      for (const libraryName of Object.keys(dependencyGroup)) {
        libraries.add(libraryName);
        if (!librarySources[libraryName]) {
          librarySources[libraryName] = [];
        }

        if (!librarySources[libraryName].includes(packageJsonPath)) {
          librarySources[libraryName].push(packageJsonPath);
        }
      }
    }
  }

  for (const libraryName of Object.keys(librarySources)) {
    librarySources[libraryName].sort();
  }

  return {
    packageJsonPaths,
    libraries: Array.from(libraries).sort(),
    librarySources,
  };
}

export function buildSkillPlan(
  scan: ProjectScan,
  installedSkills: InstalledSkill[],
  catalog: LookupTable = lookupTable
): SkillPlan {
  const matchedByRef = new Map<string, Set<string>>();

  for (const libraryName of scan.libraries) {
    const lookupEntry = catalog.libraries[libraryName];
    if (!lookupEntry) {
      continue;
    }

    for (const skillRef of lookupEntry.skillRefs) {
      if (!matchedByRef.has(skillRef)) {
        matchedByRef.set(skillRef, new Set());
      }

      matchedByRef.get(skillRef)!.add(libraryName);
    }
  }

  const recommendedSkills = Array.from(matchedByRef.entries())
    .map(([ref, matchedLibraries]) =>
      getRecommendedSkill(
        ref,
        matchedLibraries,
        scan.librarySources ?? {},
        catalog
      )
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.sourceRepo.localeCompare(right.sourceRepo)
    );

  const recommendedNames = new Set(
    recommendedSkills.map((skill) => skill.name)
  );
  const managedSkillNames = new Set(
    Object.values(catalog.libraries)
      .flatMap((library) => library.skillRefs)
      .map((ref) => ref.split(':')[1])
      .filter((name): name is string => Boolean(name))
  );

  const missingSkills = recommendedSkills.filter(
    (skill) =>
      !installedSkills.some((installed) => installed.name === skill.name)
  );
  const extraInstalledSkills = installedSkills
    .filter(
      (installed) =>
        managedSkillNames.has(installed.name) &&
        !recommendedNames.has(installed.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const ignoredInstalledSkills = installedSkills
    .filter((installed) => !managedSkillNames.has(installed.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    packageJsonPaths: scan.packageJsonPaths,
    libraries: scan.libraries,
    librarySources: scan.librarySources,
    recommendedSkills,
    missingSkills,
    extraInstalledSkills,
    ignoredInstalledSkills,
  };
}

export async function createTempProject(
  packageJsonFiles: Record<string, object | string>
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pkg-skills-'));

  for (const [relativePath, contents] of Object.entries(packageJsonFiles)) {
    const absolutePath = join(directory, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    const payload =
      typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`;
    await writeFile(absolutePath, payload, 'utf8');
  }

  return directory;
}

export async function removeTempProject(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

function getRecommendedSkill(
  ref: string,
  matchedLibraries: Set<string>,
  librarySources: Record<string, string[]>,
  catalog: LookupTable
): RecommendedSkill {
  const [sourceRepo, skillName] = ref.split(':');
  if (!sourceRepo || !skillName) {
    throw new Error(`Invalid skill reference: ${ref}`);
  }

  const source = catalog.sources[sourceRepo];
  if (!source) {
    throw new Error(`Unknown source repository in lookup table: ${sourceRepo}`);
  }

  const skill = source.skills.find((candidate) => candidate.name === skillName);
  if (!skill) {
    throw new Error(`Unknown skill "${skillName}" for source "${sourceRepo}"`);
  }

  const matchedLibraryDetails = Array.from(matchedLibraries)
    .sort()
    .map((name) => ({
      name,
      declaredIn: librarySources[name] ?? [],
    }));

  return {
    ref,
    sourceRepo,
    sourceDisplayName: source.displayName,
    name: skill.name,
    description: skill.description,
    matchedLibraries: matchedLibraryDetails.map((entry) => entry.name),
    matchedLibraryDetails,
  };
}

async function readWorkspacePatterns(
  rootDirectory: string
): Promise<string[] | undefined> {
  const pnpmWorkspacePath = join(rootDirectory, 'pnpm-workspace.yaml');
  try {
    const contents = await readFile(pnpmWorkspacePath, 'utf8');
    const patterns = parseYamlPackagesList(contents);
    if (patterns.length > 0) {
      return patterns;
    }
  } catch {
    // Fall through to package.json workspaces.
  }

  const packageJsonPath = join(rootDirectory, 'package.json');
  try {
    const manifest = await readJsonFile<PackageManifest>(packageJsonPath);
    if (Array.isArray(manifest.workspaces)) {
      return manifest.workspaces;
    }

    if (manifest.workspaces?.packages) {
      return manifest.workspaces.packages;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseYamlPackagesList(contents: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line === 'packages:') {
      inPackages = true;
      continue;
    }

    if (!inPackages) {
      continue;
    }

    if (!line.startsWith('- ')) {
      if (patterns.length > 0) {
        break;
      }

      continue;
    }

    const value = line.slice(2).trim().replace(/^['"]|['"]$/g, '');
    if (value) {
      patterns.push(value);
    }
  }

  return patterns;
}

async function expandWorkspaceGlob(
  rootDirectory: string,
  pattern: string
): Promise<string[]> {
  const normalizedPattern = pattern.replace(/\\/g, '/');

  if (!normalizedPattern.includes('*')) {
    return [resolve(rootDirectory, normalizedPattern)];
  }

  const wildcardIndex = normalizedPattern.indexOf('*');
  const baseSegment = normalizedPattern.slice(0, wildcardIndex);
  const baseDirectory = resolve(
    rootDirectory,
    baseSegment.replace(/\/$/, '') || '.'
  );

  try {
    await stat(baseDirectory);
  } catch {
    return [];
  }

  const suffix = normalizedPattern.slice(wildcardIndex);
  const matches: string[] = [];

  if (suffix.startsWith('**')) {
    await collectPackageRoots(baseDirectory, matches);
    return matches;
  }

  if (suffix === '*') {
    const entries = await readdir(baseDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        matches.push(join(baseDirectory, entry.name));
      }
    }

    return matches;
  }

  if (suffix.startsWith('*/')) {
    const remainder = suffix.slice(2);
    const entries = await readdir(baseDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(baseDirectory, entry.name, remainder);
      try {
        const stats = await stat(candidate);
        if (stats.isDirectory()) {
          matches.push(candidate);
        }
      } catch {
        // No match for this entry.
      }
    }

    return matches;
  }

  return [];
}

async function collectPackageRoots(
  directory: string,
  matches: string[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  let hasPackageJson = false;

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'package.json') {
      hasPackageJson = true;
      break;
    }
  }

  if (hasPackageJson) {
    matches.push(directory);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipEntry(entry)) {
      continue;
    }

    await collectPackageRoots(join(directory, entry.name), matches);
  }
}

export function shouldIgnorePath(
  relativePath: string,
  ignoreGlobs: string[]
): boolean {
  if (ignoreGlobs.length === 0) {
    return false;
  }

  const normalizedPath = relativePath.replace(/\\/g, '/');

  return ignoreGlobs.some((pattern) =>
    matchesIgnorePattern(normalizedPath, pattern.replace(/\\/g, '/'))
  );
}

function matchesIgnorePattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/')) {
    pattern = pattern.slice(0, -1);
  }

  if (pattern.includes('**')) {
    const [prefix, suffix] = pattern.split('**');
    const prefixRegex = globFragmentToRegExp(prefix);
    const suffixRegex = globFragmentToRegExp(suffix);
    return new RegExp(`^${prefixRegex}.*${suffixRegex}$`).test(path);
  }

  if (pattern.includes('*')) {
    return new RegExp(`^${globFragmentToRegExp(pattern)}$`).test(path);
  }

  return (
    path === pattern ||
    path.startsWith(`${pattern}/`) ||
    path.endsWith(`/${pattern}`) ||
    path.includes(`/${pattern}/`)
  );
}

function globFragmentToRegExp(fragment: string): string {
  return fragment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export function getSkillsCliArgs(scope: Scope): string[] {
  return scope === 'global' ? ['-g'] : [];
}

export type SourceSkillBatch = {
  sourceRepo: string;
  skillNames: string[];
};

export function groupInstallsBySource(skillRefs: string[]): SourceSkillBatch[] {
  const batches = new Map<string, Set<string>>();

  for (const ref of skillRefs) {
    const [sourceRepo, skillName] = ref.split(':');
    if (!sourceRepo || !skillName) {
      throw new Error(`Invalid skill reference: ${ref}`);
    }

    if (!batches.has(sourceRepo)) {
      batches.set(sourceRepo, new Set());
    }

    batches.get(sourceRepo)!.add(skillName);
  }

  return Array.from(batches.entries())
    .map(([sourceRepo, skillNames]) => ({
      sourceRepo,
      skillNames: Array.from(skillNames).sort(),
    }))
    .sort((left, right) => left.sourceRepo.localeCompare(right.sourceRepo));
}

export function buildSkillsAddCommandArgs(
  batch: SourceSkillBatch,
  scope: Scope
): string[] {
  return [
    '-y',
    'skills',
    'add',
    batch.sourceRepo,
    ...batch.skillNames.flatMap((skillName) => ['--skill', skillName]),
    '--yes',
    ...getSkillsCliArgs(scope),
  ];
}

export function buildSkillsRemoveCommandArgs(
  skillNames: string[],
  scope: Scope
): string[] {
  return [
    '-y',
    'skills',
    'remove',
    ...skillNames,
    '--yes',
    ...getSkillsCliArgs(scope),
  ];
}

async function fetchRemoteLookupTable(): Promise<LookupTable> {
  const installed = await readInstalledLookupState();
  const { tablePath, etagPath } = getInstalledLookupPaths();
  const headers: Record<string, string> = {};

  verbose(`Using lookup table at ${tablePath}`);
  verbose(
    installed.etag
      ? `Loaded ETag ${installed.etag} from ${etagPath}`
      : `No ETag file at ${etagPath}`
  );

  if (installed.etag) {
    headers['If-None-Match'] = installed.etag;
  }

  try {
    verbose(
      `Fetching ${REMOTE_LOOKUP_TABLE_URL}${
        installed.etag ? ` with If-None-Match: ${installed.etag}` : ''
      }`
    );
    const response = await fetch(REMOTE_LOOKUP_TABLE_URL, {
      signal: AbortSignal.timeout(LOOKUP_TABLE_FETCH_TIMEOUT_MS),
      headers,
    });

    if (response.status === 304) {
      verbose('Remote lookup table is unchanged (HTTP 304)');
      lookupFetchStatus = 'up-to-date';
      return installed.lookupTable;
    }

    if (!response.ok) {
      verbose(
        `Remote lookup fetch failed with HTTP ${response.status} ${response.statusText}`
      );
      warn(
        `Failed to fetch remote lookup table: ${response.status} ${response.statusText}. Using installed lookup table instead.`
      );
      lookupFetchStatus = 'cache';
      return installed.lookupTable;
    }

    const payload = lookupTableSchema.safeParse(await response.json());
    if (!payload.success) {
      warn(
        `Failed to parse remote lookup table: ${payload.error.message}. Using installed lookup table instead.`
      );
      lookupFetchStatus = 'cache';
      return installed.lookupTable;
    }

    const etag = response.headers.get('etag');
    if (etag) {
      pendingLookupCache = {
        etag,
        lookupTable: payload.data,
      };
      verbose(
        `Fetched updated lookup table (catalogVersion ${payload.data.catalogVersion}, ETag ${etag})`
      );
    } else {
      verbose(
        `Fetched updated lookup table (catalogVersion ${payload.data.catalogVersion}) without an ETag response header`
      );
    }

    lookupFetchStatus = 'updated';
    return payload.data;
  } catch (error) {
    verbose(`Remote lookup fetch failed: ${error}`);
    warn(
      `Failed to obtain remote lookup table: ${error}. Using installed lookup table instead.`
    );
    lookupFetchStatus = 'cache';
    return installed.lookupTable;
  }
}
