# Changesets

Create a changeset when your PR includes user-facing work worth a release note:

```sh
pnpm changeset
```

Commit the generated file under `.changeset/` with your PR.

When you are ready to cut a release, run on `main`:

```sh
pnpm changeset version
```

This updates `package.json`, `CHANGELOG.md`, and removes consumed changesets. Commit those edits, then tag and push:

```sh
git tag v$(node -p "require('./package.json').version")
git push origin main --tags
```

Pushing a `v*.*.*` tag triggers the Release workflow, which publishes to npm and opens a GitHub release.
