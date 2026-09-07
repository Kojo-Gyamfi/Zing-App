/** An encrypted blob as it is stored in Firestore. */
export type Envelope = {
  ciphertext: string;
  nonce: string;
};

/**
 * The private key, wrapped by a passphrase-derived key.
 * Safe to store server-side: useless without the passphrase.
 *
 * Argon2id parameters travel with the blob so that raising them later
 * never orphans an existing backup.
 */
export type KeyBackup = Envelope & {
  salt: string;
  opslimit: number;
  memlimit: number;
};

export type Identity = {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};
