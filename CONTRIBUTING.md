To refresh the skill catalog metadata used by the lookup table:

```bash
pnpm run sync:lookup
```

Existing entries in the [`lookup-table.json`](src/lookup-table.json) will be kept, new ones will be added with default descriptions as in source repos - they need to be adjusted.
