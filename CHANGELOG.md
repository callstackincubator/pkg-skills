# pkg-skills

## 0.3.2

### Patch Changes

- [`819e29a`](https://github.com/callstackincubator/pkg-skills/commit/819e29a5c9e7145230e4ca823688ed12b78af4cc) Thanks [@artus9033](https://github.com/artus9033)! - fix: coloring of '+X others' in source explanations

## 0.3.1

### Patch Changes

- [`001b965`](https://github.com/callstackincubator/pkg-skills/commit/001b9658a098227314b4525642adaa5337ff6d6c) Thanks [@artus9033](https://github.com/artus9033)! - feat: keyboard instructions for interactive mode

- [`f01c4b4`](https://github.com/callstackincubator/pkg-skills/commit/f01c4b43766bea7751411d2a65e35ed75dc0a86c) Thanks [@artus9033](https://github.com/artus9033)! - feat: interactive mode to ask for intended actions first

## 0.3.0

### Minor Changes

- [`9437783`](https://github.com/callstackincubator/pkg-skills/commit/9437783743cb439c589565c5ffc3373c30fa5698) Thanks [@artus9033](https://github.com/artus9033)! - feat: update skills command

### Patch Changes

- [`a35c1c3`](https://github.com/callstackincubator/pkg-skills/commit/a35c1c3e102786f5eec033f2428c0a3812d250fa) Thanks [@artus9033](https://github.com/artus9033)! - feat: support .pkg-skills{ignore,preserve} for white/blacklisting skills

## 0.2.4

### Patch Changes

- [`6c5cc0d`](https://github.com/callstackincubator/pkg-skills/commit/6c5cc0df33417d5bb37a99bca6800d05bf95cd35) Thanks [@artus9033](https://github.com/artus9033)! - feat: add verbose logging flag

- [`cf525e8`](https://github.com/callstackincubator/pkg-skills/commit/cf525e8bc4f45d04d4d9394de7e3b3ab7dd7ce0c) Thanks [@artus9033](https://github.com/artus9033)! - feat: match all skills with libraries

- [`f3afbc5`](https://github.com/callstackincubator/pkg-skills/commit/f3afbc580d2977027d97dcf400c1c0d058514370) Thanks [@artus9033](https://github.com/artus9033)! - fix: skill reference names in lookup-table parsed from SKILL.md instead of based on directory names

- [`eb53b0a`](https://github.com/callstackincubator/pkg-skills/commit/eb53b0ae1e2b70fb7f9cfe174af93260c620b94b) Thanks [@artus9033](https://github.com/artus9033)! - feat: better coloring of output

## 0.2.3

### Patch Changes

- [`1a417d6`](https://github.com/callstackincubator/pkg-skills/commit/1a417d6caca09ad94ae57f7b66e858e6b12b8f33) Thanks [@artus9033](https://github.com/artus9033)! - chore: updated lookup-table

- [`2c1431e`](https://github.com/callstackincubator/pkg-skills/commit/2c1431e4a4c26e35b4cb725290de383d015c8089) Thanks [@artus9033](https://github.com/artus9033)! - fix: do not swallow errors in CLI main

## 0.2.2

### Patch Changes

- [`535ff68`](https://github.com/callstackincubator/pkg-skills/commit/535ff68ccb50ed1443e96806e8f076c39a8a34e4) Thanks [@artus9033](https://github.com/artus9033)! - feat: style help message

- [`cdb0538`](https://github.com/callstackincubator/pkg-skills/commit/cdb0538663ab0873e4120157dd316f85d67997a3) Thanks [@artus9033](https://github.com/artus9033)! - feat: optimized lookup-table fetching with ETag-based caching

## 0.2.1

### Patch Changes

- 69c7fab: fix: add example usage to help, fix bug with help shown twice on --help
- 9d58f42: fix: collapse more than 3 source packages for a skill for better UX in large monorepos
- 5da94f3: feat: more readable output in recommended section, add --dry-run flag, default to interactive

## 0.2.0

### Minor Changes

- e712e33: feat: support monorepos

### Patch Changes

- 0ee1c2b: fix: warn when obtaining lookup-table from GH fails
- c9f96c5: feat: batch skill installs from same repositories

## 0.1.0

### Patch Changes

- Initial release.
