"use strict";

const config = require("./config");

function isAllowed(userId) {
  if (!Number.isFinite(userId)) return false;
  return config.allowedUsers.includes(Number(userId));
}

module.exports = { isAllowed };
