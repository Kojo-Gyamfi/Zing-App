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
npm test             # vitest run (unit tests only)
npm run test:watch
npm run test:rules   # Firestore rules on the emulator (needs Java 21)
npm run test:e2e     # Playwright, two browsers, against the emulators (needs Java 21)

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
- **Other per-member state on the chat doc follows the receipt pattern**: `unread.{uid}` (sender adds
  exactly 1, reader resets their own to 0) and `sent.{uid}` (true once you have sent; both true is
  what lets each see the other's phone number). The rules hold each member to their own key.
- **A new chat doc starts empty** — the create rule refuses any `sent`, receipts, badge or preview,
  or one member could pre-claim things about the other.
- **Hidden ("Delete for me") and starred lists carry a `uid` field** so one collection-group query
  fetches all of one user's lists (the chat list for hidden, the Starred screen for starred). Both are
  ids only, at `chats/{chatId}/hidden|starred/{uid}`, private to their owner.
- **Reactions are sealed like message bodies**: `messages/{id}.reactions.{uid}` holds an envelope
  from `envelope.ts`, never a bare emoji. The rules let any member write only their own entry, and
  "delete for everyone" removes reactions with the ciphertext.
- **Pin, mute and archive live on `users/{uid}/private/account`** next to the push tokens, because the
  push route already reads that doc: a muted chat is skipped there at no extra read. Mute must never
  be done in the service worker — browsers revoke push from a worker that shows nothing.
- **The account doc has one listener for the whole app** (`lib/store/account.ts`), started by the
  session: prefs, privacy settings, the block list and a hidden own photo all come from it. Screens
  read the store; they do not listen to the doc themselves.
- **Privacy settings work by not publishing**, never by asking other clients to look away: read
  receipts off means `lastRead` is never written (the badge is cleared with `unread.{uid}` alone, and
  the list's unread state follows that counter); last seen off means no RTDB presence node exists.
  Hiding either also hides other people's from you, as on WhatsApp. That half is only client courtesy.
- **A contacts-only photo moves off the public profile**: `users/{uid}.photoURL` becomes null with
  `contactPhoto: true`, and the photo goes to `users/{uid}/shared/photo`, which has the same audience
  as the phone number. The owner's copy stays on the account doc.
- **Blocking is `blocked.{uid}` on the chat doc**, so the message rules check it with the `get()`
  they already make (no extra billed read). While either flag is set, nothing new can be sent:
  no messages, edits, reactions, preview, bump or badge. Deleting for everyone still works. The block
  also hides the blocker's shared docs from the person blocked. `private/account.blocked` mirrors
  the list for Settings, written in the same batch.
- **Disappearing messages are cleaned up by clients** (TTL policies need billing, so they aren't on
  Spark). The timer is `disappearing` on the chat doc. Each message carries `expiresAt` from the
  sender's clock, and so does its preview. Every device hides expired messages. Any member may then
  **hard-delete** one: the only real message delete the rules allow, and only after `expiresAt`.
  Either member may also strip an expired preview's ciphertext. Each sender's device sweeps its own
  expired messages once a session (`sweepExpiredMessages`, a collection-group query with its own
  index and list rule).
- **Drafts live in localStorage only** (`lib/store/drafts.ts`), are never synced, and are wiped on
  sign-out.
- **Link previews never fetch anything.** The card is built from the URL in the decrypted text
  (`lib/links.ts`). Fetching the page would need a server that learns every link sent.
- **Forwarding re-seals plaintext under the target chat's key**; nothing links the two conversations.
  The copy carries `forwarded: true` for the label — metadata like `replyTo`, set only at send time.
- **The open thread takes its receipts from the chat list's listener** (`lib/store/chats.ts`) rather
  than listening to the chat doc itself — two listeners on one doc bill every receipt twice.
- **A key doc can appear after its chat** (see above), so anything that loads a conversation key
  must cope with "not yet" — `useThread` watches for it with `onConversationKeyReady`.
- **Optional services are env-gated**: App Check (`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`) and Sentry
  (`NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN`) do nothing until set, and the CSP in `proxy.ts` only
  opens their hosts then. Sentry is configured in `lib/monitoring.ts` to send errors only — never
  breadcrumbs, inputs or request bodies.
- Chat components are client components; live listeners only exist in a browser.

### Security rules are the authorization layer

`firestore.rules` and `database.rules.json`. Browsers talk straight to the database, so anything not
forbidden there is public. Changing the data model means changing the rules in the same pass — and
adding a case to `tests/rules/firestore.test.ts`.

## Verifying a change

`npm test` covers crypto round-trips, passphrase and recovery-key restore on a simulated fresh
device, phone normalization and receipts. `npm run test:rules` proves the rules allow the app and
refuse a hand-rolled client. `npm run test:e2e` drives the whole product in two browsers. CI runs all
of them. Beyond that, the check that actually validates the product: send a message, open Firestore
in the Firebase Console, and confirm the `ciphertext` field is unreadable.

Other manual checks live in README.md ("Testing it works").

## Out of scope for v1

Encrypted media, group chats, voice/video calls, forward secrecy (one key per conversation, not per
message), server-side search (search inside a chat runs over plaintext on the device, `lib/search.ts`),
contact discovery (browsers cannot read a phone's contacts).
