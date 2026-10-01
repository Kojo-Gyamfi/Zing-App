import { defineConfig } from 'vitest/config';

// `npm test`: unit tests only. The rules tests (tests/rules) need the
// Firestore emulator and run through `npm run test:rules`; the end-to-end
// tests (tests/e2e) are Playwright's.
export default defineConfig({
  test: {
    exclude: ['node_modules/**', '.next/**', 'tests/**'],
  },
});
