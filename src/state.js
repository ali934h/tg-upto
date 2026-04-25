"use strict";

// Per-user runtime state (in-memory only).
const states = new Map();

function get(userId) {
  const id = Number(userId);
  if (!states.has(id)) {
    states.set(id, {
      activeUploads: 0,
      // Track last uploaded file id so callbacks can find it.
      // Map<messageId, { fileId, fileName, mimeType, size }>
      uploads: new Map(),
    });
  }
  return states.get(id);
}

function reset(userId) {
  states.delete(Number(userId));
}

module.exports = { get, reset };
