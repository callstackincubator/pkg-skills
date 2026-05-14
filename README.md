# pkg-skills

[![CI](https://github.com/callstackincubator/pkg-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/callstackincubator/pkg-skills/actions/workflows/ci.yml)
[![Release](https://github.com/callstackincubator/pkg-skills/actions/workflows/release.yml/badge.svg)](https://github.com/callstackincubator/pkg-skills/actions/workflows/release.yml)
[![Update vendored skills](https://github.com/callstackincubator/pkg-skills/actions/workflows/update-vendored-skills.yml/badge.svg)](https://github.com/callstackincubator/pkg-skills/actions/workflows/update-vendored-skills.yml)
[![npm downloads](https://img.shields.io/npm/dm/pkg-skills.svg)](https://www.npmjs.com/package/pkg-skills)

CLI for recommending and managing React Native agent skills from detected project dependencies, with curated mappings for common React Native libraries.

It scans every `package.json` under the target directory, compares discovered libraries against a curated lookup table, and uses the [Vercel `skills` CLI](https://vercel.com/docs/agent-resources/skills) underneath to report, install, or remove relevant skills.

## Features

- 🔍 **Dependency scan** — discovers libraries from every `package.json` under your project root
- 🗺️ **Curated mappings** — links React Native packages to skills from Callstack, Software Mansion, Vercel, and more
- 📋 **Report** — shows recommended, missing, and extra skills without changing anything
- 🙋 **Interactive** — choose action groups (update, install, remove), then pick skills in each
- ⚡ **Auto** — updates, installs, and prunes managed skills in one non-interactive pass
- 🔄 **Update** — refreshes installed managed skills to their latest versions
- 🏢 **Monorepo-ready** — workspace-only scanning, path ignores, and per-package `declared in` details
- ⚙️ **Config files** — `.pkg-skillsignore`, `.pkg-skillspreserve`, and `.pkg-skillsdeter` for fine-grained control
- 🤖 **CI-friendly** — `--json`, `--dry-run`, and `--no-mapping-update` for scripts and pipelines
- 🌐 **Live catalog** — fetches the latest lookup table, with offline fallback

## Installation

Run it without installing permanently:

```bash
npx pkg-skills
```

Or install it globally:

```bash
npm i -g pkg-skills
```

## Commands

```bash
pkg-skills                  # interactive mode (print the report and ask which missing skills to install and which extra skills to remove)
pkg-skills auto             # auto mode (update, install, and remove skills without prompts)
pkg-skills report           # print detected libraries, recommended skills, missing skills, and extra managed pkg skills without changing anything
pkg-skills interactive      # print the report and ask which skills to update, install, and remove
pkg-skills update           # update installed managed pkg skills to their latest versions
pkg-skills list-supported   # print the curated library-to-skill mappings bundled in the lookup table
```

What each command does:

- `pkg-skills`: defaults to `interactive`
- `interactive`: print the report, choose action groups (update, install, remove), then pick skills in each (`↑/↓` navigate, `Space` toggle, `a` toggle all, `i` invert, `Enter` confirm)
- `auto`: update installed recommended skills, install missing skills, and remove extra managed pkg skills without prompts
- `report`: print detected libraries, recommended skills, missing skills, and extra managed pkg skills without changing anything
- `update`: update installed managed pkg skills to their latest versions via the Vercel Skills CLI
- `list-supported`: print the curated library-to-skill mappings bundled in the lookup table

`auto` and `interactive` only remove skills managed by this CLI's lookup table. They do not remove unrelated installed skills.

## Flags

These flags are supported for all commands:

```bash
--cwd <path>          # Scan and operate on a different project root
--global              # Compare against and modify global skills instead of project skills
--no-remove           # Keep extra managed skills installed; only add missing skills
--no-mapping-update   # Use the bundled local lookup table instead of fetching the latest one
--json                # Emit machine-readable JSON (report and list-supported)
--dry-run             # Preview installs and removals without running the Vercel Skills CLI (updates are skipped)
--quiet               # Reduce CLI output; implies --no-banner
--no-banner           # Skip the startup banner
--version, -v         # Print the CLI version
--workspaces-only     # Limit discovery to npm/pnpm workspace packages
--ignore <glob>       # Ignore paths matching a glob (repeatable)
--ignore-path <file>  # Load ignore globs from a file instead of `.pkg-skillsignore`
--help, -h            # Print usage
```

`--dry-run` is useful with `auto` and `interactive` to preview installs and removals without changing installed skills. Skill updates are not run in dry-run mode.

`--no-remove` is useful with `auto` and `interactive` when you want recommendations and installs, but do not want the CLI to prune managed skills that are currently not needed by the detected dependencies.

`--no-mapping-update` forces the CLI to use the packaged `lookup-table.json` instead of trying to fetch the latest version from GitHub. This is useful for offline or firewalled environments, deterministic local testing, and debugging.

`--json` is useful in CI to diff recommendations between branches or gate installs in automation.

Examples:

```bash
pkg-skills --help
pkg-skills --version
pkg-skills report --cwd /path/to/repo
pkg-skills report --json --no-mapping-update
pkg-skills auto --global
pkg-skills auto --no-remove
pkg-skills update --cwd /path/to/repo
pkg-skills report --no-mapping-update
pkg-skills report --workspaces-only --cwd /path/to/monorepo
pkg-skills list-supported --json
```

By default, the CLI attempts to fetch the newest lookup table from GitHub. If that fails, times out, or the downloaded JSON is invalid, it automatically falls back to the bundled local file.

## Typical Usage

Review recommendations and choose what to install:

```bash
pkg-skills
```

Inspect recommendations without making changes:

```bash
pkg-skills report --cwd /path/to/repo
```

Apply everything automatically (for scripts and CI):

```bash
pkg-skills auto
```

Apply missing skills without removing currently installed managed ones:

```bash
pkg-skills auto --no-remove
```

Preview changes without applying them:

```bash
pkg-skills auto --dry-run
```

Use the packaged lookup table only:

```bash
pkg-skills report --no-mapping-update
```

See which libraries and skills are included in the curated mappings:

```bash
pkg-skills list-supported
```

## Configuration files

Place these optional files in the project root passed to `--cwd` (repository root by default):

### `.pkg-skillsignore`

Gitignore-style path globs, one per line. Matching directories are skipped when discovering `package.json` files. Lines starting with `#` are comments. You can also pass `--ignore <glob>` (repeatable) or `--ignore-path <file>` to use a different file.

### `.pkg-skillspreserve`

Skill names, one per line. Listed skills are never removed by `auto` or `interactive`, even when they are managed by pkg-skills but no longer match the detected dependencies. Lines starting with `#` are comments.

### `.pkg-skillsdeter`

Skill names, one per line. Listed skills are never recommended or installed, even when a detected dependency maps to them in the lookup table. Lines starting with `#` are comments.

Example:

```gitignore
# .pkg-skillsignore
experiments/**
apps/legacy/**
```

```text
# .pkg-skillspreserve
github
react-native-brownfield-migration
```

```text
# .pkg-skillsdeter
vercel-react-native-skills
```

## Monorepos

By default, pkg-skills recursively discovers every `package.json` under `--cwd` (except built-in skipped directories such as `node_modules`, `dist`, `ios`, and `android`) and **unions** all dependency names across those manifests. A skill is recommended if any scanned package declares a mapped library.

For large monorepos:

- Use `report` to see **which `package.json` files declared each matched library** (`declared in:` lines in the human report, or `matchedLibraryDetails` / `librarySources` in `--json` output).
- Use `--workspaces-only` to scan only packages listed in the root `package.json` `workspaces` field or `pnpm-workspace.yaml`.
- Use `.pkg-skillsignore` or `--ignore <glob>` to exclude legacy apps, experiments, or tooling packages (see [Configuration files](#configuration-files)).
- Use `report --json` in CI to compare recommendations without parsing formatted CLI output.

Example for a pnpm monorepo:

```bash
pkg-skills report --cwd /path/to/monorepo --workspaces-only
pkg-skills report --cwd /path/to/monorepo --ignore 'experiments/**'
```

## Troubleshooting

- **`does not exist` for `--cwd`**: pass the repository root directory; the path must exist and be readable.
- **`Failed to list installed skills`**: ensure Node.js is available and `npx skills list` can run (network may be required on first use).
- **Unexpected recommendations in a monorepo**: check which package declared the dependency in the report, narrow discovery with `--workspaces-only`, or add ignore globs for unrelated packages.

## Prior Art

This tool uses the [Vercel `skills` CLI](https://vercel.com/docs/agent-resources/skills) under the hood.

This tool uses the following skills repositories:

<!-- START:skill-repositories - do not modify -->

- [Callstack Agent Skills](https://github.com/callstackincubator/agent-skills)
- [Callstack Agent Device Skills](https://github.com/callstackincubator/agent-device)
- [Software Mansion's Skills](https://github.com/software-mansion-labs/skills)
- [React Native Testing Library Skills](https://github.com/callstack/react-native-testing-library)
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)
<!-- END:skill-repositories - do not modify -->

## Special Thanks

Special thanks to the following contributors & testers who helped make this project happen:

- [@krozniata](https://github.com/krozniata)
- [@lech-kalinowski](https://github.com/lech-kalinowski)

---

## Made with ❤️ at Callstack

This CLI is made by Callstack. Excluding ones maintained by Callstack, all other tools, libraries and skills, especially the Vercel `skills` CLI, are not related to Callstack in any way; their maintainers are not related to nor endorse this project.

[Callstack](https://www.callstack.com/) is a group of React and React Native experts. Contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need help with performance optimization or just want to say hi!

Like what we do? [Join the Callstack team](https://www.callstack.com/careers) and work on amazing React Native projects!
