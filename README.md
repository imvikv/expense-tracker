# Personal Expense Tracker

A private, single-user expense tracker that reads **HDFC, ICICI, Axis and HSBC India** transaction alerts from your Gmail and turns them into a spending dashboard — entirely inside your browser.

- **No backend, no database server, no analytics, no AI APIs.** Static files on GitHub Pages; your browser talks only to Google.
- **Read-only Gmail access**, token held in memory only.
- **Email bodies are never stored.** Only parsed fields go into IndexedDB on your device: date, amount, merchant, who you paid (name, UPI ID, their account's last 4), the one-sentence bank description with long numbers masked, the email subject, your card/account last 4 and the Gmail message ID.
- Works in Safari on iPhone (add to Home Screen for an app-like experience) and any modern desktop browser.

Live URL (after deploying): **https://imvikv.github.io/expense-tracker/**

---

## Features

| Area | What it does |
|---|---|
| Gmail sync | Searches only bank sender domains + transaction wording; first sync covers 12 months (configurable), later syncs fetch only new mail; custom date ranges; pagination, rate-limit back-off, resumable (progress is saved as it goes). |
| Parsing | Separate HDFC / ICICI / Axis / HSBC template parsers for credit card, debit card, UPI, account debit/credit, NEFT/IMPS, ATM, refunds/reversals, card bill payments and bank fees, with a low-confidence generic fallback. Ignores OTPs, declined transactions, promotions and look-alike sender domains. Mail that fails DMARC/DKIM is downgraded to low confidence. |
| Accuracy | Amounts stored as integer paise. Card bill payments (incl. via CRED), transfers, income and investments are kept out of spending; refunds reduce it. Duplicate detection: same UPI ref/RRN → hidden as duplicate (reversible); same amount on the same card/merchant within 15 min → flagged for you to decide. Nothing ambiguous is merged automatically. |
| Categories | 85 built-in Indian merchant rules (Swiggy, Zomato, Blinkit, Zepto, Uber, Ola, Netflix, Amazon, Flipkart…), your own text or `/regex/` rules, “always use this for <merchant>” from any transaction, re-applied to history (manual edits are never overwritten). |
| Payees | Every transaction records who was paid: name as the bank wrote it, UPI ID, counterparty account (last 4), city when given, the bank's own one-line description and the email subject. Payees are tagged person / business / your own account (bank P2A/P2M markers, merchant-QR UPI IDs, name heuristics). **Review → Identify who you paid** groups unidentified spending by payee; name one once (e.g. “Sunita (house help)”) and every past and future payment to that UPI ID is renamed and categorised. Older transactions get these details on the next sync. |
| Dashboard | Plain-language summary (month-end projection, how much is still unidentified, money sent to people, biggest category moves, new payees, largest payment), who you paid (all / people), category changes vs last month, this month vs last month, monthly average, top category, 12-month trend, category / merchant / bank / card-vs-UPI breakdowns, recurring subscriptions, unusually large expenses, and a “not counted as spending” panel so totals are explainable. |
| Explorer | Search, filter by month/date range/bank/category/type/method, edit category & type, exclude, notes, open source email in Gmail, CSV export. |
| Review | Possible duplicates, low-confidence parses, unrecognised bank transfers, uncategorised spending, and bank emails no template understood (headers only). |
| Data | JSON backup/restore, CSV export, demo data, clear all local data, persistent-storage request, on-device parser tester. |
| PWA | Manifest, Home Screen icon, offline viewing of synced data; the service worker caches only the app’s own files. |

## Quick start

1. **Deploy** (below) and open the URL — or run locally with `npm install && npm run dev`.
2. Tap **Try with demo data** to explore with invented transactions.
3. Do the one-time **[Google Cloud setup](docs/GOOGLE_CLOUD_SETUP.md)**, paste the client ID in **Settings**, then **Sync → Connect Gmail & sync**.
4. Settings → **Remove demo data** once your real data is in.
5. On iPhone: Safari → Share → **Add to Home Screen**, then Settings → **Keep data persistent**.

## Deploy to GitHub Pages

The code lives in **github.com/imvikv/expense-tracker** (branch `main`).

On GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. *(Optional)* **Settings → Secrets and variables → Actions → Variables → New repository variable** `GOOGLE_CLIENT_ID` = your client ID.
3. **Actions → “Test and deploy to GitHub Pages” → Run workflow** (or just push to `main`).

The workflow installs dependencies, runs the unit tests, type-checks, builds with the right base path (`/expense-tracker/`), checks that no source maps or client secrets ended up in the build, and publishes `dist/`.

> **Private repo + Pages:** on a free GitHub account, Pages requires the repository to be **public** (private-repo Pages needs GitHub Pro). Making the repo public is safe here — it contains code only, never your data or secrets. Either way the *site* itself is public; that’s fine because the app shows nothing until *you* sign in with *your* Google account, and all data stays in your browser.

After the first `npm install`, commit `package-lock.json` so CI builds are reproducible (`npm ci`).

## Local development

```bash
npm install
cp .env.example .env.local      # optional: VITE_GOOGLE_CLIENT_ID=...
npm run dev                     # http://localhost:5173/expense-tracker/
npm test                        # parser, categorisation, duplicate and analytics tests
npm run typecheck
npm run build && npm run preview
```

For Gmail sign-in on localhost, add `http://localhost:5173` as an authorised JavaScript origin on the OAuth client.

## Project layout

```
src/
  lib/
    parsers/        common.ts (amounts, dates, helpers) + hdfc.ts icici.ts axis.ts hsbc.ts + index.ts (sender verification, Gmail query)
    categorize.ts   merchant normalisation, built-in merchant map, rules, kind/category classification
    dedupe.ts       duplicate detection
    analytics.ts    spending maths, monthly totals, recurring & unusual detection
    gmail.ts        Gmail REST client (pagination, retries, MIME decoding, DMARC check)
    auth.ts         Google Identity Services token client (in-memory token)
    sync.ts         incremental sync pipeline
    db.ts           IndexedDB storage
    exporters.ts    CSV + JSON backup/restore
    sampleEmails.ts synthetic test fixtures and demo-data generator
  ui/               React screens (Dashboard, Transactions, Review, Settings, sheets)
  test/             node:test suites (run with tsx)
public/sw.js        service worker (app shell only)
```

## Adding or fixing a bank template

Bank email formats change. When a real alert isn’t recognised it shows up under **Review → Bank emails not understood**.

1. Open the email, copy its text, **redact** names/references, and paste it into **Settings → Parser tester** to see what happens.
2. Add a template to `src/lib/parsers/<bank>.ts`. In template sources a literal space means “one or more whitespace”, and `{AMT}` matches `Rs.`/`INR`/`₹` plus the amount.
3. Add the redacted email as a fixture with expected values in `src/lib/sampleEmails.ts` and run `npm test`.

The included fixtures are **synthetic** — modelled on the structure of real HDFC/ICICI/Axis/HSBC alerts, but every number and name is invented. Expect to add a template or two once you see your own banks’ current wording.

To accept a new sender domain (banks are moving to `*.bank.in`), edit `BANK_SENDER_DOMAINS` in `src/lib/parsers/index.ts`.

## Privacy & security model

See [docs/SECURITY.md](docs/SECURITY.md) for the full list. In short:

- **Data path:** Gmail → (HTTPS, your token) → your browser memory → parser → IndexedDB on your device. Nothing else.
- **Content Security Policy** (production build) only allows scripts from this site and Google Identity Services, and network calls only to this site, `gmail.googleapis.com`, `accounts.google.com/gsi` and `oauth2.googleapis.com` (token revocation). No third-party scripts, fonts or images.
- **Two runtime dependencies** (React, React DOM). No analytics, charts library, CSS framework or icon CDN.
- **Device-local storage:** browser storage is per browser and per device and can be wiped by the browser (Safari may evict sites unused for weeks) or by clearing website data. Use *Export backup* if you care about manual edits; transactions themselves can always be rebuilt by re-syncing.
- Backups and CSV exports contain your financial data in plain text — store them privately. `.gitignore` blocks common backup/export filenames from being committed by accident.

## Known limitations

- **Templates need real-world tuning.** See above. Low-confidence results are clearly marked.
- **Token lifetime.** Google access tokens last ~1 hour; in Testing mode your consent also lapses after 7 days, so you’ll see Google’s consent screen about weekly. This is the price of having no server (a backend would be needed to hold refresh tokens, which this design deliberately avoids).
- **No background sync.** iOS doesn’t allow it for web apps; tap Sync when you open the app.
- **No cross-device sync** by design. Each device syncs from Gmail independently; JSON backup/import moves manual edits between devices.
- **Only email alerts.** Transactions your banks only send by SMS won’t appear. Turn on email alerts in each bank’s net banking (HDFC *InstaAlerts*, ICICI/Axis/HSBC alert preferences).
- A publicly hosted static site is not the same as a formally reviewed private app; review the code and the workflow before trusting it with your mailbox.
