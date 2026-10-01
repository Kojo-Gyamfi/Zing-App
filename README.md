# Zing

Fast, lively, end-to-end encrypted chat. Next.js + Firebase, deployed on Vercel.

Messages are sealed on the sender's device and opened on the recipient's. Firestore
stores ciphertext, and no key that opens it exists on any server — including ours.
That is a design commitment, not a setting: there is no recovery path we can offer
a user who loses their passphrase.

---

## 1. Create the Firebase project

Two of these are effectively permanent, so get them right the first time.

1. **Create a project** at <https://console.firebase.google.com>.

2. **Firestore → Create database.**
   Choose location **`europe-west1`**.
   ⚠️ **This can never be changed.** Fixing it later means deleting the project and
   starting over. From Ghana it saves roughly 100 ms on every single message
   compared with the US default.

3. **Realtime Database → Create database**, same region. Used only for typing
   indicators and online status.

4. **Authentication → Sign-in method → enable Google.**

5. **Project settings → General → Your apps → Web app.** Copy the config values
   into `.env.local` (see below).

6. **Project settings → Cloud Messaging → Web configuration → Generate key pair.**
   That is your VAPID key.

7. **Project settings → Service accounts → Generate new private key.** Downloads a
   JSON file, used by the push route. Never commit it.

## 2. Configure

```bash
npm install
npm run setup
```

It asks for the `firebaseConfig` block, the Realtime Database URL, the VAPID key,
and the path to the service account file — then writes `.env.local`, flattening
the service account JSON onto the single line dotenv requires.

To do it by hand instead, copy `.env.local.example` and fill it in. The
`NEXT_PUBLIC_*` values are public by design: they identify the project and
authorize nothing. `FIREBASE_SERVICE_ACCOUNT` is the one real secret.

Two optional extras, each off until its key is set:

- **App Check** (`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`): Firebase only answers
  requests from the real app. Register a reCAPTCHA v3 key under App Check →
  Apps, set the variable, then turn on **enforcement** for Firestore, Realtime
  Database and Authentication. For localhost/ngrok, register the debug token the
  browser console prints on first load (App Check → Manage debug tokens).
- **Sentry** (`NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN`): error reports, and
  nothing else — no breadcrumbs, inputs, request bodies or user data, so message
  text can never reach it.

## 3. Deploy the security rules

The rules **are** the authorization layer: browsers talk straight to Firestore, so
anything not forbidden there is public.

```bash
npm install -g firebase-tools
firebase login
firebase use --add                      # pick your project
firebase deploy --only firestore,database
```

## 4. Run it

```bash
npm run dev
```

## 5. Deploy

Push to GitHub, import the repo at <https://vercel.com/new>, and paste the same
environment variables in.

Then — and this catches everyone — add your `*.vercel.app` domain under
**Firebase → Authentication → Settings → Authorized domains**, or sign-in fails
in production with no visible error.

---

## Testing it works

```bash
npm test             # crypto, recovery keys, phone numbers, receipts
npm run test:rules   # every Firestore security rule, on the emulator
npm run test:e2e     # two browsers: sign up, chat, edit, delete, unlock, delete account
npm run build        # typecheck + production build
```

`test:rules` and `test:e2e` run against the Firebase Emulator Suite, never the
real project, and need Java 21 (`winget install Microsoft.OpenJDK.21`, or
`brew install openjdk@21`). Run `npx playwright install chromium` once before
the first `test:e2e`. GitHub Actions runs all of the above on every push
(`.github/workflows/ci.yml`).

The manual checks that matter:

- **Encryption is real.** Send a message, then open Firestore in the Firebase
  Console. The `ciphertext` field must be unreadable. If you can read it, stop.
- **Recovery.** DevTools → Application → clear IndexedDB → reload. Zing should ask
  for the passphrase, then decrypt the full history. "Forgot your passphrase?"
  with the recovery key must work too.
- **Two devices.** Two Google accounts in two browser profiles: messages arrive
  live, ticks fill in, typing shows, presence flips when one closes.
- **Offline.** Airplane mode → send → the message queues → reconnect → it goes.
- **Install.** Android shows an install prompt; on iPhone use Share → Add to Home
  Screen, then confirm a notification arrives with **decrypted** preview text.

---

## How it fits together

```
  browser  ──────────────►  Firestore        live listener channel; ciphertext only
     │                                       Next.js is not in this path
     │
     └──────►  /api/push/send  ──►  FCM  ──►  recipient's service worker
                (forwards ciphertext             decrypts locally, then shows
                 it cannot read)                 the notification
```

| Path | What it is |
|---|---|
| `lib/crypto/` | All cryptography. `envelope.ts` is the only place message bodies are sealed or opened |
| `lib/db/` | Firestore and RTDB access |
| `lib/store/` | Session, conversation-key cache, profile cache |
| `firestore.rules` | The real authorization layer |
| `public/sw.js` | Offline shell + local decryption of push previews |

### Crypto, briefly

- **Identity** — X25519 keypair per user. Private half lives in IndexedDB and is
  never transmitted in the clear.
- **Backup** — private key wrapped with Argon2id over the user's passphrase, stored
  in Firestore. Useless without the passphrase.
- **Conversations** — one XSalsa20-Poly1305 key per chat, sealed to each member's
  public key with `crypto_box_seal`. Adding a group member later is one more seal.
- **Verification** — safety numbers let two people confirm out of band that no key
  was substituted in transit.

Known limits, stated plainly: no forward secrecy (one key per conversation, not per
message); metadata — who talks to whom and when — is visible to the server; search
only covers messages already decrypted on the device.

### Deliberate choices worth knowing

- **libsodium-wrappers-sumo** in the app, not the standard build: the standard one
  omits `crypto_pwhash` and reports it as `undefined` rather than throwing, so the
  passphrase backup would have failed silently. The service worker uses the smaller
  standard build, since it only opens boxes.
- **Two databases.** Firestore for what must last; Realtime Database for typing and
  presence, because only RTDB has `onDisconnect()` and Firestore has no way to
  notice a phone going to sleep.
- **Receipts are timestamps, not per-message fields.** `lastRead` and
  `lastDelivered` on the chat document mean one write per event rather than one per
  message.
- **Push is data-only.** A `notification` block would be rendered by the browser
  before the service worker runs, putting ciphertext on the lock screen.

## Not in v1

Encrypted media, group chats, voice and video calls, forward secrecy, server-side
search, contact discovery (browsers cannot read a phone's contacts), App Store
distribution.
