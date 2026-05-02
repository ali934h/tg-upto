"use strict";

const fs = require("fs");
const path = require("path");
const { NewMessage } = require("telegram/events");
const { CallbackQuery } = require("telegram/events/CallbackQuery");
const { Api } = require("telegram");
const { Button } = require("telegram/tl/custom/button");

const config = require("./config");
const logger = require("./logger");
const auth = require("./auth");
const state = require("./state");
const drive = require("./drive");

function humanSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
}

function timestampSuffix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function appendTimestampToName(name) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}_${timestampSuffix()}${ext}`;
}

function safeFileName(raw) {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  return cleaned || `file_${timestampSuffix()}`;
}

function pickFileFromMessage(message) {
  // Telegram messages can carry files in a few shapes (document, photo, video, audio, voice, video_note).
  // gramjs surfaces these as message.document / message.photo / message.video etc.
  // The most reliable way is to inspect the underlying media object.
  const media = message.media;
  if (!media) return null;

  // MessageMediaPhoto -> we'll synthesize a name and mime type.
  if (media.className === "MessageMediaPhoto" && media.photo) {
    return {
      kind: "photo",
      mimeType: "image/jpeg",
      name: `photo_${timestampSuffix()}.jpg`,
      size: 0,
    };
  }

  // MessageMediaDocument covers documents, videos, audio, voice, video notes, animations, stickers.
  if (media.className === "MessageMediaDocument" && media.document) {
    const doc = media.document;
    const attrs = doc.attributes || [];
    let name = "";
    let mimeType = doc.mimeType || "application/octet-stream";
    let kind = "document";
    for (const a of attrs) {
      if (a.className === "DocumentAttributeFilename" && a.fileName) {
        name = a.fileName;
      } else if (a.className === "DocumentAttributeVideo") {
        kind = "video";
      } else if (a.className === "DocumentAttributeAudio") {
        kind = a.voice ? "voice" : "audio";
      } else if (a.className === "DocumentAttributeSticker") {
        kind = "sticker";
      } else if (a.className === "DocumentAttributeAnimated") {
        kind = "animation";
      }
    }
    if (!name) {
      const extGuess =
        kind === "video"
          ? ".mp4"
          : kind === "audio"
            ? ".mp3"
            : kind === "voice"
              ? ".ogg"
              : kind === "sticker"
                ? ".webp"
                : kind === "animation"
                  ? ".gif"
                  : ".bin";
      name = `${kind}_${timestampSuffix()}${extGuess}`;
    }
    return {
      kind,
      mimeType,
      name,
      size: Number(doc.size || 0),
    };
  }
  return null;
}

class Bot {
  constructor(client) {
    this.client = client;
  }

  start() {
    this.client.addEventHandler(
      (e) => this.safeHandle(() => this.onMessage(e)),
      new NewMessage({ incoming: true }),
    );
    this.client.addEventHandler(
      (e) => this.safeHandle(() => this.onCallback(e)),
      new CallbackQuery({}),
    );
    logger.info("Event handlers registered");
    this.registerBotCommands().catch((err) => {
      logger.warn(`Failed to register bot commands: ${err.message}`);
    });
  }

  async registerBotCommands() {
    const commands = [
      { command: "start", description: "Start the bot" },
      { command: "help", description: "Show usage instructions" },
      { command: "whoami", description: "Show your Telegram id" },
    ].map(
      (c) =>
        new Api.BotCommand({ command: c.command, description: c.description }),
    );
    await this.client.invoke(
      new Api.bots.SetBotCommands({
        scope: new Api.BotCommandScopeDefault(),
        langCode: "",
        commands,
      }),
    );
    logger.info("Bot commands registered");
  }

  async safeHandle(fn) {
    try {
      await fn();
    } catch (err) {
      logger.error("Handler error:", err && err.stack ? err.stack : err);
    }
  }

  async onMessage(event) {
    const msg = event.message;
    if (!msg || !msg.isPrivate) return;
    const senderId = msg.senderId ? Number(msg.senderId.toString()) : null;
    if (!senderId) return;

    if (!auth.isAllowed(senderId)) {
      logger.warn(`Rejected message from unauthorized user ${senderId}`);
      try {
        await msg.reply({
          message: `🚫 Not authorized.\nYour id: <code>${senderId}</code>`,
          parseMode: "html",
        });
      } catch (e) {
        // Ignore
      }
      return;
    }

    const text = (msg.message || "").trim();

    if (text.startsWith("/start") || text.startsWith("/help")) {
      await this.sendHelp(msg);
      return;
    }
    if (text.startsWith("/whoami")) {
      await msg.reply({
        message: `Your Telegram id: <code>${senderId}</code>`,
        parseMode: "html",
      });
      return;
    }

    const fileMeta = pickFileFromMessage(msg);
    if (!fileMeta) {
      if (text) {
        await msg.reply({
          message:
            "Send me any file (document, photo, video, audio, voice…) and " +
            "I will upload it to Google Drive.",
        });
      }
      return;
    }

    await this.handleUpload(event, senderId, msg, fileMeta);
  }

  async sendHelp(msg) {
    await msg.reply({
      message:
        "<b>tg-upto</b>\n\n" +
        "Send me any file (document, photo, video, audio, voice, sticker) " +
        "and I will upload it to Google Drive and reply with the link.\n\n" +
        "After upload, you can decide whether the file should be public " +
        "(<b>Anyone with the link</b>) or stay private.\n\n" +
        "<b>Commands:</b>\n" +
        "/start, /help — this message\n" +
        "/whoami — show your Telegram id\n",
      parseMode: "html",
    });
  }

  async handleUpload(event, senderId, msg, fileMeta) {
    const userState = state.get(senderId);
    userState.activeUploads += 1;
    const safeName = safeFileName(fileMeta.name);
    const finalName = appendTimestampToName(safeName);

    const userDir = path.join(
      config.uploadDir,
      String(senderId),
      String(Date.now()),
    );
    fs.mkdirSync(userDir, { recursive: true });
    const localPath = path.join(userDir, finalName);

    const sizeStr = humanSize(fileMeta.size) || "";
    const status = await msg.reply({
      message: `📥 Receiving <code>${escapeHtml(finalName)}</code>${sizeStr ? `  (${sizeStr})` : ""}...`,
      parseMode: "html",
    });

    let lastEdit = 0;
    const editStatus = async (text) => {
      const now = Date.now();
      if (now - lastEdit < 1500) return;
      lastEdit = now;
      try {
        await this.client.editMessage(msg.chatId, {
          message: Number(status.id),
          text,
          parseMode: "html",
        });
      } catch (e) {
        // Ignore edit errors (rate limit, identical content, etc.)
      }
    };

    try {
      // 1. Download from Telegram to disk
      let dlBytes = 0;
      const totalBytes = fileMeta.size || 0;
      await this.client.downloadMedia(msg, {
        outputFile: localPath,
        progressCallback: (received) => {
          dlBytes = Number(received) || dlBytes;
          if (totalBytes > 0) {
            const pct = Math.min(100, (dlBytes / totalBytes) * 100);
            editStatus(
              `📥 Receiving <code>${escapeHtml(finalName)}</code>\n` +
                `${humanSize(dlBytes)} / ${humanSize(totalBytes)}  ${pct.toFixed(0)}%`,
            );
          } else {
            editStatus(
              `📥 Receiving <code>${escapeHtml(finalName)}</code>\n${humanSize(dlBytes)}`,
            );
          }
        },
      });

      // 2. Upload to Drive
      lastEdit = 0;
      await editStatus(`☁️ Uploading to Drive...`);
      const driveFile = await drive.uploadFile({
        filePath: localPath,
        fileName: finalName,
        mimeType: fileMeta.mimeType,
        parentId: config.google.folderId,
        onProgress: (pct, sent, total) => {
          editStatus(
            `☁️ Uploading <code>${escapeHtml(finalName)}</code>\n` +
              `${humanSize(sent)} / ${humanSize(total)}  ${pct.toFixed(0)}%`,
          );
        },
      });

      // 3. Persist mapping for the inline buttons
      userState.uploads.set(Number(status.id), {
        fileId: driveFile.id,
        fileName: driveFile.name,
        mimeType: driveFile.mimeType,
        size: Number(driveFile.size || 0),
      });

      // 4. Final message with public/private buttons
      const links = drive.buildLinks(driveFile.id, driveFile.mimeType);
      const text =
        `✅ Uploaded <b>${escapeHtml(driveFile.name)}</b>\n` +
        (driveFile.size ? `📦 ${humanSize(driveFile.size)}\n` : "") +
        `🔗 <a href="${escapeHtml(links.view)}">View on Drive</a>\n\n` +
        `<i>Choose visibility:</i>`;

      await this.client.editMessage(msg.chatId, {
        message: Number(status.id),
        text,
        parseMode: "html",
        linkPreview: false,
        buttons: [
          [
            Button.inline("🌐 Make Public", Buffer.from(`pub:${driveFile.id}`)),
            Button.inline(
              "🔒 Keep Private",
              Buffer.from(`priv:${driveFile.id}`),
            ),
          ],
        ],
      });
    } catch (err) {
      logger.error(`Upload failed for ${senderId}: ${err.message}`);
      let userText;
      if (drive.isInvalidGrant(err)) {
        userText =
          "❌ Upload failed: <b>Google rejected the refresh token (invalid_grant).</b>\n\n" +
          "Most likely cause: your OAuth app at " +
          "https://console.cloud.google.com/auth/audience is in <b>Testing</b> " +
          "mode, which makes Google revoke refresh tokens after 7 days. " +
          "Click <b>Publish app</b> (no Google verification needed for the " +
          "<code>drive.file</code> scope), then re-run " +
          "<code>node setup-drive.js</code> on the server and " +
          "<code>pm2 restart tg-upto</code>.";
      } else {
        userText = `❌ Upload failed: ${escapeHtml(err.message || String(err))}`;
      }
      await this.client.editMessage(msg.chatId, {
        message: Number(status.id),
        text: userText,
        parseMode: "html",
      });
    } finally {
      userState.activeUploads = Math.max(0, userState.activeUploads - 1);
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        const parent = path.dirname(localPath);
        if (fs.existsSync(parent)) fs.rmdirSync(parent, { recursive: true });
      } catch (e) {
        logger.debug(`Cleanup failed: ${e.message}`);
      }
    }
  }

  async onCallback(event) {
    const senderId = Number(
      (event.senderId || (event.query && event.query.userId) || event.userId || 0)
        .toString(),
    );
    if (!auth.isAllowed(senderId)) {
      try {
        await event.answer({ message: "Not authorized.", alert: true });
      } catch (e) {
        // ignore
      }
      return;
    }

    const data = event.data ? event.data.toString("utf8") : "";
    if (!data) return;

    if (data.startsWith("pub:") || data.startsWith("priv:")) {
      const [action, fileId] = data.split(":");
      try {
        let text;
        if (action === "pub") {
          await drive.makePublic(fileId);
          const meta = await drive.getFile(fileId);
          const links = drive.buildLinks(fileId, meta.mimeType);
          const lines = [
            `✅ <b>${escapeHtml(meta.name)}</b> is now public`,
            meta.size ? `📦 ${humanSize(Number(meta.size))}` : null,
            "",
            `🔗 <a href="${escapeHtml(links.view)}">View</a>`,
            `⬇️ <a href="${escapeHtml(links.download)}">Direct download</a>`,
            links.embed
              ? `🖼️ <a href="${escapeHtml(links.embed)}">Embed link</a>`
              : null,
          ].filter(Boolean);
          text = lines.join("\n");
        } else {
          const meta = await drive.getFile(fileId);
          const links = drive.buildLinks(fileId, meta.mimeType);
          text =
            `🔒 <b>${escapeHtml(meta.name)}</b> kept private\n` +
            (meta.size ? `📦 ${humanSize(Number(meta.size))}\n` : "") +
            `🔗 <a href="${escapeHtml(links.view)}">View on Drive</a>  ` +
            `<i>(only owners can open)</i>`;
        }
        await this.client.editMessage(event.chatId, {
          message: Number(event.messageId),
          text,
          parseMode: "html",
          linkPreview: false,
        });
        await event.answer({});
      } catch (err) {
        logger.error(`Visibility change failed: ${err.message}`);
        await event.answer({
          message: `Failed: ${err.message}`,
          alert: true,
        });
      }
      return;
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { Bot };
