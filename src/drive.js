"use strict";

const fs = require("fs");
const { google } = require("googleapis");
const config = require("./config");
const logger = require("./logger");

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

function makeOAuthClient() {
  const oauth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    "urn:ietf:wg:oauth:2.0:oob",
  );
  oauth.setCredentials({ refresh_token: config.google.refreshToken });
  return oauth;
}

function makeDrive() {
  return google.drive({ version: "v3", auth: makeOAuthClient() });
}

async function uploadFile({
  filePath,
  fileName,
  mimeType,
  parentId,
  onProgress,
}) {
  const drive = makeDrive();
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  let lastReported = -1;

  const requestBody = {
    name: fileName,
  };
  if (parentId) requestBody.parents = [parentId];

  const media = {
    mimeType: mimeType || "application/octet-stream",
    body: fs.createReadStream(filePath),
  };

  const res = await drive.files.create(
    {
      requestBody,
      media,
      fields: "id, name, mimeType, size, webViewLink, webContentLink",
    },
    {
      onUploadProgress: (e) => {
        if (!onProgress || !fileSize) return;
        const pct = Math.min(100, (e.bytesRead / fileSize) * 100);
        const stepped = Math.floor(pct);
        if (stepped !== lastReported) {
          lastReported = stepped;
          onProgress(pct, e.bytesRead, fileSize);
        }
      },
    },
  );
  return res.data;
}

async function makePublic(fileId) {
  const drive = makeDrive();
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });
  return true;
}

async function getFile(fileId) {
  const drive = makeDrive();
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size, webViewLink, webContentLink",
  });
  return res.data;
}

function buildLinks(fileId, mimeType) {
  const view = `https://drive.google.com/file/d/${fileId}/view`;
  const download = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
  let embed = null;
  if (mimeType && (mimeType.startsWith("image/") || mimeType.startsWith("video/"))) {
    embed = `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  return { view, download, embed };
}

async function checkAuth() {
  const drive = makeDrive();
  await drive.about.get({ fields: "user(emailAddress)" });
}

module.exports = {
  uploadFile,
  makePublic,
  getFile,
  buildLinks,
  checkAuth,
  SCOPES,
};
