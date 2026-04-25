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
- Your numeric Telegram user id (ask [@userinfobot](https://t.me/userinfobot))
- A Google Cloud project with **Drive API** enabled and an **OAuth 2.0 Client ID** of type **Desktop app** (gives you `client_id` and `client_secret`)

### Setting up Google Cloud (one-time)

1. Open <https://console.cloud.google.com>, create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → create an external app, add yourself (and any other allowed Google accounts) under **Test users**. The Drive scope used by this bot (`drive.file`) does not require Google verification, so you can stay in *Testing* mode forever.
4. **APIs & Services → Credentials → Create Credentials → OAuth Client ID → Desktop app**. Copy the **Client ID** and **Client Secret**.

## Install

One-line install (run as root):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-upto/main/install.sh)
```

The installer will:

- install Node.js 20 and PM2
- clone this repo to `/root/tg-upto`
- prompt for `BOT_TOKEN`, `API_ID`, `API_HASH`, `ALLOWED_USERS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an optional `DRIVE_FOLDER_ID`
- run `setup-drive.js` interactively to obtain a long-lived **refresh token** (you'll be asked to open a URL in a browser, approve, and paste the resulting code back)
- create `/root/tg-upto-uploads` (used as a temporary buffer; files are deleted right after upload)
- start the bot with PM2 and enable auto-start on boot

## Usage

1. Open a private chat with your bot in Telegram.
2. Send any file (forward, attach, paste, drag-and-drop — anything with media).
3. Wait for the bot to download it from Telegram, upload to Drive, then reply with the file link.
4. Tap **🌐 Make Public** to expose it to *anyone with the link*, or **🔒 Keep Private** to keep it visible only to the Drive owner.

For public files the reply contains:

- **View** link (`https://drive.google.com/file/d/<id>/view`)
- **Direct download** link (`https://drive.google.com/uc?export=download&id=<id>&confirm=t`)
- **Embed** link for images/videos (`https://drive.google.com/uc?export=view&id=<id>`) — useful as `<img src="...">` or in markdown.

## Daily commands

```bash
pm2 logs tg-upto                # follow logs
pm2 restart tg-upto             # restart
pm2 stop tg-upto                # stop
bash /root/tg-upto/update.sh    # pull latest code and restart
bash /root/tg-upto/uninstall.sh # remove everything

cd /root/tg-upto && node setup-drive.js   # re-authenticate Google Drive
```

Bot commands (also exposed via the slash-command menu in Telegram):

| Command | Action |
| --- | --- |
| `/start`, `/help` | Show usage instructions |
| `/whoami` | Show your numeric Telegram id |

## Troubleshooting

**Bot does not respond.** Check `pm2 logs tg-upto`. Make sure your user id is listed in `ALLOWED_USERS` inside `/root/tg-upto/.env`.

**`Google Drive authentication failed`.** The refresh token in `.env` is invalid or revoked. Run `cd /root/tg-upto && node setup-drive.js` to obtain a new one, then `pm2 restart tg-upto`.

**`File too large`.** MTProto upload limit is ~2 GB. Telegram itself doesn't allow sending bigger files to a normal bot.

**OAuth consent says `Access blocked`.** In the Google Cloud console under *OAuth consent screen* add the Google account you're using under **Test users**, or move the app to *Production*.

**Forgot your config.** Edit `/root/tg-upto/.env` (chmod 600) and `pm2 restart tg-upto`.

**Start over.** `bash /root/tg-upto/uninstall.sh`, then run the one-line installer again.
