#!/usr/bin/env node
"use strict";

// One-time helper that exchanges an OAuth consent code for a refresh token
// and writes it to .env. Run once after install (or to re-authenticate).

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { google } = require("googleapis");
const dotenv = require("dotenv");

const ENV_PATH = path.resolve(__dirname, ".env");

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`Missing ${ENV_PATH}. Copy .env.example first.`);
    process.exit(1);
  }
  return dotenv.parse(fs.readFileSync(ENV_PATH));
}

function writeEnv(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v ?? ""}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env first.",
    );
    process.exit(1);
  }

  const oauth = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob",
  );

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });

  console.log("\n=== Google Drive OAuth setup ===\n");
  console.log("1. Open this URL in a browser logged in as the Drive owner:\n");
  console.log(url);
  console.log("\n2. Approve the request.");
  console.log(
    '3. Google will display an "authorization code" (or redirect to a page ' +
      'whose URL contains "code=..."). Copy that code.',
  );
  const code = await ask("\nPaste the code here: ");

  if (!code) {
    console.error("No code provided. Aborting.");
    process.exit(1);
  }

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "Google did not return a refresh token. Make sure the OAuth consent " +
        'screen has access_type=offline and prompt=consent. Try again with a ' +
        'fresh code.',
    );
    process.exit(1);
  }

  env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
  writeEnv(env);
  console.log("\nRefresh token saved to .env (chmod 600).");

  // Sanity check: list one file to confirm the token works.
  oauth.setCredentials({ refresh_token: tokens.refresh_token });
  const drive = google.drive({ version: "v3", auth: oauth });
  const about = await drive.about.get({ fields: "user(emailAddress)" });
  console.log(`Authenticated as: ${about.data.user.emailAddress}`);
  console.log("Setup complete. You can start the bot now.");
}

main().catch((err) => {
  console.error("Setup failed:", err && err.message ? err.message : err);
  process.exit(1);
});
