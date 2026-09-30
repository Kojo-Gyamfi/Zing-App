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
  createdAt: Timestamp;
};

/** users/{uid}/private/account -- readable by its owner and the push route only. */
export type AccountDoc = {
  pushTokens: string[];
};

/** users/{uid}/shared/contact -- readable by its owner and anyone they have a chat with. */
export type ContactDoc = {
  phone: string | null;  // optional; mirrored as a phones/{phone} claim for discovery
};

export type PhoneDoc = {
  uid: string;
};

export type UsernameDoc = {
  uid: string;
};

export type ChatDoc = {
  members: string[];
  lastMessage: {
    /** Lets an edit or delete of the newest message fix the preview too. */
    id?: string;
    senderId: string;
    /** Absent once the message has been deleted for everyone. */
    ciphertext?: string;
    nonce?: string;
    deleted?: boolean;
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
  /** Both removed when the sender deletes for everyone -- nothing is left to decrypt. */
  ciphertext?: string;
  nonce?: string;
  type: 'text';
  createdAt: Timestamp;
  /** Id of the quoted message. Only the id: the quote is rendered from local plaintext. */
  replyTo: string | null;
  editedAt?: Timestamp;
  deleted?: boolean;
};

/** Senders may edit for this long after sending, like WhatsApp. Mirrored in firestore.rules. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** A message after local decryption -- never persisted in this form. */
export type DecryptedMessage = {
  id: string;
  senderId: string;
  /** Null when this device cannot decrypt: renders a placeholder, not a crash. */
  text: string | null;
  createdAt: Date | null;
  replyTo: string | null;
  edited: boolean;
  deleted: boolean;
  /** True while the write is still in flight -- drives the clock icon. */
  pending: boolean;
  /** The server refused the write. Held in memory only, so it can be retried. */
  failed?: boolean;
};
