# Security and privacy notes

## Constraints identified during design

1. **`gmail.readonly` is a restricted scope.** Keep the OAuth app in *Testing* with yourself as test user. Publishing would require Google verification plus a yearly security assessment.
2. **No backend means no refresh tokens.** A browser-only app can't keep a client secret, so it uses the Google Identity Services *token model*: short-lived (~1 h) access tokens, no refresh tokens, consent re-prompted after expiry (and every 7 days in Testing mode).
3. **iOS Safari blocks popups that aren't opened directly from a tap.** The Google library is pre-loaded so the Connect tap opens the consent popup synchronously.
4. **GitHub Pages can't set HTTP security headers.** The CSP is injected as a `<meta>` tag at build time (`frame-ancestors` can't be set that way; the app has no sensitive UI that is useful to clickjack without your own Google session).
5. **Browser storage is not durable or encrypted at rest by the app.** It is protected by the OS/browser profile (iOS encrypts app data when the device is locked). Anyone with access to your unlocked browser profile can read it — same as your Gmail session.
6. **Bank email formats are undocumented and change.** Parsers are template-based with tests; unknown formats are surfaced for review instead of guessed.

## Controls in the code

| Risk | Control |
|---|---|
| Token leakage | Token in memory plus `sessionStorage` (this tab/app window only, wiped when it closes, ~1 h expiry) so a refresh doesn't force a new sign-in; never in localStorage, IndexedDB, URLs or logs. A localStorage flag records only that consent was given, so later sign-ins skip the consent page; `Authorization` header only to `gmail.googleapis.com`; `referrerPolicy: no-referrer`; revoked on Disconnect / Clear all. |
| Secrets in repo | Only the public client ID is used, from a GitHub *variable* or entered at runtime. CI fails if `GOCSPX-`/`client_secret` appears in the build. |
| Email content at rest | Bodies are parsed in memory and discarded. Stored: parsed fields; the counterparty's name, UPI ID and account last 4; the single sentence describing the transaction (9+ digit numbers masked; balance and helpline text trimmed); the subject line (truncated); Gmail message IDs. For bank emails no template matched: sender, subject and date only. |
| Full card / account numbers | Only last 4 digits are kept; 9+ digit runs in merchant text are masked. Backups are sanitised on import. |
| OTPs | Emails that look like OTP/verification messages are skipped before parsing. |
| Phishing / spoofed alerts | Sender domain must exactly match (or be a subdomain of) a bank's domain; look-alikes such as `hdfcbank-secure.com` or `hdfcbank.net.evil.com` are rejected. Messages whose `Authentication-Results` show SPF/DKIM/DMARC failure are marked low confidence. |
| Third-party code | Runtime deps: React + React DOM only. No CDN assets. CSP limits scripts to self + `accounts.google.com/gsi/client`. |
| Service-worker caching | SW ignores all cross-origin requests and anything with an `Authorization` header; caches only same-origin app files. |
| CSV formula injection | Cells beginning with `= + - @` are prefixed with `'`. |
| HTML email rendering | Email HTML is converted to text with string operations; it is never inserted into the DOM, so no remote images/scripts load. |
| Source exposure | Production build has no source maps (CI checks). |

## Settings sync (Google Drive app folder)

- Uses the `drive.appdata` scope: a hidden per-app folder in the user's own Drive. The app cannot list or read any other Drive file, and the folder is invisible in the Drive UI.
- Stored there: rules (patterns, payee nicknames, categories), own-account identifiers, card-bill card last-4s, and per-transaction user decisions keyed by Gmail message id (category, type, note, excluded, duplicate decision, removed). **No amounts, dates, merchants or email text.**
- The file is validated on read (unknown categories/kinds dropped, sizes capped) because it is user-controlled data.
- Off switch and "Delete Drive copy" in Settings. "Clear all local data" doesn't touch the Drive copy.

## Things to review yourself

- The GitHub Actions workflow uses official `actions/*` actions only. Pin them to commit SHAs if you want stronger supply-chain guarantees.
- Run `npm audit` after installing and commit `package-lock.json`.
- Consider enabling 2-step verification / passkeys on the Google account you connect.
