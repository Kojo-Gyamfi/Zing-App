import { defineConfig } from 'vitest/config';

// Firestore security rules, against the emulator. Run via `npm run test:rules`,
// which starts the emulator around this.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    // One emulator, shared state: files must not run against it in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
