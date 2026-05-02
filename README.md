# tg-upto

Telegram bot that uploads any file you send it to **your own Google Drive** and replies with the share link. After upload you choose whether the file should be public (`Anyone with the link`) or stay private.

## Features

- Accepts any Telegram file: documents, photos, videos, audio, voice notes, stickers, animations.
- Uploads to **My Drive** of the Google account that authenticated the bot, regardless of which allowed user sent the file.
- Files up to **2 GB** thanks to MTProto (no Local Bot API server required).
- Inline buttons after each upload: **🌐 Make Public** / **🔒 Keep Private**.
- Public files: get **View**, **Direct download**, and (for images/videos) **Embed** links.
- Duplicate filenames are auto-suffixed with timestamp (`report_2026-04-25_14-30-15.pdf`).
- Bot is locked to a list of allowed Telegram user IDs — no one else can use it.

## Prerequisites

- Ubuntu 22.04 / 24.04 server with **root** access
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Telegram **API_ID** and **API_HASH** from <https://my.telegram.org/apps>
- Your numeric Telegram user id (ask [@userinfobot](https://t.me/userinfobot) — send it `/start`)
- A Google Cloud project with Drive API + an OAuth Desktop client (see below)

## Setting up Google Cloud (one-time, ~5 minutes)

> The Google Cloud Console UI changed in 2025 — the OAuth consent screen is no longer a wizard. Each section (**Branding**, **Audience**, **Clients**, **Data access**) now lives in its own sidebar tab. The steps below match the new UI.

### 1. Create a project and enable the Drive API

1. Open <https://console.cloud.google.com>. If you don't have a project yet, click the project picker in the top bar → **New Project** → give it any name (e.g. `tg-upto`) → **Create**.
2. Make sure the new project is selected in the top bar.
3. Open <https://console.cloud.google.com/apis/library/drive.googleapis.com> → click **Enable**.

### 2. Configure the OAuth consent screen

1. Open <https://console.cloud.google.com/auth/overview>. If asked, choose **External** as the user type (Internal is only for Google Workspace organisations).
2. Go to **Branding** in the sidebar and fill in the minimum required fields:
   - **App name**: `tg-upto` (or anything you like).
   - **User support email**: your own Gmail.
   - **Developer contact information**: same email.
   - Leave logo, app domain, etc. **empty**.
   - Save.
3. Go to **Audience** in the sidebar:
   - Under **Test users**, click **+ Add users** and add the Gmail address that owns the Drive you want files uploaded to. (Only the Drive owner needs to be a test user — Telegram users send files via Telegram, they do not need a Google account.)
   - Save.
   - **Click `Publish app` (Push to production) and confirm.** This is required — see the warning below.
4. **Skip the Data access tab.** The bot uses the `drive.file` scope, which is non-sensitive and does not need to be listed in the consent screen.

> **Why you must publish the app.** Refresh tokens issued by an OAuth app whose publishing status is **Testing** are revoked by Google after **7 days**, even for listed test users (see <https://developers.google.com/identity/protocols/oauth2#expiration>). Once that happens, every upload fails with `invalid_grant` and you have to re-run the OAuth bootstrap. Publishing the app moves it to **In production**, where refresh tokens last indefinitely. Because the bot only uses the non-sensitive `drive.file` scope, **publishing does NOT require Google verification** — the button just toggles the status.

### 3. Create the OAuth Desktop client

1. Go to **Clients** in the sidebar (or open <https://console.cloud.google.com/apis/credentials>).
2. Click **+ Create client** (or **Create OAuth client**).
3. **Application type**: **Desktop app**. Name it whatever you like (e.g. `tg-upto-cli`).
4. Click **Create**. A popup shows the **Client ID** and **Client secret** — copy both. You can re-open the client from the list later if you lose the popup.

You're done with Google Cloud. Keep the Client ID + Client Secret handy for the installer.

## Install

One-line install (run as root):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-upto/main/install.sh)
```

The installer will:

1. Install Node.js 20 and PM2.
2. Clone this repo to `/root/tg-upto`.
3. Prompt for `BOT_TOKEN`, `API_ID`, `API_HASH`, `ALLOWED_USERS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an optional `DRIVE_FOLDER_ID` (leave empty to upload to the root of My Drive).
4. Run `setup-drive.js` interactively. This is the OAuth bootstrap step. It uses Google's [loopback IP flow](https://developers.google.com/identity/protocols/oauth2/native-app#redirect-uri_loopback) on `http://127.0.0.1:53682`:
   1. The installer prints a Google URL — open it in any browser logged in as the **Drive owner**.
   2. Approve the permission request (`See, edit, create, and delete only the specific Google Drive files you use with this app`).
   3. Google redirects to `http://127.0.0.1:53682/?code=...`. Three ways this works:
      - **(a) On the same machine** — the local script catches the redirect automatically.
      - **(b) Remote VPS, easy mode** — first SSH in with port-forwarding so the redirect tunnels back: `ssh -L 53682:127.0.0.1:53682 root@<server>`. Then open the auth URL in your laptop's browser. The redirect succeeds and the script finishes automatically.
      - **(c) Manual paste** — if you can't tunnel, the redirected page will fail to load on your laptop. Just copy the entire URL from the address bar (or just the `code=` value) and paste it into the terminal prompt.
   4. The refresh token is saved to `.env` and validated against Drive.
5. Save the long-lived refresh token to `/root/tg-upto/.env` (chmod 600).
6. Start the bot with PM2 and enable auto-start on boot.

## Usage

1. Open a private chat with your bot in Telegram.
2. Send any file (forward, attach, paste, drag-and-drop — anything with media).
3. The bot downloads it from Telegram, uploads to Drive, then replies with the file link.
4. Tap **🌐 Make Public** to expose it to *anyone with the link*, or **🔒 Keep Private** to keep it visible only to the Drive owner.

For public files the reply contains:

- **View** link (`https://drive.google.com/file/d/<id>/view`)
- **Direct download** link (`https://drive.google.com/uc?export=download&id=<id>&confirm=t`)
- **Embed** link for images/videos (`https://drive.google.com/uc?export=view&id=<id>`) — useful as `<img src="...">` or in markdown.

## Managing allowed users

Only Telegram user IDs listed in `ALLOWED_USERS` can use the bot. Everyone else gets `🚫 Not authorized.` plus their own numeric id (so you can copy it into the list later if you decide to authorise them).

To add or remove users:

```bash
nano /root/tg-upto/.env
```

Edit the `ALLOWED_USERS` line — comma-separated, no spaces:

```dotenv
ALLOWED_USERS=8261361884,123456789,987654321
```

Save and restart:

```bash
pm2 restart tg-upto
```

The new list takes effect immediately.

To find someone's numeric Telegram id, send `/start` to [@userinfobot](https://t.me/userinfobot), or just have them message the bot once — the rejection reply contains their id.

## Daily commands

```bash
pm2 logs tg-upto                # follow logs
pm2 restart tg-upto             # restart
pm2 stop tg-upto                # stop
bash /root/tg-upto/update.sh    # pull latest code and restart
bash /root/tg-upto/uninstall.sh # remove everything

cd /root/tg-upto && node setup-drive.js   # re-authenticate Google Drive
```

`update.sh` only pulls code and restarts; it never touches `.env`, so your refresh token, allowed users, and folder id are preserved.

Bot commands (also exposed via the slash-command menu in Telegram):

| Command | Action |
| --- | --- |
| `/start`, `/help` | Show usage instructions |
| `/whoami` | Show your numeric Telegram id |

## Troubleshooting

**Bot does not respond.** Check `pm2 logs tg-upto`. Make sure your user id is listed in `ALLOWED_USERS` inside `/root/tg-upto/.env`.

**`Google Drive authentication failed`.** The refresh token in `.env` is invalid or revoked. Re-run the OAuth bootstrap:

```bash
cd /root/tg-upto && node setup-drive.js
pm2 restart tg-upto
```

**OAuth says `Access blocked: tg-upto's request is invalid` (Error 400: invalid_request).** Your `setup-drive.js` is using the deprecated out-of-band (`oob`) redirect. Pull latest (`bash /root/tg-upto/update.sh`) — recent versions use the supported loopback flow. If you're already on a recent version, make sure your OAuth client is of type **Desktop app** (loopback redirects to `http://127.0.0.1` are auto-accepted for Desktop clients without registering URIs).

**Upload fails with `invalid_grant`.** Your refresh token has been invalidated. Most common cause: the OAuth app is in **Testing** publishing status, which makes Google revoke refresh tokens after 7 days. Fix it permanently by publishing the app at <https://console.cloud.google.com/auth/audience> (Push to production — no verification needed for the `drive.file` scope), then re-run `node setup-drive.js`.

Other causes: you revoked access at <https://myaccount.google.com/permissions>, the OAuth client was deleted/recreated, or the Drive owner's password/2FA changed.

**`File too large`.** MTProto upload limit is ~2 GB. Telegram itself doesn't allow sending bigger files to a normal bot.

**Forgot a value in `.env`.** Edit `/root/tg-upto/.env` (chmod 600) and `pm2 restart tg-upto`.

**Start over.** `bash /root/tg-upto/uninstall.sh`, then run the one-line installer again.
