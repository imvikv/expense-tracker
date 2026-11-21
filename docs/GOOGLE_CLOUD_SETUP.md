# Google Cloud setup (one time, ~10 minutes)

The app needs an OAuth **client ID** so Google can show you a consent screen and give your browser a short-lived, read-only Gmail token. There is no client secret and no server.

Do all of this signed in with the Gmail account whose bank alerts you want to read.

## 1. Create the project

1. Open <https://console.cloud.google.com/> and accept the terms if asked.
2. Project picker (top bar) → **New project** → name it `Personal Expense Tracker` → **Create**. Make sure it is selected afterwards.

## 2. Enable the Gmail API

1. Go to **APIs & Services → Library** (<https://console.cloud.google.com/apis/library/gmail.googleapis.com>).
2. Open **Gmail API** → **Enable**.

## 3. Configure Google Auth Platform (consent screen)

Open **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) and click **Get started** if prompted.

1. **Branding**
   - App name: `Personal Expense Tracker`
   - User support email: your Gmail address
   - Developer contact email: your Gmail address
   - App home page (optional): `https://imvikv.github.io/expense-tracker/`
   - Authorised domains: you can leave this empty while the app stays in Testing.
2. **Audience**
   - User type: **External**
   - Publishing status: leave it in **Testing**. Do **not** click *Publish app*.
   - **Test users → Add users** → add your own Gmail address (and any other account you'll use).
3. **Data Access** → **Add or remove scopes** → filter for `gmail.readonly` → tick
   `https://www.googleapis.com/auth/gmail.readonly` → **Update** → **Save**.

## 4. Create the OAuth client

1. **Google Auth Platform → Clients → Create client**.
2. Application type: **Web application**. Name: `Expense Tracker web`.
3. **Authorised JavaScript origins → Add URI**: `https://imvikv.github.io`
   - Origins never include a path, so this is just the domain. Add `http://localhost:5173` too if you want to run `npm run dev` locally.
4. **Authorised redirect URIs**: leave empty (the browser token flow doesn't use redirects).
5. **Create**. Copy the **Client ID** (`…apps.googleusercontent.com`).
   - Google also shows a *client secret*. **Ignore it.** Never paste it into the app, the repository or GitHub settings.

## 5. Give the client ID to the app

Either (or both):

- **In the app:** Settings → *Google OAuth client ID* → paste → *Save client ID*. Stored only in that browser.
- **In the build:** GitHub repo → *Settings → Secrets and variables → Actions → Variables* → **New repository variable** named `GOOGLE_CLIENT_ID` with the client ID as value → re-run the deploy workflow. Every device then has it pre-filled. (It's a *variable*, not a secret, because client IDs are public by design.)

## 6. First sign-in

Tap **Sync → Connect Gmail & sync**. Expect:

1. A Google account picker.
2. **"Google hasn't verified this app"** — normal for a personal app in Testing. Click **Continue** (it's your own app).
3. A permission screen for *Read your email messages and settings* — tick it and **Continue**.

## What Testing mode means for you

| Behaviour | Why | Impact |
|---|---|---|
| Only listed test users can sign in (max 100) | Testing status | Fine for a single-user app |
| "Unverified app" warning on consent | Restricted scope, unverified | Click Continue |
| Your grant expires 7 days after consent | Google's rule for test users | Roughly weekly you'll see the consent screen again |
| Access token lasts ~1 hour, kept in memory only | App design | Re-tap Connect after an hour or after reloading the app |

**Do not publish the app to Production.** `gmail.readonly` is a *restricted* scope: a public app needs Google's OAuth verification plus an annual third-party security assessment, which isn't worth it for personal use.

## Revoking access

- In the app: Settings → **Disconnect Gmail** (revokes the current token).
- Fully: <https://myaccount.google.com/connections> → *Personal Expense Tracker* → **Delete all connections**.
- Delete the Google Cloud project to retire the client ID entirely.

## Troubleshooting

| Message | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` / `origin_mismatch` | The JavaScript origin must be exactly `https://imvikv.github.io` (no trailing slash, no path). Changes can take ~5 minutes. |
| `Error 403: access_denied` | Your Gmail address isn't in **Audience → Test users**. |
| "Gmail read permission was not granted" | On the consent screen, the Gmail checkbox was left unticked. Reconnect and tick it. |
| Popup doesn't open on iPhone | Settings app → Safari → turn off *Block Pop-ups*, or open the app from the Home Screen and tap Connect again. |
| "Gmail API has not been used in project…" | Step 2 wasn't done in the same project as the client. |
