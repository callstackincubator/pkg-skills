import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NO_COLOR: '1',
    },
  },
});
