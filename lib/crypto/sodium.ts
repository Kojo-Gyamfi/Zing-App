type Sodium = typeof import('libsodium-wrappers-sumo')['default'];

let pending: Promise<Sodium> | null = null;

/**
 * libsodium, loaded once per context (page, worker, test).
 *
 * The *-sumo* build, deliberately: the standard build ships without
 * crypto_pwhash, and Argon2id is what protects the passphrase-wrapped key
 * backup sitting in Firestore. Verified at install time -- standard reports
 * crypto_pwhash as undefined rather than throwing, so a wrong choice here
 * would have failed silently at onboarding.
 *
 * Dynamically imported so ~500 KB of WASM stays out of the first paint;
 * it is pulled in when a user actually signs in or opens a chat.
 *
 * The service worker uses the smaller standard build instead -- it only ever
 * opens a secretbox to decrypt a notification preview, never derives a key.
 */
export function getSodium(): Promise<Sodium> {
  if (!pending) {
    pending = import('libsodium-wrappers-sumo')
      .then(async (module) => {
        const sodium = module.default;
        await sodium.ready;
        return sodium;
      })
      .catch((cause: unknown) => {
        // Not cached: a chunk that failed to load (offline launch of the
        // installed app) would otherwise fail every decrypt until a reload.
        pending = null;
        throw cause;
      });
  }
  return pending;
}
