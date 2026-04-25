#!/usr/bin/env bash
# Uninstall tg-upto: remove PM2 process, install dir, and (optionally) uploads buffer.

set -euo pipefail

INSTALL_DIR="/root/tg-upto"
UPLOAD_DIR="/root/tg-upto-uploads"
PROJECT="tg-upto"

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root." >&2
  exit 1
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "${PROJECT}" >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
fi

rm -rf "${INSTALL_DIR}"

read -r -p "Also remove upload buffer dir ${UPLOAD_DIR}? [y/N]: " yn
case "${yn,,}" in
  y|yes) rm -rf "${UPLOAD_DIR}"; echo "Removed ${UPLOAD_DIR}" ;;
  *) echo "Kept ${UPLOAD_DIR}" ;;
esac

echo "Uninstalled."
