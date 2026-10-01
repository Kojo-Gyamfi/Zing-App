import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the real app in a real browser, against the Firebase
 * Emulator Suite (auth, Firestore, RTDB) -- never the real project.
 *
 *   npm run test:e2e
 *
 * Needs Java for the emulators. Starts both servers itself; a separate dev
 * server on :3100 with its own build dir, so `npm run dev` can keep running.
 */

const PORT = 3100;
const PROJECT = 'demo-zing';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: `npx firebase emulators:start --only auth,firestore,database --project ${PROJECT}`,
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: `npx next dev --port ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_USE_EMULATORS: '1',
        NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`,
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '0',
        NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:0',
        NEXT_PUBLIC_FIREBASE_DATABASE_URL: `https://${PROJECT}-default-rtdb.firebaseio.com`,
        NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
        NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '',
        NEXT_PUBLIC_SENTRY_DSN: '',
      },
    },
  ],
});
