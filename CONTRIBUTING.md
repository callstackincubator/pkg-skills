# Contributing - pkg-skills

## Development

Make your changes and to run the CLI from source, execute:

```bash
pnpm start <args>
```

## Tests

This project uses [Vitest](https://vitest.dev/) for testing. To run the tests, execute:

```bash
pnpm test
```

To run the tests in watch mode, execute:

```bash
pnpm test:watch
```

## Building

To build the CLI, execute:

```bash
pnpm build
```

## Submitting a PR

Before submitting a PR, run the tests and build the CLI to ensure everything is working as expected.

Make sure to commit a changeset using:

```bash
pnpm changeset
```

## Refreshing skill catalog

To refresh the skill catalog metadata used by the lookup table:

```bash
pnpm run sync:lookup
```

This runs [`scripts/sync-lookup.mjs`](scripts/sync-lookup.mjs), which:

1. Fetches skill names and descriptions from each repository listed in `remoteSources` inside that script.
2. Updates [`src/lookup-table.json`](src/lookup-table.json) (`sources`, `lastSyncedAt`). Existing descriptions in the lookup table are preserved when a skill name is unchanged.
3. Regenerates the skills repository list in [`README.md`](README.md) between comment markers.
4. Appends upstream license text to [`LICENSE`](LICENSE) between the same markers, one markdown section per repository.

`sync:lookup` updates `sources` only. When a new skill appears there, add at least one `libraries` entry in [`src/lookup-table.json`](src/lookup-table.json) that references it (`repo:skill-name`). Tests enforce this: every skill in `sources` must appear in some `skillRefs` array.

This is run automatically by the GitHub Actions workflow [`update-vendored-skills.yml`](.github/workflows/update-vendored-skills.yml), every 2 days at 2:19 AM UTC. The workflow opens a PR.

## Runtime lookup table updates

By default, the CLI tries to use the latest [`lookup-table.json`](src/lookup-table.json) from GitHub on each run. This is separate from `pnpm run sync:lookup`, which refreshes skill metadata inside the repo’s source file.

### How it works

1. Read the installed lookup table from the package directory next to the running module:
   - `lookup-table.json`
   - `lookup-table.etag` (saved from the last successful remote response)
2. Request the remote file from `main` with `If-None-Match` when an ETag file is present.
3. If GitHub responds with **304 Not Modified**, keep the installed table and print `Lookup table is up to date.`
4. If GitHub responds with **200**, use the downloaded JSON for the current run.
5. At the end of the run, if a newer table was fetched, overwrite both files in the package install directory.

When running from source, those files live under `src/`. After `pnpm build`, they live under `dist/` in the installed package.

Use `--no-mapping-update` to skip the remote fetch and use only the bundled lookup table from the package.

### Local testing

Vitest tests can point the lookup cache at temporary files with `configureLookupTablePathsForTests()`. That helper only works when `process.env.VITEST === 'true'`.

If the remote fetch fails or times out, the CLI falls back to the installed lookup table, then to the bundled table shipped with the package.
