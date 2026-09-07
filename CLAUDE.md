# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

**Zing** — an end-to-end encrypted chat app. Next.js 16 (App Router) + Firebase, deployed on Vercel.

The security claim is load-bearing and shapes most design decisions: the server, Google, and the
project owner can never read message content. Any change that would put plaintext where a server can
see it breaks the product's core promise, not just a feature.

## Commands

```bash
npm run dev          # dev server (Turbopack)
npm run build        # production build — also runs a full typecheck
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run test:watch

npx vitest run -t "restores the private key"   # one test by name
npx vitest run lib/crypto/crypto.test.ts       # one file

firebase deploy --only firestore,database      # deploy security rules + indexes
```

Requires `.env.local` (see `.env.local.example`). Without it the app builds and SSRs fine but
throws on the client the moment Firebase initialises.

## Architecture

### Next.js is not in the messaging path

```
browser ──live listener──► Firestore          ciphertext only
browser ──► /api/push/send ──► FCM ──► recipient's service worker (decrypts locally)
```

Phones talk **directly** to Firestore. Vercel is serverless and cannot hold sockets, so there is no
chat server to add logic to — realtime behaviour comes from `onSnapshot`, and anything that must
happen on a message arriving belongs in a listener, not on the server. The only privileged server
code is `app/api/push/send/route.ts`, which forwards ciphertext it cannot read.

### The crypto layering

Three levels, in `lib/crypto/`:

1. **Identity** — X25519 keypair per user. Private half in IndexedDB (`vault.ts`), never transmitted
   in the clear. Public half in `users/{uid}.publicKey`.
2. **Conversation key** — one symmetric key per chat, sealed to each member with `crypto_box_seal`
   and stored at `chats/{chatId}/keys/{uid}`. Sealed boxes are why group support is a drop-in later:
   seal the same key to one more public key.
3. **Messages** — `crypto_secretbox_easy` under the conversation key.

Plus **backup**: the private key wrapped with Argon2id over the user's passphrase, stored in
Firestore. Argon2 parameters travel with the blob so they can be raised without orphaning old
backups.

**`lib/crypto/envelope.ts` is the only place a message body may be sealed or opened.** If plaintext
ever reaches Firestore it will be because something bypassed that file. Keep it that way.

`lib/crypto/sodium.ts` loads **libsodium-wrappers-sumo**, not the standard build — the standard one
omits `crypto_pwhash` and reports it as `undefined` rather than throwing, so passphrase backup fails
silently. The service worker uses the smaller standard build (`public/vendor/`) because it only opens
boxes and never derives a key.

### Session has two independent axes

`lib/store/session.ts` — an account without a device key is a normal state, not an error:

| status | meaning | route |
|---|---|---|
| `signedOut` | no Firebase user | `/login` |
| `needsProfile` | account, no Zing profile | `/onboarding` |
| `locked` | profile, but no key on this device | `/unlock` |
| `ready` | both present | app |

`locked` happens on a new phone, cleared storage, or Safari evicting IndexedDB after ~7 days.
The session also rejects a local key whose derived public key disagrees with the registered one,
rather than letting every decryption fail mysteriously.

### Two databases, on purpose

- **Firestore** — anything that must last. Persistent local cache is on, which is what gives offline
  reads and queued sends.
- **Realtime Database** (`lib/db/presence.ts`) — typing and presence only. It is the only one with
  `onDisconnect()`, so it is the only way to notice a phone going to sleep. These are unencrypted
  booleans and timestamps by design.

### Conventions worth not breaking

- **Chat ids are deterministic**: `[uidA, uidB].sort().join('_')`. The same pair can never get two
  conversations, and the peer is derivable from the id with no lookup.
- **Receipts are timestamps on the chat doc**, not per-message fields — `lastRead` and
  `lastDelivered` mean one write per event instead of one per message. Ticks are derived in
  `components/chat/Ticks.tsx#tickState`.
- **`ensureDirectChat` writes the chat doc before the key docs, deliberately.** Rules on
  `keys/{uid}` call `get()` on the parent chat, and inside a batch that `get()` sees pre-commit
  state — one batch would be rejected by its own rules.
- **Push is data-only.** A `notification` block would be rendered by the browser before the service
  worker runs, putting ciphertext on someone's lock screen.
- **Sealed conversation keys are cached to IndexedDB** so `public/sw.js` can decrypt notification
  previews with no network. Unsealed keys stay in memory (`lib/store/keys.ts`) and never touch disk.
- Chat components are client components; live listeners only exist in a browser.

### Security rules are the authorization layer

`firestore.rules` and `database.rules.json`. Browsers talk straight to the database, so anything not
forbidden there is public. Changing the data model means changing the rules in the same pass.

## Verifying a change

`npm test` covers crypto round-trips, passphrase recovery on a simulated fresh device, and safety
numbers. Beyond that, the check that actually validates the product: send a message, open Firestore
in the Firebase Console, and confirm the `ciphertext` field is unreadable.

Other manual checks live in README.md ("Testing it works").

## Out of scope for v1

Encrypted media, group chats, voice/video calls, forward secrecy (one key per conversation, not per
message), server-side search, contact discovery (browsers cannot read a phone's contacts).
