import { describe, it, expect } from 'vitest';
import { generateIdentity, publicKeyFrom, matchesPublicKey } from './identity';
import { seal, open } from './envelope';
import { wrapPrivateKey, unwrapPrivateKey } from './backup';
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
  isWellFormedRecoveryKey,
  wrapWithRecoveryKey,
  unwrapWithRecoveryKey,
} from './recovery';
import { toB64 } from './codec';
import { createConversationKey, sealConversationKey, openConversationKey } from './chat';
import { safetyNumber, keyFingerprint } from './safetyNumber';

describe('message envelopes', () => {
  it('round-trips a message', async () => {
    const key = await createConversationKey();
    const envelope = await seal('on my way', key);

    expect(envelope.ciphertext).not.toContain('on my way');
    expect(await open(envelope, key)).toBe('on my way');
  });

  it('produces a different ciphertext each time (fresh nonce)', async () => {
    const key = await createConversationKey();
    const a = await seal('same text', key);
    const b = await seal('same text', key);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('returns null rather than throwing on the wrong key', async () => {
    const envelope = await seal('secret', await createConversationKey());
    expect(await open(envelope, await createConversationKey())).toBeNull();
  });

  it('rejects a tampered ciphertext', async () => {
    const key = await createConversationKey();
    const envelope = await seal('transfer 100', key);
    const flipped = { ...envelope, ciphertext: 'A' + envelope.ciphertext.slice(1) };

    expect(await open(flipped, key)).toBeNull();
  });

  it('handles emoji and non-latin text', async () => {
    const key = await createConversationKey();
    const text = 'ɛte sɛn? 🎉 مرحبا';
    expect(await open(await seal(text, key), key)).toBe(text);
  });
});

describe('passphrase backup', () => {
  it('restores the private key on a fresh device', async () => {
    const identity = await generateIdentity();
    const backup = await wrapPrivateKey(identity.privateKey, 'correct horse battery staple');

    const restored = await unwrapPrivateKey(backup, 'correct horse battery staple');
    expect(restored).toEqual(identity.privateKey);
  });

  it('lets a restored key decrypt history sealed to the original', async () => {
    const identity = await generateIdentity();
    const conversationKey = await createConversationKey();
    const sealed = await sealConversationKey(conversationKey, identity.publicKey);
    const envelope = await seal('sent before the phone was lost', conversationKey);

    // Fresh device: only the passphrase and the Firestore blobs survive.
    const backup = await wrapPrivateKey(identity.privateKey, 'my passphrase');
    const privateKey = await unwrapPrivateKey(backup, 'my passphrase');
    expect(privateKey).not.toBeNull();

    const recovered = {
      privateKey: privateKey!,
      publicKey: await publicKeyFrom(privateKey!),
    };
    const key = await openConversationKey(sealed, recovered);
    expect(key).not.toBeNull();
    expect(await open(envelope, key!)).toBe('sent before the phone was lost');
  });

  it('fails cleanly on the wrong passphrase', async () => {
    const identity = await generateIdentity();
    const backup = await wrapPrivateKey(identity.privateKey, 'right');

    expect(await unwrapPrivateKey(backup, 'wrong')).toBeNull();
  });

  it('stores the Argon2 parameters alongside the blob', async () => {
    const identity = await generateIdentity();
    const backup = await wrapPrivateKey(identity.privateKey, 'pass');

    expect(backup.opslimit).toBeGreaterThan(0);
    expect(backup.memlimit).toBeGreaterThan(0);
    expect(backup.salt).toBeTruthy();
  });
});

describe('recovery key', () => {
  it('is 24 Crockford characters in groups of four', async () => {
    const key = await generateRecoveryKey();

    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeRecoveryKey(key)).toHaveLength(24);
    expect(isWellFormedRecoveryKey(key)).toBe(true);
  });

  it('is different every time', async () => {
    expect(await generateRecoveryKey()).not.toBe(await generateRecoveryKey());
  });

  it('forgives case, spacing, missing dashes and lookalike letters', () => {
    const canonical = '0123ABCD1111EFGH0000JKMN';

    expect(normalizeRecoveryKey('0123-ABCD-1111-EFGH-0000-JKMN')).toBe(canonical);
    expect(normalizeRecoveryKey('0123abcd1111efgh0000jkmn')).toBe(canonical);
    expect(normalizeRecoveryKey(' 0123 abcd 1111 efgh 0000 jkmn ')).toBe(canonical);
    expect(normalizeRecoveryKey('0123-ABCD-ILi1-EFGH-oOO0-JKMN')).toBe(canonical);
  });

  it('rejects malformed input before any key derivation', () => {
    expect(isWellFormedRecoveryKey('ABCD-EFGH')).toBe(false);
    expect(isWellFormedRecoveryKey('0123-ABCD-1111-EFGH-0000-JKMU')).toBe(false);
  });

  it('restores history on a fresh device from a messily typed copy', async () => {
    const identity = await generateIdentity();
    const conversationKey = await createConversationKey();
    const sealed = await sealConversationKey(conversationKey, identity.publicKey);
    const envelope = await seal('written before the passphrase was forgotten', conversationKey);

    const recoveryKey = await generateRecoveryKey();
    const backup = await wrapWithRecoveryKey(identity.privateKey, recoveryKey);

    const typed = ` ${recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')} `;
    const privateKey = await unwrapWithRecoveryKey(backup, typed);
    expect(privateKey).toEqual(identity.privateKey);
    expect(await matchesPublicKey(privateKey!, await toB64(identity.publicKey))).toBe(true);

    const key = await openConversationKey(sealed, {
      privateKey: privateKey!,
      publicKey: await publicKeyFrom(privateKey!),
    });
    expect(await open(envelope, key!)).toBe('written before the passphrase was forgotten');
  });

  it('returns null for the wrong recovery key', async () => {
    const identity = await generateIdentity();
    const backup = await wrapWithRecoveryKey(identity.privateKey, await generateRecoveryKey());

    expect(await unwrapWithRecoveryKey(backup, await generateRecoveryKey())).toBeNull();
  });

  it('refuses a key that belongs to a different account', async () => {
    const mine = await generateIdentity();
    const theirs = await generateIdentity();

    expect(await matchesPublicKey(theirs.privateKey, await toB64(mine.publicKey))).toBe(false);
  });

  it('after a passphrase change, the old passphrase fails and the new one works', async () => {
    const identity = await generateIdentity();
    const before = await wrapPrivateKey(identity.privateKey, 'old passphrase');
    expect(await unwrapPrivateKey(before, 'old passphrase')).toEqual(identity.privateKey);

    // Re-wrapped from the key this device holds; the stored backup is replaced.
    const after = await wrapPrivateKey(identity.privateKey, 'brand new passphrase');
    expect(await unwrapPrivateKey(after, 'old passphrase')).toBeNull();
    expect(await unwrapPrivateKey(after, 'brand new passphrase')).toEqual(identity.privateKey);
  });
});

describe('conversation keys', () => {
  it('opens for every sealed member and nobody else', async () => {
    const nana = await generateIdentity();
    const kwame = await generateIdentity();
    const outsider = await generateIdentity();

    const conversationKey = await createConversationKey();
    const forNana = await sealConversationKey(conversationKey, nana.publicKey);
    const forKwame = await sealConversationKey(conversationKey, kwame.publicKey);

    expect(await openConversationKey(forNana, nana)).toEqual(conversationKey);
    expect(await openConversationKey(forKwame, kwame)).toEqual(conversationKey);
    expect(await openConversationKey(forNana, outsider)).toBeNull();
  });

  it('carries a message end to end between two identities', async () => {
    const nana = await generateIdentity();
    const kwame = await generateIdentity();

    const conversationKey = await createConversationKey();
    const sealedForKwame = await sealConversationKey(conversationKey, kwame.publicKey);
    const envelope = await seal('meet me at 6', conversationKey);

    const kwamesKey = await openConversationKey(sealedForKwame, kwame);
    expect(await open(envelope, kwamesKey!)).toBe('meet me at 6');

    void nana;
  });
});

describe('safety numbers', () => {
  it('matches on both sides regardless of argument order', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();

    expect(await safetyNumber(a.publicKey, b.publicKey)).toBe(
      await safetyNumber(b.publicKey, a.publicKey),
    );
  });

  it('differs for a different pair', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const impostor = await generateIdentity();

    expect(await safetyNumber(a.publicKey, b.publicKey)).not.toBe(
      await safetyNumber(a.publicKey, impostor.publicKey),
    );
  });

  it('renders 12 groups of 5 digits', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const number = await safetyNumber(a.publicKey, b.publicKey);

    expect(number.split(' ')).toHaveLength(12);
    expect(number).toMatch(/^(\d{5} ){11}\d{5}$/);
  });

  it('fingerprints an identity stably', async () => {
    const identity = await generateIdentity();
    expect(await keyFingerprint(identity.publicKey)).toBe(
      await keyFingerprint(identity.publicKey),
    );
  });
});
