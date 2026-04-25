"use strict";

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v).trim();
}

function parseAllowed(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const cfg = {
  botToken: required("BOT_TOKEN"),
  apiId: Number(required("API_ID")),
  apiHash: required("API_HASH"),
  allowedUsers: parseAllowed(process.env.ALLOWED_USERS),
  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
    folderId: (process.env.DRIVE_FOLDER_ID || "").trim() || null,
  },
  uploadDir: (process.env.UPLOAD_DIR || "/root/tg-upto-uploads").trim(),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  sessionFile: path.resolve(__dirname, "..", "session.session"),
};

if (cfg.allowedUsers.length === 0) {
  throw new Error("ALLOWED_USERS must contain at least one Telegram user id");
}

module.exports = cfg;
