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

Existing entries in the [`lookup-table.json`](src/lookup-table.json) will be kept, new ones will be added with default descriptions as in source repos - they need to be adjusted.

This is run automatically by the GitHub Actions workflow [`update-vendored-skills.yml`](.github/workflows/update-vendored-skills.yml), every day at 2:19 AM UTC.
