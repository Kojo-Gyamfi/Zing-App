/**
 * The core loop, end to end, in two browsers against the emulators:
 * sign up, find each other, send, reply, edit, delete, and get history back
 * on a "new device" with the passphrase and then with the recovery key.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSPHRASE = 'correct horse battery staple';

/** Unique per run, so a reused emulator never sees a taken handle. */
const run = Date.now().toString(36).slice(-5);

async function newPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Surface the app's own errors in the test output.
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
  return page;
}

/**
 * Sign in through the Auth emulator's stand-in for Google.
 */
async function signInWithGoogle(page: Page, handle: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  const popupOpened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  // The emulator's account picker. Its handlers attach on load, so a click
  // before then does nothing: retry until the new-account form shows.
  const popup = await popupOpened;
  await popup.waitForLoadState('load');
  await expect(async () => {
    await popup.locator('#add-account-button').click();
    await expect(popup.locator('#email-input')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await popup.locator('#email-input').fill(`${handle}@example.com`);
  await popup.locator('#display-name-input').fill(handle);
  await popup.locator('#sign-in').click();
}

/**
 * Ask for an email sign-in link and return it. The Auth emulator sends no
 * mail; it lists the links it would have sent.
 */
async function requestEmailLink(page: Page, email: string): Promise<string> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const response = await page.request.get(
    'http://127.0.0.1:9099/emulator/v1/projects/demo-zing/oobCodes',
  );
  const { oobCodes } = (await response.json()) as {
    oobCodes: { email: string; requestType: string; oobLink: string }[];
  };
  const oobLink = oobCodes
    .filter((code) => code.email === email && code.requestType === 'EMAIL_SIGNIN')
    .at(-1)?.oobLink;
  expect(oobLink).toBeTruthy();

  // What a real email's link resolves to: our finish page, with Firebase's
  // one-time code appended.
  const emulated = new URL(oobLink!).searchParams;
  const link = new URL(emulated.get('continueUrl')!);
  for (const key of ['mode', 'oobCode', 'apiKey']) link.searchParams.set(key, emulated.get(key)!);
  return link.toString();
}

/** Onboard a freshly signed-in account. Returns the recovery key shown at the end. */
async function onboard(page: Page, handle: string): Promise<string> {
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Username').fill(handle);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('textbox', { name: 'Passphrase', exact: true }).fill(PASSPHRASE);
  await page.getByRole('textbox', { name: 'Type it again' }).fill(PASSPHRASE);
  await page.getByLabel('I have written this down somewhere safe.').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  // Argon2id runs twice here (passphrase and recovery key): give it time.
  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible({
    timeout: 60_000,
  });
  const groups = await page.locator('.font-mono > span').allTextContents();
  expect(groups).toHaveLength(6);

  await page.getByLabel(/saved my recovery key/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/chats$/);

  // First launch shows "Add to home screen" and "Turn on notifications".
  for (const banner of await page.getByRole('button', { name: 'Not now' }).all()) {
    await banner.click();
  }
  return groups.join('-');
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder('Message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function openMenu(page: Page, text: string) {
  // The bubble's own contextmenu handler -- what a right-click or a
  // long-press ends up calling.
  await page.getByRole('main').getByText(text, { exact: true }).dispatchEvent('contextmenu');
}

/** Wipe this "phone": the key, the cache, everything but the account. */
async function wipeDevice(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('zing');
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }),
  );
  await page.reload();
}

test('two people chat end to end, and history survives a new device', async ({ browser }) => {
  const alice = await newPhone(browser);
  const bob = await newPhone(browser);
  const aliceHandle = `alice_${run}`;
  const bobHandle = `bob_${run}`;

  await signInWithGoogle(alice, aliceHandle);
  const aliceRecoveryKey = await onboard(alice, aliceHandle);
  await signInWithGoogle(bob, bobHandle);
  await onboard(bob, bobHandle);

  // Alice finds Bob by @username and opens a chat.
  await alice.getByRole('link', { name: 'New chat' }).click();
  await alice.getByLabel('Find someone').fill(`@${bobHandle}`);
  await alice.getByRole('button', { name: 'Find' }).click();
  await alice.getByRole('button', { name: 'Chat' }).click();
  await expect(alice).toHaveURL(/\/chats\/.+_.+/);

  // Send: Bob receives it decrypted, with an unread badge on his list.
  await send(alice, 'hello bob');
  await expect(bob.getByLabel('1 unread')).toBeVisible();
  await bob.locator('li').getByText(aliceHandle).click();
  await expect(bob.getByRole('main').getByText('hello bob')).toBeVisible();

  // Reply.
  await openMenu(bob, 'hello bob');
  await bob.getByRole('button', { name: 'Reply' }).click();
  await send(bob, 'hi alice');
  await expect(alice.getByRole('main').getByText('hi alice')).toBeVisible();

  // Edit.
  await send(alice, 'see you at 5');
  await expect(bob.getByRole('main').getByText('see you at 5')).toBeVisible();
  await openMenu(alice, 'see you at 5');
  await alice.getByRole('button', { name: 'Edit' }).click();
  await alice.getByPlaceholder('Message').fill('see you at 6');
  await alice.getByRole('button', { name: 'Save edit' }).click();
  await expect(bob.getByRole('main').getByText('see you at 6')).toBeVisible();

  // Delete for everyone.
  await send(alice, 'oops wrong chat');
  await expect(bob.getByRole('main').getByText('oops wrong chat')).toBeVisible();
  await openMenu(alice, 'oops wrong chat');
  await alice.getByRole('button', { name: 'Delete' }).click();
  await alice.getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(bob.getByRole('main').getByText('oops wrong chat')).toHaveCount(0);
  await expect(bob.getByRole('main').getByText('This message was deleted').first()).toBeVisible();

  // New device: the key is gone, the passphrase brings history back.
  await wipeDevice(alice);
  await expect(alice).toHaveURL(/\/unlock/);
  await alice.getByRole('textbox', { name: 'Recovery passphrase' }).fill(PASSPHRASE);
  await alice.getByRole('button', { name: 'Unlock' }).click();
  // Unlocking returns to the chat that was open, history decrypted.
  await expect(alice).toHaveURL(/\/chats\/.+_.+/, { timeout: 60_000 });
  await expect(alice.getByRole('main').getByText('hi alice')).toBeVisible();

  // Another new device, passphrase forgotten: the recovery key, then a new passphrase.
  await wipeDevice(alice);
  await expect(alice).toHaveURL(/\/unlock/);
  await alice.getByRole('button', { name: 'Forgot your passphrase?' }).click();
  await alice.getByLabel('Recovery key').fill(aliceRecoveryKey.toLowerCase().replace(/-/g, ' '));
  await alice.getByRole('button', { name: 'Continue' }).click();
  await alice.getByRole('textbox', { name: 'New passphrase' }).fill('a brand new passphrase');
  await alice.getByRole('textbox', { name: 'Type it again' }).fill('a brand new passphrase');
  await alice.getByRole('button', { name: 'Save and unlock' }).click();
  await expect(alice).toHaveURL(/\/chats\/.+_.+/, { timeout: 60_000 });
  await expect(alice.getByRole('main').getByText('hi alice')).toBeVisible();
  await expect(alice.getByRole('main').getByText(bobHandle)).toBeVisible();

  // Bob deletes his account: Google re-confirms who he is, then it is gone.
  await bob.goto('/settings');
  await bob.getByRole('button', { name: 'Delete my account' }).click();
  await bob.getByLabel(`Type ${bobHandle} to confirm`).fill(bobHandle);
  const reauth = bob.waitForEvent('popup');
  await bob.getByRole('button', { name: 'Delete forever' }).click();
  const picker = await reauth;
  await picker.waitForLoadState('load');
  await expect(async () => {
    await picker.getByText(`${bobHandle}@example.com`).click();
  }).toPass({ timeout: 20_000 });
  await expect(bob).toHaveURL(/\/login/, { timeout: 30_000 });

  // Alice's side: the chat stays, read-only, under "Deleted account".
  await alice.reload();
  await expect(alice.getByRole('main').getByText('Deleted account')).toBeVisible();
  await expect(alice.getByPlaceholder('This account was deleted')).toBeDisabled();
  await expect(alice.getByRole('main').getByText('hi alice')).toBeVisible();
});

test('signs up with an email link, on any provider, and can delete the account', async ({
  browser,
}) => {
  const carol = await newPhone(browser);
  const handle = `carol_${run}`;
  const email = `${handle}@icloud.com`;

  // A link opened in another browser (or a home-screen app) has no stored
  // address: the finish page asks for it.
  const firstLink = await requestEmailLink(carol, email);
  const elsewhere = await newPhone(browser);
  await elsewhere.goto(firstLink);
  await expect(elsewhere.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await elsewhere.getByLabel('Email').fill(email);
  await elsewhere.getByRole('button', { name: 'Continue' }).click();
  await expect(elsewhere).toHaveURL(/\/onboarding/);
  await elsewhere.context().close();

  // The usual case: the same browser, through the pasted-link box. That
  // signs in the same account the other browser just created.
  const link = await requestEmailLink(carol, email);
  await carol.getByLabel('Sign-in link').fill(link);
  await carol.getByRole('button', { name: 'Sign in with link' }).click();
  await onboard(carol, handle);

  // Freshly signed in, so deletion needs no second link.
  await carol.goto('/settings');
  await carol.getByRole('button', { name: 'Delete my account' }).click();
  await carol.getByLabel(`Type ${handle} to confirm`).fill(handle);
  await carol.getByRole('button', { name: 'Delete forever' }).click();
  await expect(carol).toHaveURL(/\/login/, { timeout: 30_000 });
});
