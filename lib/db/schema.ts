import type { Timestamp } from 'firebase/firestore';
import type { KeyBackup } from '@/lib/crypto/types';

/**
 * Firestore document shapes.
 *
 * Everything here is metadata and therefore readable by the server. Message
 * bodies live in `ciphertext`/`nonce` pairs and are opaque. That split is the
 * whole security model: Zing hides what was said, not who said it to whom.
 */

export type UserDoc = {
  uid: string;
  displayName: string;
  username: string;      // lowercase, unique, immutable
  photoURL: string | null;
  about: string;
  publicKey: string;     // base64 X25519
  keyBackup: KeyBackup;  // Argon2id-wrapped private key; useless without the passphrase
  phone: string | null;  // optional, discovery only
  pushTokens: string[];
  createdAt: Timestamp;
};

export type UsernameDoc = {
  uid: string;
};

export type ChatDoc = {
  members: string[];
  lastMessage: {
    ciphertext: string;
    nonce: string;
    senderId: string;
  } | null;
  updatedAt: Timestamp;
  /** Ticks derive from these two. One write per event, never one per message. */
  lastRead: Record<string, Timestamp>;
  /** Written by the recipient the moment a message reaches their device. */
  lastDelivered: Record<string, Timestamp>;
  createdAt: Timestamp;
};

export type ConversationKeyDoc = {
  sealed: string; // conversation key, sealed to one member's public key
};

export type MessageDoc = {
  senderId: string;
  ciphertext: string;
  nonce: string;
  type: 'text';
  createdAt: Timestamp;
  replyTo: string | null;
};

/** A message after local decryption -- never persisted in this form. */
export type DecryptedMessage = {
  id: string;
  senderId: string;
  /** Null when this device cannot decrypt: renders a placeholder, not a crash. */
  text: string | null;
  createdAt: Date | null;
  replyTo: string | null;
  /** True while the write is still in flight -- drives the clock icon. */
  pending: boolean;
};
