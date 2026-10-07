/**
 * Firestore security rules, against the emulator (`npm run test:rules`).
 *
 * Browsers talk straight to Firestore, so these rules are the whole backend
 * authorization layer. Every rule that guards something worth guarding has a
 * test that it allows the honest client and refuses a hand-rolled one.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const CHAT = 'alice_bob';
const backup = { ciphertext: 'c', nonce: 'n', salt: 's', opslimit: 3, memlimit: 1 };

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

function profile(uid: string, username: string) {
  return {
    uid,
    username,
    displayName: username,
    photoURL: null,
    about: 'On Zing',
    publicKey: `pk-${uid}`,
    keyBackup: backup,
    createdAt: serverTimestamp(),
  };
}

/** Seed data with rules off: two accounts with a chat, and a third outsider. */
async function seed(extra?: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    for (const [uid, name] of [['alice', 'alice'], ['bob', 'bob'], ['carol', 'carol']]) {
      await setDoc(doc(db, 'users', uid), { ...profile(uid, name), createdAt: new Date() });
      await setDoc(doc(db, 'usernames', name), { uid });
    }
    await setDoc(doc(db, 'users/bob/shared/contact'), { phone: '+233241234567' });
    await setDoc(doc(db, 'phones/+233241234567'), { uid: 'bob' });
    await setDoc(doc(db, 'chats', CHAT), {
      members: ['alice', 'bob'],
      lastMessage: null,
      lastRead: {},
      lastDelivered: {},
      unread: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'chats', CHAT, 'messages', 'm1'), {
      senderId: 'bob',
      ciphertext: 'x',
      nonce: 'y',
      type: 'text',
      createdAt: new Date(),
      replyTo: null,
    });
    await extra?.(db);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-zing',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

afterAll(async () => {
  await env.cleanup();
});

describe('profiles and usernames', () => {
  it('creates a profile together with its username claim', async () => {
    const db = as('dave');
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', 'dave'), { uid: 'dave' });
    batch.set(doc(db, 'users', 'dave'), profile('dave', 'dave'));
    await assertSucceeds(batch.commit());
  });

  it('refuses a profile that names a handle it never claimed', async () => {
    await assertFails(setDoc(doc(as('dave'), 'users', 'dave'), profile('dave', 'dave')));
  });

  it('refuses a handle someone else already holds', async () => {
    const db = as('dave');
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', 'alice'), { uid: 'dave' });
    batch.set(doc(db, 'users', 'dave'), profile('dave', 'alice'));
    await assertFails(batch.commit());
  });

  it('lets the owner edit display fields but never the public key', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'users', 'alice'), { displayName: 'Ali' }));
    await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { publicKey: 'swapped' }));
    await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { phone: '+233200000000' }));
    await assertFails(updateDoc(doc(as('carol'), 'users', 'alice'), { displayName: 'Hacked' }));
  });

  it('releases a handle only together with deleting the profile', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'usernames', 'alice')));

    const db = as('alice');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', 'alice'));
    batch.delete(doc(db, 'usernames', 'alice'));
    await assertSucceeds(batch.commit());
  });

  it('never lets someone delete another account', async () => {
    await assertFails(deleteDoc(doc(as('carol'), 'users', 'alice')));
  });
});

describe('phone numbers', () => {
  it('claims only E.164 numbers that match the claimant\'s contact doc', async () => {
    const db = as('alice');
    const good = writeBatch(db);
    good.set(doc(db, 'users/alice/shared/contact'), { phone: '+233201234567' });
    good.set(doc(db, 'phones/+233201234567'), { uid: 'alice' });
    await assertSucceeds(good.commit());

    const bad = writeBatch(db);
    bad.set(doc(db, 'users/alice/shared/contact'), { phone: '0201234567' });
    bad.set(doc(db, 'phones/0201234567'), { uid: 'alice' });
    await assertFails(bad.commit());
  });

  it('refuses showing a number you have not claimed', async () => {
    await assertFails(
      setDoc(doc(as('alice'), 'users/alice/shared/contact'), { phone: '+233241234567' }),
    );
  });

  it('refuses taking over a number someone else holds', async () => {
    await assertFails(setDoc(doc(as('alice'), 'phones/+233241234567'), { uid: 'alice' }));
  });

  it('hides a number until both people have sent a message', async () => {
    const contact = () => getDoc(doc(as('alice'), 'users/bob/shared/contact'));
    await assertFails(contact());

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await updateDoc(doc(db, 'chats', CHAT), { 'sent.alice': true });
    });
    await assertFails(contact());

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await updateDoc(doc(db, 'chats', CHAT), { 'sent.bob': true });
    });
    await assertSucceeds(contact());

    await assertFails(getDoc(doc(as('carol'), 'users/bob/shared/contact')));
  });
});

describe('chats', () => {
  it('creates a chat only under the sorted-uid id', async () => {
    const chat = { members: ['alice', 'carol'], lastMessage: null, lastRead: {}, lastDelivered: {} };
    await assertSucceeds(setDoc(doc(as('alice'), 'chats', 'alice_carol'), chat));
    await assertFails(setDoc(doc(as('alice'), 'chats', 'carol_alice'), chat));
    await assertFails(setDoc(doc(as('alice'), 'chats', 'anything'), chat));
  });

  it('creates a chat only empty, so nothing can be pre-claimed', async () => {
    const base = { members: ['alice', 'carol'], lastMessage: null, lastRead: {}, lastDelivered: {} };
    const chat = doc(as('alice'), 'chats', 'alice_carol');
    // Both "has sent" flags up front would unlock carol's phone number.
    await assertFails(setDoc(chat, { ...base, sent: { alice: true, carol: true } }));
    await assertFails(setDoc(chat, { ...base, unread: { carol: 9999 } }));
    await assertFails(setDoc(chat, { ...base, lastRead: { carol: new Date() } }));
    await assertFails(
      setDoc(chat, { ...base, lastMessage: { senderId: 'alice', ciphertext: 'x', nonce: 'n' } }),
    );
    await assertSucceeds(setDoc(chat, { ...base, unread: {} }));
  });

  it('refuses a duplicate chat under unsorted member order', async () => {
    await assertFails(
      setDoc(doc(as('alice'), 'chats', 'carol_alice'), {
        members: ['carol', 'alice'],
        lastMessage: null,
        lastRead: {},
        lastDelivered: {},
      }),
    );
  });

  it('keeps outsiders out', async () => {
    await assertFails(getDoc(doc(as('carol'), 'chats', CHAT)));
    await assertFails(getDoc(doc(as('carol'), 'chats', CHAT, 'messages', 'm1')));
  });

  it('lets a member write only their own receipts, stamped now', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    await assertSucceeds(updateDoc(chat, { 'lastRead.alice': serverTimestamp() }));
    await assertFails(updateDoc(chat, { 'lastRead.bob': serverTimestamp() }));
    await assertFails(updateDoc(chat, { 'lastDelivered.bob': serverTimestamp() }));
    await assertFails(updateDoc(chat, { 'lastRead.alice': new Date(2000, 0, 1) }));
  });

  it('allows +1 on the other badge and clearing your own, nothing else', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    await assertSucceeds(updateDoc(chat, { 'unread.bob': increment(1) }));
    await assertFails(updateDoc(chat, { 'unread.bob': increment(5) }));
    await assertFails(updateDoc(chat, { 'unread.bob': 0 }));
    await assertSucceeds(updateDoc(chat, { 'unread.alice': 0 }));
  });

  it('lets a member flag only their own "has sent"', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    await assertSucceeds(updateDoc(chat, { 'sent.alice': true }));
    await assertFails(updateDoc(chat, { 'sent.bob': true }));
  });

  it('caps the list preview like a message', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    const preview = (size: number) => ({
      lastMessage: { id: 'm', senderId: 'alice', ciphertext: 'a'.repeat(size), nonce: 'n' },
    });
    await assertSucceeds(updateDoc(chat, preview(100)));
    await assertFails(updateDoc(chat, preview(22_001)));
  });

  it('never changes the member list', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'chats', CHAT), { members: ['alice', 'carol'] }));
  });

  it('dates a chat only "now", and previews only your own message', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    const mine = { id: 'm', senderId: 'alice', ciphertext: 'c', nonce: 'n' };
    // What sending does.
    await assertSucceeds(updateDoc(chat, { lastMessage: mine, updatedAt: serverTimestamp() }));
    // Pinned to the top and unread forever.
    await assertFails(updateDoc(chat, { updatedAt: new Date('2100-01-01') }));
    // A preview claiming to be from the other person.
    await assertFails(updateDoc(chat, { lastMessage: { ...mine, senderId: 'bob' } }));
    // Rewriting history, or adding fields of its own.
    await assertFails(updateDoc(chat, { createdAt: new Date('2000-01-01') }));
    await assertFails(updateDoc(chat, { pinned: true }));
  });
});

describe('messages', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    senderId: 'alice',
    ciphertext: 'abc',
    nonce: 'n',
    type: 'text',
    createdAt: serverTimestamp(),
    replyTo: null,
    ...overrides,
  });

  it('accepts a normal message from a member', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'new'), message()));
  });

  it('refuses one over the size cap', async () => {
    await assertFails(
      setDoc(
        doc(as('alice'), 'chats', CHAT, 'messages', 'big'),
        message({ ciphertext: 'a'.repeat(22_001) }),
      ),
    );
  });

  it('refuses sending as someone else, or into a chat you are not in', async () => {
    await assertFails(
      setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'x'), message({ senderId: 'bob' })),
    );
    await assertFails(
      setDoc(doc(as('carol'), 'chats', CHAT, 'messages', 'x'), message({ senderId: 'carol' })),
    );
  });

  it('lets only the sender edit', async () => {
    const edit = { ciphertext: 'new', nonce: 'n2', editedAt: serverTimestamp() };
    await assertFails(updateDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'm1'), edit));
  });

  it('marks a forwarded message only at send time, and only as a boolean', async () => {
    await assertSucceeds(
      setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'fwd'), message({ forwarded: true })),
    );
    await assertFails(
      setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'fwd2'), message({ forwarded: 'from bob' })),
    );
    // Not added afterwards, by the sender or anyone.
    await setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'plain'), message());
    await assertFails(updateDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'plain'), { forwarded: true }));
  });

  it('refuses a message that arrives with reactions already on it', async () => {
    await assertFails(
      setDoc(
        doc(as('alice'), 'chats', CHAT, 'messages', 'pre'),
        message({ reactions: { bob: { ciphertext: 'r', nonce: 'n' } } }),
      ),
    );
  });
});

describe('reactions', () => {
  const sealed = { ciphertext: 'sealed-emoji', nonce: 'n' };
  const m1 = (uid: string) => doc(as(uid), 'chats', CHAT, 'messages', 'm1');

  it('lets any member set and clear their own reaction', async () => {
    // m1 is Bob's message: Alice, who did not send it, may still react.
    await assertSucceeds(updateDoc(m1('alice'), { 'reactions.alice': sealed }));
    await assertSucceeds(updateDoc(m1('bob'), { 'reactions.bob': sealed }));
    await assertSucceeds(updateDoc(m1('alice'), { 'reactions.alice': deleteField() }));
  });

  it("never touches someone else's reaction, or anything besides reactions", async () => {
    await updateDoc(m1('bob'), { 'reactions.bob': sealed });
    await assertFails(updateDoc(m1('alice'), { 'reactions.bob': deleteField() }));
    await assertFails(
      updateDoc(m1('alice'), {
        'reactions.bob': { ciphertext: 'swapped', nonce: 'n' },
        'reactions.alice': sealed,
      }),
    );
    await assertFails(updateDoc(m1('alice'), { 'reactions.alice': sealed, ciphertext: 'forged' }));
  });

  it('keeps outsiders and oversized or misshapen reactions out', async () => {
    await assertFails(updateDoc(m1('carol'), { 'reactions.carol': sealed }));
    await assertFails(
      updateDoc(m1('alice'), { 'reactions.alice': { ciphertext: 'x'.repeat(201), nonce: 'n' } }),
    );
    await assertFails(updateDoc(m1('alice'), { 'reactions.alice': '👍' }));
    await assertFails(updateDoc(m1('alice'), { 'reactions.alice': { ...sealed, extra: true } }));
  });

  it('go with the message when the sender deletes it for everyone, and stop after', async () => {
    await updateDoc(m1('alice'), { 'reactions.alice': sealed });
    await assertSucceeds(
      updateDoc(m1('bob'), {
        ciphertext: deleteField(),
        nonce: deleteField(),
        reactions: deleteField(),
        deleted: true,
        deletedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(m1('alice'), { 'reactions.alice': sealed }));
  });

  it('refuses a delete for everyone that leaves reactions behind', async () => {
    await updateDoc(m1('alice'), { 'reactions.alice': sealed });
    await assertFails(
      updateDoc(m1('bob'), {
        ciphertext: deleteField(),
        nonce: deleteField(),
        deleted: true,
        deletedAt: serverTimestamp(),
      }),
    );
  });
});

describe('conversation keys', () => {
  it('can be created by a member but never replaced', async () => {
    const key = doc(as('alice'), 'chats', CHAT, 'keys', 'alice');
    await assertSucceeds(setDoc(key, { sealed: 'one' }));
    await assertFails(setDoc(key, { sealed: 'two' }));
    await assertFails(getDoc(doc(as('alice'), 'chats', CHAT, 'keys', 'bob')));
  });
});

describe('"Delete for me" lists', () => {
  it('belong to their owner only', async () => {
    const mine = doc(as('alice'), 'chats', CHAT, 'hidden', 'alice');
    await assertSucceeds(setDoc(mine, { uid: 'alice', ids: ['m1'] }));
    await assertFails(setDoc(mine, { uid: 'bob', ids: ['m1'] }));
    await assertFails(getDoc(doc(as('bob'), 'chats', CHAT, 'hidden', 'alice')));
  });

  it('can be listed across chats by their owner, and nobody else', async () => {
    await setDoc(doc(as('alice'), 'chats', CHAT, 'hidden', 'alice'), { uid: 'alice', ids: ['m1'] });
    await assertSucceeds(
      getDocs(query(collectionGroup(as('alice'), 'hidden'), where('uid', '==', 'alice'))),
    );
    await assertFails(
      getDocs(query(collectionGroup(as('bob'), 'hidden'), where('uid', '==', 'alice'))),
    );
  });
});

describe('starred lists', () => {
  it('belong to their owner only', async () => {
    const mine = doc(as('alice'), 'chats', CHAT, 'starred', 'alice');
    await assertSucceeds(setDoc(mine, { uid: 'alice', ids: ['m1'] }));
    await assertFails(setDoc(mine, { uid: 'bob', ids: ['m1'] }));
    await assertFails(getDoc(doc(as('bob'), 'chats', CHAT, 'starred', 'alice')));
    await assertFails(setDoc(doc(as('carol'), 'chats', CHAT, 'starred', 'carol'), { uid: 'carol', ids: [] }));
  });

  it('can be listed across chats by their owner, and nobody else', async () => {
    await setDoc(doc(as('alice'), 'chats', CHAT, 'starred', 'alice'), { uid: 'alice', ids: ['m1'] });
    await assertSucceeds(
      getDocs(query(collectionGroup(as('alice'), 'starred'), where('uid', '==', 'alice'))),
    );
    await assertFails(
      getDocs(query(collectionGroup(as('bob'), 'starred'), where('uid', '==', 'alice'))),
    );
  });
});

describe('chat preferences', () => {
  it('live on the owner-only account doc', async () => {
    const prefs = { pinned: [CHAT], muted: [CHAT], archived: [] };
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/private/account'), prefs, { merge: true }));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/private/account')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/private/account'), prefs, { merge: true }));
  });
});

/** Both members have sent, so each may see the other's shared docs. */
async function bothSpoke() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    await updateDoc(doc(db, 'chats', CHAT), { 'sent.alice': true, 'sent.bob': true });
  });
}

describe('blocking', () => {
  const message = (senderId: string) => ({
    senderId,
    ciphertext: 'abc',
    nonce: 'n',
    type: 'text',
    createdAt: serverTimestamp(),
    replyTo: null,
  });

  it('lets a member set or clear only their own block', async () => {
    const chat = doc(as('alice'), 'chats', CHAT);
    await assertSucceeds(updateDoc(chat, { 'blocked.alice': true }));
    await assertFails(updateDoc(chat, { 'blocked.bob': true }));
    // Bob cannot lift the block Alice put on him.
    await assertFails(updateDoc(doc(as('bob'), 'chats', CHAT), { 'blocked.alice': deleteField() }));
    await assertFails(updateDoc(chat, { 'blocked.alice': false }));
    await assertSucceeds(updateDoc(chat, { 'blocked.alice': deleteField() }));
    await assertFails(updateDoc(doc(as('carol'), 'chats', CHAT), { 'blocked.carol': true }));
  });

  it('stops new messages, edits and reactions from both sides', async () => {
    await setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'mine'), message('alice'));
    await updateDoc(doc(as('alice'), 'chats', CHAT), { 'blocked.alice': true });

    await assertFails(setDoc(doc(as('bob'), 'chats', CHAT, 'messages', 'b'), message('bob')));
    await assertFails(setDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'a'), message('alice')));
    await assertFails(
      updateDoc(doc(as('bob'), 'chats', CHAT, 'messages', 'm1'), {
        'reactions.bob': { ciphertext: 'sealed', nonce: 'n' },
      }),
    );
    await assertFails(
      updateDoc(doc(as('alice'), 'chats', CHAT, 'messages', 'mine'), {
        ciphertext: 'changed',
        nonce: 'n2',
        editedAt: serverTimestamp(),
      }),
    );
    // Deleting your own message for everyone still works.
    await assertSucceeds(
      updateDoc(doc(as('bob'), 'chats', CHAT, 'messages', 'm1'), {
        ciphertext: deleteField(),
        nonce: deleteField(),
        reactions: deleteField(),
        deleted: true,
        deletedAt: serverTimestamp(),
      }),
    );

    await updateDoc(doc(as('alice'), 'chats', CHAT), { 'blocked.alice': deleteField() });
    await assertSucceeds(setDoc(doc(as('bob'), 'chats', CHAT, 'messages', 'b'), message('bob')));
  });

  it('keeps the chat quiet: no preview, bump or badge, but receipts still move', async () => {
    await updateDoc(doc(as('alice'), 'chats', CHAT), { 'blocked.alice': true });
    const chat = doc(as('bob'), 'chats', CHAT);
    await assertFails(
      updateDoc(chat, {
        lastMessage: { id: 'b', senderId: 'bob', ciphertext: 'c', nonce: 'n' },
        updatedAt: serverTimestamp(),
        'unread.alice': increment(1),
        'sent.bob': true,
      }),
    );
    await assertFails(updateDoc(chat, { updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(chat, { 'unread.alice': increment(1) }));
    await assertFails(updateDoc(chat, { 'sent.bob': true }));
    await assertSucceeds(updateDoc(chat, { 'unread.bob': 0, 'lastRead.bob': serverTimestamp() }));
    await assertSucceeds(updateDoc(chat, { 'lastDelivered.bob': serverTimestamp() }));
    // A delete for everyone of the newest message fixes the preview.
    await assertSucceeds(updateDoc(chat, { lastMessage: { id: 'm1', senderId: 'bob', deleted: true } }));
  });

  it('takes the blocker\'s phone number away from the person blocked, not the reverse', async () => {
    await bothSpoke();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'users/alice/shared/contact'), { phone: null });
    });
    await assertSucceeds(getDoc(doc(as('alice'), 'users/bob/shared/contact')));

    await updateDoc(doc(as('bob'), 'chats', CHAT), { 'blocked.bob': true });
    await assertFails(getDoc(doc(as('alice'), 'users/bob/shared/contact')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/shared/contact')));
  });
});

describe('profile photo for contacts only', () => {
  const photo = { photoURL: 'https://lh3.googleusercontent.com/a/photo' };

  it('lets the owner move the photo off the public profile', async () => {
    const bob = as('bob');
    const batch = writeBatch(bob);
    batch.update(doc(bob, 'users', 'bob'), { photoURL: null, contactPhoto: true });
    batch.set(doc(bob, 'users/bob/shared/photo'), photo);
    await assertSucceeds(batch.commit());
    await assertFails(updateDoc(doc(as('bob'), 'users', 'bob'), { contactPhoto: false }));
    await assertSucceeds(updateDoc(doc(as('bob'), 'users', 'bob'), { contactPhoto: deleteField() }));
  });

  it('accepts only a photo URL, and only the known shared docs', async () => {
    await assertFails(setDoc(doc(as('bob'), 'users/bob/shared/photo'), { photoURL: 42 }));
    await assertFails(setDoc(doc(as('bob'), 'users/bob/shared/photo'), { ...photo, extra: 1 }));
    await assertFails(
      setDoc(doc(as('bob'), 'users/bob/shared/photo'), { photoURL: 'x'.repeat(2049) }),
    );
    await assertFails(setDoc(doc(as('bob'), 'users/bob/shared/other'), photo));
    await assertFails(setDoc(doc(as('alice'), 'users/bob/shared/photo'), photo));
  });

  it('shows it to contacts only, and not to someone blocked', async () => {
    await setDoc(doc(as('bob'), 'users/bob/shared/photo'), photo);
    const read = (uid: string) => getDoc(doc(as(uid), 'users/bob/shared/photo'));
    await assertSucceeds(read('bob'));
    await assertFails(read('alice'));
    await assertFails(read('carol'));

    await bothSpoke();
    await assertSucceeds(read('alice'));
    await assertFails(read('carol'));

    await updateDoc(doc(as('bob'), 'chats', CHAT), { 'blocked.bob': true });
    await assertFails(read('alice'));
  });
});

describe('server-only data', () => {
  it('keeps the push rate-limit counters away from clients', async () => {
    await assertFails(getDoc(doc(as('alice'), 'pushLimits', 'alice')));
    await assertFails(setDoc(doc(as('alice'), 'pushLimits', 'alice'), { count: 0, windowStart: 0 }));
  });

  it('keeps email sign-in codes and their limits away from clients', async () => {
    for (const client of [as('alice'), env.unauthenticatedContext().firestore() as unknown as Firestore]) {
      await assertFails(getDoc(doc(client, 'emailCodes', 'anything')));
      await assertFails(getDocs(query(collectionGroup(client, 'emailCodes'))));
      await assertFails(
        setDoc(doc(client, 'emailCodes', 'anything'), { hash: 'h', expiresAt: 0, attempts: 0 }),
      );
      await assertFails(getDoc(doc(client, 'emailCodeLimits', 'anything')));
      await assertFails(setDoc(doc(client, 'emailCodeLimits', 'anything'), { count: 0 }));
    }
  });

  it('keeps private docs owner-only', async () => {
    await assertFails(getDoc(doc(as('carol'), 'users/alice/private/account')));
    await assertFails(getDoc(doc(as('carol'), 'users/alice/private/recovery')));
  });
});
