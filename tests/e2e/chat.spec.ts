/**
 * The core loop, end to end, in two browsers against the emulators:
 * sign up, find each other, send, reply, edit, delete, and get history back
 * on a "new device" with the passphrase and then with the recovery key.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
 * The code the server would have emailed. Under the emulators it skips the
 * email and keeps the code on its (server-only) doc, which the emulator's
 * owner credential can read.
 */
async function emailedCode(page: Page, email: string): Promise<string> {
  const id = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const response = await page.request.get(
    `http://127.0.0.1:8080/v1/projects/demo-zing/databases/(default)/documents/emailCodes/${id}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  expect(response.ok()).toBe(true);
  const { fields } = (await response.json()) as { fields: { devCode: { stringValue: string } } };
  return fields.devCode.stringValue;
}

/** Ask for a code from the login page's email box. */
async function requestCode(page: Page, button: string, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: button }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
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
  // Bob's list acknowledging it is the second tick on Alice's open thread --
  // which takes its receipts from her own list's listener, not one of its own.
  await expect(alice.getByRole('main').getByRole('img', { name: 'Delivered' })).toBeVisible();
  await bob.locator('li').getByText(aliceHandle).click();
  await expect(bob.getByRole('main').getByText('hello bob')).toBeVisible();
  await expect(alice.getByRole('main').getByRole('img', { name: 'Read' })).toBeVisible();

  // Reply.
  await openMenu(bob, 'hello bob');
  await bob.getByRole('button', { name: 'Reply' }).click();
  await send(bob, 'hi alice');
  await expect(alice.getByRole('main').getByText('hi alice')).toBeVisible();

  // Typing shows on the other side as a bubble in the thread, and goes away
  // by itself once the typing stops.
  await alice.getByPlaceholder('Message').fill('still typ');
  await expect(bob.getByRole('status', { name: 'typing' })).toBeVisible();
  await expect(bob.getByRole('status', { name: 'typing' })).toBeHidden({ timeout: 10_000 });

  // Sending keeps the keyboard up: the box still has focus after the tap.
  await alice.getByPlaceholder('Message').fill('keyboard stays');
  await alice.getByRole('button', { name: 'Send' }).click();
  await expect(alice.getByPlaceholder('Message')).toBeFocused();
  await expect(bob.getByRole('main').getByText('keyboard stays')).toBeVisible();

  // Past one page of messages, the newest still scrolls into view by itself
  // (it used to stop once the live window was full and the count stopped
  // changing).
  for (let index = 1; index <= 32; index++) await send(alice, `burst ${index}`);
  await expect(bob.getByRole('main').getByText('burst 32', { exact: true })).toBeInViewport();

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

  // React: Bob's 👍 reaches Alice (sealed in transit), and he can take it back.
  await openMenu(bob, 'see you at 6');
  await bob.getByRole('button', { name: 'React 👍' }).click();
  await expect(alice.getByRole('main').getByRole('button', { name: /^Reactions: 👍 1$/ })).toBeVisible();
  await bob.getByRole('main').getByRole('button', { name: /including yours/ }).click();
  await expect(alice.getByRole('main').getByRole('button', { name: /^Reactions:/ })).toHaveCount(0);

  // Forward: sealed again for the chosen chat (here, the same one).
  await openMenu(bob, 'keyboard stays');
  await bob.getByRole('button', { name: 'Forward' }).click();
  await bob.getByRole('dialog', { name: 'Forward to' }).getByRole('button', { name: new RegExp(aliceHandle) }).click();
  await expect(alice.getByRole('main').getByText('keyboard stays', { exact: true })).toHaveCount(2);
  // Labelled as forwarded on both sides -- the copy, not the original.
  await expect(alice.getByRole('main').getByText('Forwarded', { exact: true })).toHaveCount(1);
  await expect(bob.getByRole('main').getByText('Forwarded', { exact: true })).toHaveCount(1);

  // On a wide screen, hovering a bubble offers the menu without a right-click.
  // (The emulated phone reports no hover, so the arrow stays transparent here;
  // the click still proves it is wired up.) A message in the live window, so
  // the reaction reaches Bob's open thread.
  await alice.setViewportSize({ width: 1280, height: 800 });
  const recent = alice
    .locator('[id^="m-"]')
    .filter({ has: alice.getByText('burst 32', { exact: true }) });
  await recent.hover();
  await recent.getByRole('button', { name: 'Message options' }).click();
  await expect(alice.getByRole('dialog', { name: 'Message actions' })).toBeVisible();
  await alice.getByRole('button', { name: 'React 😂' }).click();
  await expect(bob.getByRole('main').getByRole('button', { name: /^Reactions: 😂 1$/ })).toBeVisible();
  await alice.setViewportSize({ width: 412, height: 915 });

  // Search inside the chat runs over what this device decrypted.
  await bob.getByRole('button', { name: 'Search this chat' }).click();
  await bob.getByRole('textbox', { name: 'Search this chat' }).fill('SEE YOU');
  await expect(bob.getByText('1 of 1')).toBeVisible();
  await expect(bob.getByRole('main').locator('mark')).toHaveText('see you');
  await bob.getByRole('button', { name: 'Close search' }).click();

  // Star, then find it on the Starred screen and jump back to it.
  await openMenu(bob, 'see you at 6');
  await bob.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(bob.getByRole('main').getByRole('img', { name: 'Starred' })).toBeVisible();
  await bob.goto('/starred');
  await bob.getByText('see you at 6').click();
  await expect(bob).toHaveURL(/\/chats\/.+_.+#m-/);
  await expect(bob.getByRole('main').getByText('see you at 6')).toBeVisible();

  // Mute and archive from the chat list, then bring it back.
  await bob.goto('/chats');
  const row = () => bob.getByRole('link', { name: new RegExp(aliceHandle) });
  await row().dispatchEvent('contextmenu');
  await bob.getByRole('button', { name: 'Mute notifications' }).click();
  await bob.getByRole('button', { name: 'Always' }).click();
  await expect(row().getByRole('img', { name: 'Muted' })).toBeVisible();
  await row().dispatchEvent('contextmenu');
  await bob.getByRole('button', { name: 'Archive chat' }).click();
  await expect(row()).toHaveCount(0);
  await bob.getByRole('button', { name: 'Archived' }).click();
  await row().dispatchEvent('contextmenu');
  await bob.getByRole('button', { name: 'Unarchive chat' }).click();
  await bob.getByRole('button', { name: 'Back to chats' }).click();
  await expect(row()).toBeVisible();

  // New device: the key is gone, the passphrase brings history back.
  await wipeDevice(alice);
  await expect(alice).toHaveURL(/\/unlock/);
  await alice.getByRole('textbox', { name: 'Recovery passphrase' }).fill(PASSPHRASE);
  await alice.getByRole('button', { name: 'Unlock' }).click();
  // Unlocking returns to the chat that was open, history decrypted.
  await expect(alice).toHaveURL(/\/chats\/.+_.+/, { timeout: 60_000 });
  await expect(alice.getByRole('main').getByText('burst 32', { exact: true })).toBeVisible();

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
  await expect(alice.getByRole('main').getByText('burst 32', { exact: true })).toBeVisible();
  await expect(alice.getByRole('main').getByText(bobHandle)).toBeVisible();

  // Bob deletes his account: Google re-confirms who he is, then it is gone.
  await bob.goto('/settings#account');
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
  await expect(alice.getByRole('main').getByText('burst 32', { exact: true })).toBeVisible();
});

test('signs up with an emailed code, on any provider, and can delete the account', async ({
  browser,
}) => {
  const carol = await newPhone(browser);
  const handle = `carol_${run}`;
  const email = `${handle}@icloud.com`;

  // "I already have an account" with an address nobody registered: refused
  // on the spot, and no code is made.
  await requestCode(carol, 'I already have an account', email);
  await expect(carol.getByText('No Zing account uses this email. Check it and try again.')).toBeVisible();

  // Signing up instead: a code is sent. A wrong one is refused.
  await requestCode(carol, 'Create an account', email);
  await expect(carol.getByText('Check your email')).toBeVisible();
  const code = await emailedCode(carol, email);
  const wrong = code === '000000' ? '111111' : '000000';
  await carol.getByLabel('Code').fill(wrong);
  await carol.getByRole('button', { name: 'Verify' }).click();
  await expect(carol.getByText('That code isn’t right. Check the email and try again.')).toBeVisible();

  await carol.getByLabel('Code').fill(code);
  await carol.getByRole('button', { name: 'Verify' }).click();
  await onboard(carol, handle);

  // Now the account exists, "I already have an account" gets past the
  // account check -- straight into the one-code-a-minute limit, since a
  // code went to this address moments ago.
  const other = await newPhone(browser);
  await requestCode(other, 'I already have an account', email);
  await expect(
    other.getByText('Too many codes asked for. Wait a minute and try again.'),
  ).toBeVisible();
  await other.context().close();

  // Freshly signed in, so deletion needs no second code.
  await carol.goto('/settings#account');
  await carol.getByRole('button', { name: 'Delete my account' }).click();
  await carol.getByLabel(`Type ${handle} to confirm`).fill(handle);
  await carol.getByRole('button', { name: 'Delete forever' }).click();
  await expect(carol).toHaveURL(/\/login/, { timeout: 30_000 });
});

test('formatting, chat filters and light mode', async ({ browser }) => {
  const erin = await newPhone(browser);
  const frank = await newPhone(browser);
  const erinHandle = `erin_${run}`;
  const frankHandle = `frank_${run}`;

  await signInWithGoogle(erin, erinHandle);
  await onboard(erin, erinHandle);
  await signInWithGoogle(frank, frankHandle);
  await onboard(frank, frankHandle);

  await erin.getByRole('link', { name: 'New chat' }).click();
  await erin.getByLabel('Find someone').fill(`@${frankHandle}`);
  await erin.getByRole('button', { name: 'Find' }).click();
  await erin.getByRole('button', { name: 'Chat' }).click();
  await send(erin, '*bold* and _soft_ with `*code*` at https://example.com/a_b_c');
  await expect(frank.getByLabel('1 unread')).toBeVisible();

  // Filters: unread shows the new chat; favourites is empty until it is added.
  const row = frank.locator('li').filter({ hasText: erinHandle });
  await frank.getByRole('radio', { name: 'Unread' }).click();
  await expect(row).toBeVisible();
  await frank.getByRole('radio', { name: 'Favourites' }).click();
  await expect(frank.getByText('No favourites yet.')).toBeVisible();
  await frank.getByRole('radio', { name: 'All' }).click();
  await row.getByRole('link').dispatchEvent('contextmenu');
  await frank.getByRole('button', { name: /Add to favourites/ }).click();
  await frank.getByRole('radio', { name: 'Favourites' }).click();
  await expect(row).toBeVisible();
  // The list preview reads without the markers.
  await expect(row.getByText('bold and soft with *code* at', { exact: false })).toBeVisible();

  // Formatting renders on the receiving phone; the link keeps its underscores
  // and code stays literal.
  await row.getByRole('link').click();
  const thread = frank.getByRole('main');
  await expect(thread.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(thread.locator('em', { hasText: 'soft' })).toBeVisible();
  await expect(thread.locator('code', { hasText: '*code*' })).toBeVisible();
  await expect(thread.getByRole('link', { name: 'https://example.com/a_b_c' })).toHaveAttribute(
    'href',
    'https://example.com/a_b_c',
  );

  // Read now, so it leaves the Unread filter once the thread is closed.
  await frank.goto('/chats');
  await frank.getByRole('radio', { name: 'Unread' }).click();
  await expect(frank.getByText('No unread chats.')).toBeVisible();

  // Light mode and a wallpaper: saved to the account, applied at once, and
  // back before the first paint after a reload.
  await frank.goto('/settings#appearance');
  await frank.getByRole('radio', { name: 'Light' }).click();
  await frank.getByRole('radio', { name: 'Ocean' }).click();
  const html = frank.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-wallpaper', 'ocean');
  await frank.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await frank.goto('/chats');
  await expect(row).toBeVisible();
  await row.getByRole('link').click();
  await expect(thread.locator('strong', { hasText: 'bold' })).toBeVisible();

  // It follows the account: Erin's phone is untouched, still dark.
  await expect(erin.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the chat menu: mute, theme, disappearing, clear and close', async ({ browser }) => {
  const gina = await newPhone(browser);
  const hank = await newPhone(browser);
  const ginaHandle = `gina_${run}`;
  const hankHandle = `hank_${run}`;

  await signInWithGoogle(gina, ginaHandle);
  await onboard(gina, ginaHandle);
  await signInWithGoogle(hank, hankHandle);
  await onboard(hank, hankHandle);

  await gina.getByRole('link', { name: 'New chat' }).click();
  await gina.getByLabel('Find someone').fill(`@${hankHandle}`);
  await gina.getByRole('button', { name: 'Find' }).click();
  await gina.getByRole('button', { name: 'Chat' }).click();
  await send(gina, 'first one');
  await send(gina, 'second one');
  await expect(hank.getByLabel('2 unread')).toBeVisible();

  const thread = gina.getByRole('main');
  const menu = gina.getByRole('dialog');
  const openMenuOf = () => thread.getByRole('button', { name: 'Chat options' }).click();
  // Tapping outside a sheet closes it; the top of the screen is backdrop.
  const closeSheet = () => gina.mouse.click(20, 20);

  // Mute for 8 hours: the menu says so, and the list shows the bell.
  await openMenuOf();
  await menu.getByRole('button', { name: /Mute notifications/ }).click();
  await menu.getByRole('button', { name: '8 hours' }).click();
  await expect(menu.getByRole('button', { name: /^Muted Muted until/ })).toBeVisible();

  // A theme of this chat's own, applied behind the sheet at once.
  await menu.getByRole('button', { name: /Chat theme & wallpaper/ }).click();
  await menu.getByRole('radio', { name: 'Forest' }).click();
  await menu.getByRole('radio', { name: 'Rose' }).click();
  await closeSheet();
  await expect(gina.locator('.chat-wallpaper')).toHaveAttribute('data-wallpaper', 'forest');
  await expect(gina.locator('[data-bubble="rose"]')).toHaveCount(1);

  // Disappearing messages from the menu: both phones get the banner.
  await openMenuOf();
  await menu.getByRole('button', { name: /Disappearing messages/ }).click();
  await menu.getByRole('radio', { name: '24h' }).click();
  await closeSheet();
  await expect(gina.getByText(/New messages disappear 24 hours after/)).toBeVisible();
  await openMenuOf();
  await menu.getByRole('button', { name: /Disappearing messages/ }).click();
  await menu.getByRole('radio', { name: 'Off' }).click();
  await closeSheet();

  // Clear chat asks first, then empties the chat for Gina only -- for good.
  await openMenuOf();
  await menu.getByRole('button', { name: /Clear chat/ }).click();
  const confirm = gina.getByRole('alertdialog', { name: 'Clear this chat?' });
  await expect(confirm).toContainText('can’t be undone');
  await confirm.getByRole('button', { name: 'Clear chat' }).click();
  await expect(thread.getByText('first one')).toHaveCount(0);
  await expect(thread.getByText('second one')).toHaveCount(0);
  await gina.reload();
  await expect(thread.getByRole('textbox', { name: /Message/ }).or(gina.getByPlaceholder('Message'))).toBeVisible();
  await expect(thread.getByText('first one')).toHaveCount(0);
  await hank.locator('li').getByText(ginaHandle).click();
  await expect(hank.getByRole('main').getByText('first one')).toBeVisible();
  // New messages after the clear show as normal.
  await send(gina, 'after the clear');
  await expect(thread.getByText('after the clear')).toBeVisible();

  // "Close chat" is for wide screens; a phone has Back.
  await openMenuOf();
  await expect(menu.getByRole('button', { name: 'Close chat' })).toBeHidden();
  await closeSheet();
  await gina.setViewportSize({ width: 1280, height: 800 });
  await openMenuOf();
  await menu.getByRole('button', { name: 'Close chat' }).click();
  await expect(gina).toHaveURL(/\/chats$/);
  await expect(gina.getByText('Pick a conversation to start reading.')).toBeVisible();
  // The muted chat keeps its bell in the list, and its preview is the new message.
  const row = gina.locator('li').filter({ hasText: hankHandle });
  await expect(row.getByRole('img', { name: 'Muted' })).toBeVisible();
  await expect(row.getByText('after the clear')).toBeVisible();
});

test('message yourself, nicknames, pinned messages and view once', async ({ browser }) => {
  const ivy = await newPhone(browser);
  const jack = await newPhone(browser);
  const ivyHandle = `ivy_${run}`;
  const jackHandle = `jack_${run}`;

  await signInWithGoogle(ivy, ivyHandle);
  await onboard(ivy, ivyHandle);
  await signInWithGoogle(jack, jackHandle);
  await onboard(jack, jackHandle);

  // Message yourself: one tap from New chat, a chat whose id is my uid twice.
  await ivy.getByRole('link', { name: 'New chat' }).click();
  await ivy.getByRole('button', { name: /Message yourself/ }).click();
  await expect(ivy).toHaveURL(/\/chats\/([A-Za-z0-9]+)_\1$/);
  await expect(ivy.getByRole('main').getByText('Message yourself').first()).toBeVisible();
  await send(ivy, 'note to self');
  await expect(ivy.getByRole('main').getByText('note to self')).toBeVisible();
  await ivy.goto('/chats');
  await expect(ivy.locator('li').filter({ hasText: `${ivyHandle} (You)` })).toContainText('note to self');

  // A normal chat for the rest.
  await ivy.getByRole('link', { name: 'New chat' }).click();
  await ivy.getByLabel('Find someone').fill(`@${jackHandle}`);
  await ivy.getByRole('button', { name: 'Find' }).click();
  await ivy.getByRole('button', { name: 'Chat', exact: true }).click();
  await send(ivy, 'pin me');
  await send(ivy, 'second');
  await expect(jack.getByLabel('2 unread')).toBeVisible();

  // Nickname: only Jack sees it, everywhere he sees Ivy.
  await jack.locator('li').getByText(ivyHandle).click();
  const jackThread = jack.getByRole('main');
  await jackThread.getByRole('button', { name: new RegExp(ivyHandle) }).first().click();
  await jack.getByRole('button', { name: 'Add nickname' }).click();
  await jack.getByLabel(`Nickname for ${ivyHandle}`).fill('Ivy Bear');
  await jack.getByRole('button', { name: 'Save' }).click();
  await expect(jack.getByRole('dialog')).toContainText(`~${ivyHandle}`);
  await jack.mouse.click(20, 20);
  await expect(jackThread.locator('header')).toContainText('Ivy Bear');
  await expect(ivy.getByRole('main').locator('header')).toContainText(jackHandle);

  // Pin: Jack pins, both see the bar; tapping it finds the message.
  await openMenu(jack, 'pin me');
  await jack.getByRole('button', { name: 'Pin', exact: true }).click();
  const ivyBar = ivy.getByRole('button', { name: /^Pinned message/ });
  await expect(ivyBar).toContainText('pin me');
  await expect(jack.getByRole('button', { name: /^Pinned message/ })).toContainText('pin me');
  await ivyBar.click();
  // Unpinning takes it away for both. (The text is in the bar too now.)
  await ivy.locator('section').getByText('pin me', { exact: true }).dispatchEvent('contextmenu');
  await ivy.getByRole('button', { name: 'Unpin' }).click();
  await expect(jack.getByRole('button', { name: /^Pinned message/ })).toHaveCount(0);

  // View once: the text never shows in the bubble, list or menu, and opening
  // it once wipes it for both.
  await ivy.getByRole('button', { name: 'View once' }).click();
  await send(ivy, 'one time secret');
  await expect(ivy.getByRole('button', { name: 'View once' })).toHaveAttribute('aria-pressed', 'false');
  await expect(ivy.getByRole('main').getByText('View once message', { exact: true })).toBeVisible();
  await expect(ivy.getByText('one time secret')).toHaveCount(0);
  const tapToView = jackThread.getByRole('button', { name: /View once message · Tap to view/ });
  await expect(tapToView).toBeVisible();
  await expect(jack.getByText('one time secret')).toHaveCount(0);

  await tapToView.click();
  const viewer = jack.getByRole('dialog', { name: 'View once message' });
  await expect(viewer).toContainText('from Ivy Bear');
  // Not in the page at all until it is pressed, and only while held.
  await expect(viewer).not.toContainText('one time secret');
  const hold = viewer.getByRole('button', { name: 'Press and hold to view' });
  const box = (await hold.boundingBox())!;
  await jack.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await jack.mouse.down();
  await expect(viewer).toContainText('one time secret');
  await expect(viewer).toContainText(`@${jackHandle}`);
  await jack.mouse.up();
  await expect(viewer).not.toContainText('one time secret');
  await viewer.getByRole('button', { name: /^Close/ }).click();
  await expect(jackThread.getByText('Opened')).toBeVisible();
  await expect(ivy.getByRole('main').getByText('Opened')).toBeVisible();
  await jack.reload();
  await expect(jackThread.getByText('Opened')).toBeVisible();
  await expect(jack.getByText('one time secret')).toHaveCount(0);

  // The list says what it was, never what it said; and uses the nickname.
  await jack.goto('/chats');
  const row = jack.locator('li').filter({ hasText: 'Ivy Bear' });
  await expect(row).toContainText('View once message');
});

test('selecting several messages, and changing a username', async ({ browser }) => {
  const kim = await newPhone(browser);
  const leo = await newPhone(browser);
  const kimHandle = `kim_${run}`;
  const leoHandle = `leo_${run}`;

  await signInWithGoogle(kim, kimHandle);
  await onboard(kim, kimHandle);
  await signInWithGoogle(leo, leoHandle);
  await onboard(leo, leoHandle);

  await kim.getByRole('link', { name: 'New chat' }).click();
  await kim.getByLabel('Find someone').fill(`@${leoHandle}`);
  await kim.getByRole('button', { name: 'Find' }).click();
  await kim.getByRole('button', { name: 'Chat', exact: true }).click();
  for (const text of ['one', 'two', 'three']) await send(kim, text);
  await expect(leo.getByLabel('3 unread')).toBeVisible();
  await leo.locator('li').getByText(kimHandle).click();
  const leoThread = leo.getByRole('main');
  await expect(leoThread.getByText('three', { exact: true })).toBeVisible();

  const bubble = (text: string) => kim.locator('section').getByText(text, { exact: true });

  // Select from the menu, then tap more: the header becomes the actions.
  await openMenu(kim, 'one');
  await kim.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(kim.getByText('1 selected')).toBeVisible();
  await bubble('two').click();
  await expect(kim.getByText('2 selected')).toBeVisible();
  await kim.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(kim.getByRole('main').getByRole('img', { name: 'Starred' })).toHaveCount(2);

  // Forward two at once, into the same chat: both arrive, in order.
  await openMenu(kim, 'two');
  await kim.getByRole('button', { name: 'Select', exact: true }).click();
  await bubble('three').click();
  await kim.getByRole('button', { name: 'Forward', exact: true }).click();
  await kim.getByRole('dialog').getByRole('button', { name: new RegExp(leoHandle) }).click();
  await expect(leoThread.getByText('Forwarded')).toHaveCount(2);

  // Delete several for everyone.
  await openMenu(kim, 'one');
  await kim.getByRole('button', { name: 'Select', exact: true }).click();
  await bubble('three').first().click();
  await kim.getByRole('button', { name: 'Delete', exact: true }).click();
  await kim.getByRole('alertdialog').getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(leoThread.getByText('This message was deleted')).toHaveCount(2);
  await expect(kim.getByText(/selected$/)).toHaveCount(0);

  // A new @username: the old one stops finding Kim, the new one does.
  const newHandle = `kim2_${run}`;
  await kim.goto('/settings#profile');
  await kim.getByRole('button', { name: 'Change', exact: true }).click();
  await kim.getByLabel('New username').fill(newHandle);
  await kim.getByRole('button', { name: 'Save username' }).click();
  await expect(kim.getByText(`@${newHandle}`).first()).toBeVisible();
  await expect(kim.getByText('Username changed')).toBeVisible();

  await leo.goto('/chats/new');
  await leo.getByLabel('Find someone').fill(`@${kimHandle}`);
  await leo.getByRole('button', { name: 'Find' }).click();
  await expect(leo.getByText(/Nobody found/)).toBeVisible();
  await leo.getByLabel('Find someone').fill(`@${newHandle}`);
  await leo.getByRole('button', { name: 'Find' }).click();
  await expect(leo.getByText(`@${newHandle}`)).toBeVisible();
});

test('settings sections, and scanning a profile code', async ({ browser }) => {
  const mia = await newPhone(browser);
  const nia = await newPhone(browser);
  const miaHandle = `mia_${run}`;
  const niaHandle = `nia_${run}`;

  await signInWithGoogle(mia, miaHandle);
  await onboard(mia, miaHandle);
  await signInWithGoogle(nia, niaHandle);
  await onboard(nia, niaHandle);

  // Sections start closed, each saying what is set; they open, and the page
  // remembers which were left open.
  await nia.goto('/settings');
  const appearance = nia.getByRole('button', { name: /^Appearance/ });
  await expect(appearance).toHaveAttribute('aria-expanded', 'false');
  await expect(appearance).toContainText('Dark theme · Doodles wallpaper');
  await appearance.click();
  await expect(appearance).toHaveAttribute('aria-expanded', 'true');
  await expect(nia.getByRole('radio', { name: 'Light' })).toBeVisible();
  await nia.reload();
  await expect(nia.getByRole('button', { name: /^Appearance/ })).toHaveAttribute('aria-expanded', 'true');
  await nia.getByRole('button', { name: 'Expand all' }).click();
  await expect(nia.getByRole('button', { name: /^Security/ })).toHaveAttribute('aria-expanded', 'true');
  await nia.getByRole('button', { name: 'Collapse all' }).click();
  await expect(nia.getByRole('button', { name: /^Appearance/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(nia.getByRole('button', { name: /^Notifications/ })).toBeVisible();

  // Mia's code, as her phone shows it...
  await mia.goto('/settings');
  await mia.getByRole('button', { name: 'My QR code' }).click();
  const code = await mia.getByRole('img', { name: /QR code for/ }).screenshot();

  // ...scanned by Nia from New chat (a photo of it: no camera in the test).
  await nia.goto('/chats/new');
  await nia.getByRole('button', { name: /Scan a QR code/ }).click();
  const scanner = nia.getByRole('dialog', { name: 'Scan a QR code' });
  await expect(scanner).toBeVisible();
  await scanner.locator('input[type=file]').setInputFiles({
    name: 'code.png',
    mimeType: 'image/png',
    buffer: code,
  });
  await expect(nia).toHaveURL(new RegExp(`/u/${miaHandle}$`));
  await expect(nia.getByRole('button', { name: 'Message' })).toBeVisible();
  // The camera is off once the scanner has closed.
  await expect(scanner).toHaveCount(0);
});

test('spelling and grammar, checked on the device as you type', async ({ browser }) => {
  test.setTimeout(240_000);
  const olga = await newPhone(browser);
  const pete = await newPhone(browser);
  const olgaHandle = `olga_${run}`;
  const peteHandle = `pete_${run}`;

  await signInWithGoogle(olga, olgaHandle);
  await onboard(olga, olgaHandle);
  await signInWithGoogle(pete, peteHandle);
  await onboard(pete, peteHandle);

  await olga.getByRole('link', { name: 'New chat' }).click();
  await olga.getByLabel('Find someone').fill(`@${peteHandle}`);
  await olga.getByRole('button', { name: 'Find' }).click();
  await olga.getByRole('button', { name: 'Chat', exact: true }).click();

  // Nothing typed may go anywhere but this app and its own backends.
  const elsewhere: string[] = [];
  olga.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!['localhost', '127.0.0.1'].includes(host) && !host.endsWith('googleapis.com')) {
      elsewhere.push(request.url());
    }
  });

  const box = olga.getByPlaceholder('Message');
  await box.click();
  await box.pressSequentially('this is teh best');
  // The engine loads the first time; after that each check is quick.
  const mark = olga.locator('mark', { hasText: 'teh' });
  await expect(mark).toHaveCount(1, { timeout: 120_000 });
  const chip = olga.getByRole('button', { name: /spelling and grammar suggestion/ });
  await expect(chip).toBeVisible();

  // The chip steps to the mistake; its fix replaces it in place.
  await chip.click();
  const strip = olga.getByRole('region', { name: 'Spelling suggestion' });
  await expect(strip).toContainText('Did you mean');
  await strip.getByRole('button', { name: 'the', exact: true }).click();
  await expect(box).toHaveValue('this is the best');
  await expect(mark).toHaveCount(0);

  // Grammar too, in its own colour; and sending is never held up by it.
  await box.pressSequentially('. Meet me their at 5');
  await expect(olga.locator('mark', { hasText: 'their' })).toHaveCount(1, { timeout: 30_000 });
  await olga.getByRole('button', { name: 'Send' }).click();
  await expect(pete.getByLabel('1 unread')).toBeVisible();
  expect(elsewhere).toEqual([]);

  // Switched off in Settings: no more underlines.
  await olga.goto('/settings#typing');
  await olga.getByRole('switch', { name: /Check spelling & grammar/ }).click();
  await expect(olga.getByRole('button', { name: /^Typing/ })).toContainText('check off');
  await olga.goBack();
  await olga.getByPlaceholder('Message').pressSequentially('teh end');
  await olga.waitForTimeout(1500);
  await expect(olga.locator('mark', { hasText: 'teh' })).toHaveCount(0);
});

test('mark as unread, text size, translate, and replying from a notification', async ({ browser }) => {
  const quin = await newPhone(browser);
  const rae = await newPhone(browser);
  const quinHandle = `quin_${run}`;
  const raeHandle = `rae_${run}`;

  // Headless Chromium has no on-device translator: stand-ins for its APIs,
  // so the app's side of it can be tested.
  await quin.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>;
    scope.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'fr', confidence: 0.95 }] }),
    };
    scope.Translator = {
      availability: async () => 'available',
      create: async () => ({ translate: async () => 'Hello my friend' }),
    };
  });

  await signInWithGoogle(quin, quinHandle);
  await onboard(quin, quinHandle);
  await signInWithGoogle(rae, raeHandle);
  await onboard(rae, raeHandle);

  await quin.getByRole('link', { name: 'New chat' }).click();
  await quin.getByLabel('Find someone').fill(`@${raeHandle}`);
  await quin.getByRole('button', { name: 'Find' }).click();
  await quin.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(quin).toHaveURL(/\/chats\/.+_.+/);
  const chatId = new URL(quin.url()).pathname.split('/').pop()!;
  await send(quin, 'hi');
  await rae.locator('li').getByText(quinHandle).click();
  await send(rae, 'Bonjour mon ami');
  const thread = quin.getByRole('main');
  await expect(thread.getByText('Bonjour mon ami')).toBeVisible();

  // Translate, on the device: the original stays, the translation under it.
  await openMenu(quin, 'Bonjour mon ami');
  await quin.getByRole('button', { name: 'Translate' }).click();
  await expect(thread.getByText('Hello my friend')).toBeVisible();
  await expect(thread.getByText('Translated from French')).toBeVisible();
  await thread.getByRole('button', { name: 'Hide' }).click();
  await expect(thread.getByText('Hello my friend')).toHaveCount(0);

  // Text size: bigger message text, everywhere at once.
  await quin.goto('/settings#appearance');
  await quin.getByRole('radio', { name: 'Large', exact: true }).click();
  await expect(quin.locator('html')).toHaveAttribute('data-text-size', 'large');
  await quin.goto(`/chats/${chatId}`);
  const bubble = quin.locator('section').getByText('Bonjour mon ami', { exact: true });
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((node) => getComputedStyle(node).fontSize)).toBe('17.5px');

  // Mark as unread: a dot in the list, under Unread, gone once it is opened.
  await quin.goto('/chats');
  const row = quin.locator('li').filter({ hasText: raeHandle });
  await row.getByRole('link').dispatchEvent('contextmenu');
  await quin.getByRole('button', { name: /Mark as unread/ }).click();
  await expect(row.getByRole('img', { name: 'Marked unread' })).toBeVisible();
  await quin.getByRole('radio', { name: 'Unread' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('link').click();
  await expect(quin).toHaveURL(new RegExp(`/chats/${chatId}$`));
  await quin.goto('/chats');
  await expect(quin.locator('li').filter({ hasText: raeHandle }).getByRole('img', { name: 'Marked unread' })).toHaveCount(0);

  // A reply typed into a notification: the service worker queues it on the
  // device, exactly like this; the app sends it, sealed, once it is running.
  await quin.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('zing');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('outbox', 'readwrite');
          tx.objectStore('outbox').put({ chatId: id, text: 'sent from a notification', at: Date.now() }, 'test-reply');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    chatId,
  );
  await quin.reload();
  await expect(rae.getByRole('main').getByText('sent from a notification')).toBeVisible();
  // Sent once, and the queue is empty again.
  await quin.reload();
  await quin.waitForTimeout(2000);
  await expect(rae.getByRole('main').getByText('sent from a notification')).toHaveCount(1);
});

test('send a location, search every chat, and export one', async ({ browser }) => {
  // Sam's phone may share where it is: central Accra.
  const samContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 5.6037, longitude: -0.187, accuracy: 15 },
  });
  const sam = await samContext.newPage();
  const tia = await newPhone(browser);
  const samHandle = `sam_${run}`;
  const tiaHandle = `tia_${run}`;

  await signInWithGoogle(sam, samHandle);
  await onboard(sam, samHandle);
  await signInWithGoogle(tia, tiaHandle);
  await onboard(tia, tiaHandle);

  await sam.getByRole('link', { name: 'New chat' }).click();
  await sam.getByLabel('Find someone').fill(`@${tiaHandle}`);
  await sam.getByRole('button', { name: 'Find' }).click();
  await sam.getByRole('button', { name: 'Chat', exact: true }).click();
  await send(sam, 'hello tia');
  await tia.locator('li').getByText(samHandle).click();
  await send(tia, 'the pineapple party is on friday');
  await expect(sam.getByRole('main').getByText('the pineapple party is on friday')).toBeVisible();

  // A location: found, shown first, sent only on confirming.
  await sam.getByRole('button', { name: 'Attach' }).click();
  await sam.getByRole('button', { name: /Location/ }).click();
  await expect(sam.getByRole('dialog')).toContainText('5.603700, -0.187000');
  await sam.getByRole('button', { name: 'Send this location' }).click();
  const card = tia.getByRole('main').getByRole('link', { name: /Location/ });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('href', /5\.6037,-0\.187/);
  await tia.goto('/chats');
  await expect(tia.locator('li').filter({ hasText: samHandle })).toContainText('📍 Location');

  // Search every chat: the message is found on this device, and opens.
  await sam.goto('/chats');
  await sam.getByLabel('Search your chats').fill('pineapple');
  const found = sam.getByRole('list', { name: 'Messages found' }).getByRole('link').first();
  await expect(found).toContainText('pineapple party');
  await found.click();
  await expect(sam).toHaveURL(/#m-/);
  await expect(sam.getByRole('main').getByText('the pineapple party is on friday')).toBeVisible();

  // Export: the whole chat, decrypted here, as a file.
  await sam.getByRole('main').getByRole('button', { name: 'Chat options' }).click();
  await sam.getByRole('button', { name: /Export chat/ }).click();
  await expect(sam.getByRole('dialog')).toContainText('not encrypted');
  const [file] = await Promise.all([
    sam.waitForEvent('download'),
    sam.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`^Zing chat with ${tiaHandle} - .*\\.txt$`));
  const contents = readFileSync(await file.path(), 'utf8');
  expect(contents).toContain('You: hello tia');
  expect(contents).toContain(`${tiaHandle}: the pineapple party is on friday`);
  expect(contents).toContain('You: Location: 5.603700, -0.187000');
  await samContext.close();
});

test('searching for an emoji, in the composer and for a reaction', async ({ browser }) => {
  const ola = await newPhone(browser);
  const olaHandle = `ola_${run}`;
  await signInWithGoogle(ola, olaHandle);
  await onboard(ola, olaHandle);
  await ola.getByRole('link', { name: 'New chat' }).click();
  await ola.getByRole('button', { name: /Message yourself/ }).click();
  // The dev server's tools button sits over the emoji button at phone width.
  await ola.evaluate(() => document.querySelector('nextjs-portal')?.remove());

  // Composer: search by a tag, tap a result, keep searching, Enter takes the best match.
  await ola.getByPlaceholder('Message').fill('party ');
  await ola.getByRole('button', { name: 'Emoji' }).click();
  const search = ola.getByLabel('Search emoji');
  await search.fill('lol');
  const found = ola.getByRole('region', { name: 'Emoji found' });
  await found.getByRole('button', { name: /face with tears of joy/ }).click();
  await expect(ola.getByPlaceholder('Message')).toHaveValue('party 😂');
  await expect(search).toBeFocused();
  await search.fill('fire');
  await search.press('Enter');
  await expect(ola.getByPlaceholder('Message')).toHaveValue('party 😂🔥');
  await search.fill('zzqqx');
  await expect(ola.getByText('No emoji found')).toBeVisible();
  await ola.getByRole('button', { name: 'Clear search' }).click();
  await expect(ola.getByRole('tablist', { name: 'Emoji categories' })).toBeVisible();
  await ola.getByRole('button', { name: 'Send' }).click();
  await expect(ola.getByRole('main').getByText('party 😂🔥')).toBeVisible();

  // Reaction picker: the same search.
  await openMenu(ola, 'party 😂🔥');
  await ola.getByRole('button', { name: 'More reactions' }).click();
  const actions = ola.getByRole('dialog', { name: 'Message actions' });
  await actions.getByLabel('Search emoji').fill('ghana');
  await actions.getByRole('region', { name: 'Emoji found' }).getByRole('button', { name: /flag: ghana/i }).click();
  await expect(ola.getByRole('main').getByRole('button', { name: /^Reactions: 🇬🇭 1/ })).toBeVisible();
});

test('an account with no recovery key is asked to make one', async ({ browser }) => {
  const pia = await newPhone(browser);
  const piaHandle = `pia_${run}`;
  await signInWithGoogle(pia, piaHandle);
  await onboard(pia, piaHandle);

  // New accounts make a recovery key at sign-up, so they are never asked.
  await expect(pia.getByText('Make a recovery key')).toHaveCount(0);

  // An account from before recovery keys existed: no recovery doc.
  await pia.getByRole('link', { name: 'New chat' }).click();
  await pia.getByRole('button', { name: /Message yourself/ }).click();
  await expect(pia).toHaveURL(/\/chats\/([A-Za-z0-9]+)_\1$/);
  const uid = new URL(pia.url()).pathname.split('/').pop()!.split('_')[0];
  const removed = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-zing/databases/(default)/documents/users/${uid}/private/recovery`,
    { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
  );
  expect(removed.ok).toBe(true);

  await pia.goto('/chats');
  await expect(pia.getByText('Make a recovery key')).toBeVisible();
  await pia.getByRole('link', { name: 'Make one' }).click();
  await expect(pia).toHaveURL(/\/settings#security$/);
  await expect(pia.getByText('You have no recovery key.', { exact: false })).toBeVisible();

  // "Later" puts it away for a week, on this device.
  await pia.goto('/chats');
  await pia.getByRole('button', { name: 'Later' }).click();
  await expect(pia.getByText('Make a recovery key')).toHaveCount(0);
  await pia.reload();
  await expect(pia.getByRole('link', { name: 'New chat' })).toBeVisible();
  await expect(pia.getByText('Make a recovery key')).toHaveCount(0);
});
