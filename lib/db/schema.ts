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

/**
 * users/{uid}/private/account -- readable by its owner and the push route only.
 *
 * The chat preferences live here rather than in a doc of their own because
 * the push route already reads this doc for every message: it skips a muted
 * chat at no extra read, and does not push at all rather than leave the
 * service worker to swallow it (browsers revoke push from a worker that
 * receives pushes and shows nothing).
 */
export type AccountDoc = {
  pushTokens: string[];
  /** Chat ids shown at the top of the list, at most MAX_PINNED. */
  pinned?: string[];
  /** Chat ids that get no push notifications. */
  muted?: string[];
  /** Chat ids moved out of the main list into "Archived". */
  archived?: string[];
};

/** Like WhatsApp: pinning is for the few chats that matter most. */
export const MAX_PINNED = 3;

/**
 * users/{uid}/private/recovery -- owner-only. The private key wrapped a second
 * time, under the recovery key the user wrote down. Absent on accounts created
 * before recovery keys existed, until they make one in Settings.
 */
export type RecoveryDoc = {
  backup: KeyBackup;
  createdAt: Timestamp;
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
  /**
   * Messages each member has not opened yet: the sender adds one, the reader
   * resets their own to zero. Absent on chats from before the badge existed.
   */
  unread?: Record<string, number>;
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
  /**
   * Sent with Forward rather than typed. Metadata like replyTo: the server
   * sees that a message was forwarded, never what it says or where from.
   */
  forwarded?: boolean;
  editedAt?: Timestamp;
  deleted?: boolean;
  /**
   * One reaction per member, keyed by uid. The emoji is sealed under the
   * conversation key like a message body, so the server sees only that
   * someone reacted, never with what.
   */
  reactions?: Record<string, { ciphertext: string; nonce: string }>;
};

/**
 * chats/{chatId}/hidden/{uid} ("Delete for me") and chats/{chatId}/starred/{uid}.
 * `uid` repeats the doc id so one collection-group query finds all of a
 * person's lists.
 */
export type MessageListDoc = {
  uid: string;
  ids: string[];
};

/** Longest reaction accepted, in UTF-16 units: one emoji with modifiers. */
export const MAX_REACTION_LENGTH = 16;

/** Senders may edit for this long after sending, like WhatsApp. Mirrored in firestore.rules. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Longest message, in UTF-16 units (what a textarea's maxLength counts). At
 * worst 3 bytes per unit, sealed and base64'd that is ~16,000 characters of
 * ciphertext; firestore.rules caps ciphertext at 22,000 (MAX_CIPHERTEXT), so
 * any 4,000-unit message fits with room to spare.
 */
export const MAX_MESSAGE_LENGTH = 4000;

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
  /** Decrypted reactions, uid -> emoji. Ones that fail to open are left out. */
  reactions?: Record<string, string>;
  /** Shows the "Forwarded" label. */
  forwarded?: boolean;
  /** The server refused the write. Held in memory only, so it can be retried. */
  failed?: boolean;
};
