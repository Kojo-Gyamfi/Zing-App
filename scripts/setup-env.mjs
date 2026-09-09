#!/usr/bin/env node
/**
 * Generates .env.local from the two things Firebase hands you: the web app
 * config block and the service account JSON file.
 *
 * The tedious parts this removes: retyping six values by hand, flattening the
 * service account JSON onto one line, and noticing that the Realtime Database
 * URL format changes with the region.
 *
 * Run:  npm run setup
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = '.env.local';

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const teal = (text) => `\x1b[36m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });

/**
 * One line stream for the whole script.
 *
 * Repeated rl.question() calls drop lines when stdin is a pipe rather than a
 * terminal, and never settle once it closes. Pulling from a single async
 * iterator behaves identically either way, so the script stays testable.
 */
const lines = rl[Symbol.asyncIterator]();

/** Returns null at end of input rather than hanging forever. */
async function ask(prompt = '') {
  if (prompt) stdout.write(prompt);
  const { value, done } = await lines.next();
  return done ? null : value;
}

function abort(message) {
  console.log(red(`\n${message}\n`));
  rl.close();
  process.exit(1);
}

/** Windows paths get pasted with quotes and stray whitespace remarkably often. */
function cleanPath(input) {
  return input.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
}

/**
 * Pulls key/value pairs out of whatever the console gave you -- the JS object
 * literal from the npm tab, or the quoted-key JSON from the Config tab. Both
 * reduce to the same `key: "value"` shape.
 */
function parseConfig(text) {
  const found = {};
  const pattern = /["']?([A-Za-z]+)["']?\s*:\s*["']([^"']+)["']/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    found[match[1]] = match[2];
  }
  return found;
}

async function readBlock(prompt) {
  console.log(prompt);
  console.log(dim('  (paste it, then press Enter on an empty line)\n'));

  const collected = [];
  for (;;) {
    const line = await ask();
    if (line === null) break;
    if (line.trim() === '' && collected.length > 0) break;
    if (line.trim() !== '') collected.push(line);
  }
  return collected.join('\n');
}

console.log(`\n${bold(teal('Zing'))} — environment setup\n`);
console.log(dim('Everything comes from your Firebase project. Nothing is sent anywhere;'));
console.log(dim(`this only writes ${OUT} on your machine.\n`));

if (existsSync(OUT)) {
  const answer = await ask(yellow(`${OUT} already exists. Overwrite it? (y/N) `));
  if (answer === null || answer.trim().toLowerCase() !== 'y') {
    console.log('\nLeft it alone. Nothing written.\n');
    rl.close();
    process.exit(0);
  }
  console.log('');
}

/* ---- 1. web app config ---- */

console.log(bold('1. Web app config'));
console.log(dim('   Firebase Console -> Project settings -> General -> Your apps -> SDK setup'));

const config = parseConfig(await readBlock(dim('\n   Paste the whole firebaseConfig block:')));

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
const missing = REQUIRED.filter((key) => !config[key]);

if (missing.length > 0) {
  abort(
    `Could not find: ${missing.join(', ')}\n` +
      'Make sure you pasted the whole block, including the braces.',
  );
}

console.log(teal(`\n  Read config for project "${config.projectId}"\n`));

/* ---- 2. realtime database ---- */

let databaseURL = config.databaseURL;

console.log(bold('2. Realtime Database URL'));

if (databaseURL) {
  console.log(teal('   Found in the config block\n'));
} else {
  // Absent from the config block whenever the Realtime Database was created
  // after the web app was registered, which is the usual order.
  console.log(dim('   Firebase Console -> Build -> Realtime Database (shown at the top)\n'));
  databaseURL = (await ask('   URL: '))?.trim() ?? '';
}

if (databaseURL && !/europe-west1/.test(databaseURL)) {
  console.log(yellow('\n   Note: that URL is not in europe-west1.'));
  console.log(dim('   Fine if deliberate, but the region cannot be changed later, and from'));
  console.log(dim('   Ghana europe-west1 saves roughly 100ms on every message.\n'));
}

/* ---- 3. vapid key ---- */

console.log(bold('\n3. Web Push key'));
console.log(dim('   Project settings -> Cloud Messaging -> Web Push certificates\n'));
const vapidKey = (await ask('   Key pair (blank to skip push for now): '))?.trim() ?? '';

/* ---- 4. service account ---- */

console.log(bold('\n4. Service account JSON'));
console.log(dim('   Project settings -> Service accounts -> Generate new private key'));
console.log(dim('   Drag the downloaded file into this terminal to paste its path.\n'));

let serviceAccount = '';
for (;;) {
  const answer = await ask('   Path (blank to skip push for now): ');
  if (answer === null || answer.trim() === '') break;

  const path = resolve(cleanPath(answer));
  if (!existsSync(path) || !statSync(path).isFile()) {
    console.log(red(`   No file at ${path}\n`));
    continue;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));

    if (parsed.type !== 'service_account' || !parsed.private_key) {
      console.log(red('   That JSON is not a service account key.\n'));
      continue;
    }
    if (parsed.project_id !== config.projectId) {
      console.log(
        yellow(`   Careful: that key is for "${parsed.project_id}", not "${config.projectId}".\n`),
      );
    }

    // Flattened to one line: dotenv cannot carry the raw multi-line PEM.
    serviceAccount = JSON.stringify(parsed);
    console.log(teal(`   Read key for ${parsed.client_email}\n`));
    break;
  } catch {
    console.log(red('   Could not parse that file as JSON.\n'));
  }
}

/* ---- write ---- */

const contents = `# Written by npm run setup. Not committed -- .gitignore covers .env*

# Public by design: these identify the project and authorize nothing.
# Security rules do the authorizing, and message bodies are encrypted anyway.
NEXT_PUBLIC_FIREBASE_API_KEY=${config.apiKey}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${config.authDomain}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${config.projectId}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${config.storageBucket ?? ''}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${config.messagingSenderId}
NEXT_PUBLIC_FIREBASE_APP_ID=${config.appId}

# Typing indicators and online status only.
NEXT_PUBLIC_FIREBASE_DATABASE_URL=${databaseURL ?? ''}

# Web Push certificate.
NEXT_PUBLIC_FIREBASE_VAPID_KEY=${vapidKey}

# ---- Server only. Never prefix this with NEXT_PUBLIC_. ----
FIREBASE_SERVICE_ACCOUNT=${serviceAccount ? `'${serviceAccount}'` : ''}
`;

writeFileSync(OUT, contents, 'utf8');

console.log(bold(teal(`\nWrote ${OUT}\n`)));

const skipped = [];
if (!vapidKey) skipped.push('VAPID key');
if (!serviceAccount) skipped.push('service account');
if (!databaseURL) skipped.push('Realtime Database URL');

if (skipped.length > 0) {
  console.log(yellow(`Skipped: ${skipped.join(', ')}.`));
  console.log(dim('The app runs without these; push notifications will not.\n'));
}

console.log('Next:');
console.log(
  `  ${teal('firebase deploy --only firestore,database')}   ${dim('<- required, or Firestore denies everything')}`,
);
console.log(`  ${teal('npm run dev')}\n`);

if (serviceAccount) {
  console.log(yellow('Now delete the downloaded service account file. It is admin access'));
  console.log(yellow('to your whole project and does not belong in Downloads.\n'));
}

rl.close();
