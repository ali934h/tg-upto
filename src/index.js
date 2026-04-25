"use strict";

const fs = require("fs");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const config = require("./config");
const logger = require("./logger");
const drive = require("./drive");
const { Bot } = require("./bot");

async function loadSession() {
  try {
    if (fs.existsSync(config.sessionFile)) {
      return fs.readFileSync(config.sessionFile, "utf8").trim();
    }
  } catch (e) {
    // Ignore
  }
  return "";
}

async function saveSession(s) {
  try {
    fs.writeFileSync(config.sessionFile, s, { mode: 0o600 });
  } catch (e) {
    logger.warn(`Could not save session: ${e.message}`);
  }
}

async function main() {
  // Sanity check Drive credentials before connecting to Telegram so the
  // operator gets a clear error message during installation.
  try {
    await drive.checkAuth();
  } catch (err) {
    logger.error(
      `Google Drive authentication failed: ${err.message}. ` +
        `Run \`node setup-drive.js\` to (re)generate a refresh token.`,
    );
    process.exit(1);
  }

  const sessionString = await loadSession();
  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });

  logger.info("Connecting to Telegram...");
  await client.start({
    botAuthToken: config.botToken,
  });
  const saved = client.session.save();
  if (saved && saved !== sessionString) {
    await saveSession(saved);
    logger.info("Session saved");
  }

  const me = await client.getMe();
  logger.info(`Logged in as @${me.username} (id=${me.id})`);
  logger.info(`Allowed users: ${config.allowedUsers.join(", ")}`);

  const bot = new Bot(client);
  bot.start();

  const shutdown = async (sig) => {
    logger.info(`Received ${sig}, shutting down...`);
    try {
      await client.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal:", err && err.stack ? err.stack : err);
  process.exit(1);
});
