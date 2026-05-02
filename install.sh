#!/usr/bin/env bash
# tg-upto installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-upto/main/install.sh)

set -euo pipefail

REPO_URL="https://github.com/ali934h/tg-upto.git"
PROJECT="tg-upto"
INSTALL_DIR="/root/${PROJECT}"
UPLOAD_DIR="/root/${PROJECT}-uploads"
NODE_MAJOR=20

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${BOLD}${BLUE}==>${NC} ${BOLD}$*${NC}"; }
info()  { echo -e "${CYAN}  ->${NC} $*"; }
warn()  { echo -e "${YELLOW}  !!${NC} $*"; }
ok()    { echo -e "${GREEN}  ok${NC} $*"; }
err()   { echo -e "${RED}  xx${NC} $*" >&2; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "This installer must be run as root."
    exit 1
  fi
}

banner() {
  echo
  echo -e "${BOLD}${CYAN}========================================${NC}"
  echo -e "${BOLD}${CYAN}            tg-upto installer           ${NC}"
  echo -e "${BOLD}${CYAN}========================================${NC}"
  echo -e "${BOLD} Telegram bot that uploads files to Google Drive${NC}"
  echo -e "${BOLD} Repo:${NC}        ${REPO_URL}"
  echo -e "${BOLD} Install dir:${NC} ${INSTALL_DIR}"
  echo -e "${BOLD} Uploads buf:${NC} ${UPLOAD_DIR}"
  echo
}

cleanup_existing() {
  step "Cleaning up any previous installation"

  if command -v pm2 >/dev/null 2>&1; then
    pm2 delete "${PROJECT}" >/dev/null 2>&1 || true
    pm2 save --force >/dev/null 2>&1 || true
    ok "PM2 process removed"
  fi

  if [[ -d "${INSTALL_DIR}" ]]; then
    rm -rf "${INSTALL_DIR}"
    ok "Removed ${INSTALL_DIR}"
  fi
}

install_system_deps() {
  step "Installing system dependencies"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl git ca-certificates xz-utils

  if ! command -v node >/dev/null 2>&1 || \
     [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt "${NODE_MAJOR}" ]]; then
    info "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node.js $(node -v)"
  ok "npm $(npm -v)"

  if ! command -v pm2 >/dev/null 2>&1; then
    info "Installing PM2 globally"
    npm install -g pm2
  fi
  ok "PM2 $(pm2 -v)"
}

clone_repo() {
  step "Cloning repository"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  ok "Cloned to ${INSTALL_DIR}"
}

prompt_nonempty() {
  local prompt="$1"
  local default="${2:-}"
  local value=""
  while true; do
    if [[ -n "${default}" ]]; then
      read -r -p "$(echo -e "${prompt} [${default}]: ")" value
      value="${value:-${default}}"
    else
      read -r -p "$(echo -e "${prompt}: ")" value
    fi
    if [[ -z "${value// }" ]]; then
      err "Value cannot be empty. Please try again."
      continue
    fi
    echo "${value}"
    return
  done
}

prompt_optional() {
  local prompt="$1"
  local value=""
  read -r -p "$(echo -e "${prompt} (optional, leave empty to skip): ")" value
  echo "${value}"
}

prompt_numeric() {
  local prompt="$1"
  local value=""
  while true; do
    read -r -p "$(echo -e "${prompt}: ")" value
    if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
      err "Must be a positive integer. Please try again."
      continue
    fi
    echo "${value}"
    return
  done
}

prompt_user_ids() {
  local prompt="$1"
  local value=""
  while true; do
    read -r -p "$(echo -e "${prompt}: ")" value
    value="${value// /}"
    if [[ -z "${value}" ]]; then
      err "ALLOWED_USERS cannot be empty. Add at least your own Telegram user id."
      continue
    fi
    if [[ ! "${value}" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
      err "Format must be comma-separated user ids, e.g. 123456789,987654321"
      continue
    fi
    echo "${value}"
    return
  done
}

collect_inputs() {
  step "Collecting Telegram configuration"
  echo -e "${YELLOW}All inputs are shown in plain text so you can verify what you typed.${NC}\n"

  echo -e "${BOLD}Telegram bot token${NC} (from @BotFather)"
  BOT_TOKEN=$(prompt_nonempty "BOT_TOKEN")

  echo -e "\n${BOLD}Telegram API credentials${NC} (from https://my.telegram.org/apps)"
  API_ID=$(prompt_numeric "API_ID")
  API_HASH=$(prompt_nonempty "API_HASH")

  echo -e "\n${BOLD}Authorized Telegram user IDs${NC} (comma-separated, no spaces)"
  echo -e "${CYAN}Tip: send /start to @userinfobot to find your numeric user id.${NC}"
  ALLOWED_USERS=$(prompt_user_ids "ALLOWED_USERS")

  step "Collecting Google Drive OAuth credentials"
  echo -e "${YELLOW}Create an OAuth 2.0 Client ID of type 'Desktop' at${NC}"
  echo -e "${YELLOW}https://console.cloud.google.com/apis/credentials and enable${NC}"
  echo -e "${YELLOW}the Google Drive API.${NC}\n"

  GOOGLE_CLIENT_ID=$(prompt_nonempty "GOOGLE_CLIENT_ID")
  GOOGLE_CLIENT_SECRET=$(prompt_nonempty "GOOGLE_CLIENT_SECRET")

  echo -e "\n${BOLD}Drive folder id${NC}"
  echo -e "${CYAN}Open the destination folder in Drive; the id is the path segment after /folders/.${NC}"
  echo -e "${CYAN}Leave empty to upload to the root of My Drive.${NC}"
  DRIVE_FOLDER_ID=$(prompt_optional "DRIVE_FOLDER_ID")
}

confirm_summary() {
  step "Configuration summary"
  cat <<EOF
  Install dir:           ${INSTALL_DIR}
  Uploads buffer dir:    ${UPLOAD_DIR}
  BOT_TOKEN:             ${BOT_TOKEN}
  API_ID:                ${API_ID}
  API_HASH:              ${API_HASH}
  ALLOWED_USERS:         ${ALLOWED_USERS}
  GOOGLE_CLIENT_ID:      ${GOOGLE_CLIENT_ID}
  GOOGLE_CLIENT_SECRET:  ${GOOGLE_CLIENT_SECRET}
  DRIVE_FOLDER_ID:       ${DRIVE_FOLDER_ID:-<root of My Drive>}

EOF
  while true; do
    read -r -p "$(echo -e "${BOLD}Proceed with installation? [y/N]: ${NC}")" yn
    case "${yn,,}" in
      y|yes) break ;;
      n|no|"") err "Aborted by user."; exit 1 ;;
      *) warn "Please answer y or n." ;;
    esac
  done
}

write_env() {
  step "Writing .env"
  cat > "${INSTALL_DIR}/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
API_ID=${API_ID}
API_HASH=${API_HASH}
ALLOWED_USERS=${ALLOWED_USERS}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_REFRESH_TOKEN=
DRIVE_FOLDER_ID=${DRIVE_FOLDER_ID}
UPLOAD_DIR=${UPLOAD_DIR}
LOG_LEVEL=info
EOF
  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env written with chmod 600"
}

prepare_dirs() {
  step "Preparing directories"
  mkdir -p "${UPLOAD_DIR}"
  chmod 755 /root
  chmod -R 755 "${UPLOAD_DIR}"
  ok "Created ${UPLOAD_DIR}"
}

install_npm_deps() {
  step "Installing Node.js dependencies"
  cd "${INSTALL_DIR}"
  npm install --omit=dev --no-audit --no-fund
  ok "npm install complete"
}

run_drive_setup() {
  step "Bootstrapping Google Drive OAuth"
  cat <<EOF
${BOLD}Now we need to obtain a refresh token for Google Drive.${NC}
${YELLOW}IMPORTANT:${NC} make sure your OAuth app is published (status:
  ${BOLD}In production${NC}) at https://console.cloud.google.com/auth/audience
  before continuing. Apps left in ${BOLD}Testing${NC} mode get their refresh
  tokens revoked by Google after 7 days, which causes uploads to fail with
  ${BOLD}invalid_grant${NC}. The 'drive.file' scope is non-sensitive, so
  publishing does not require Google verification.

The next step opens an interactive prompt:
  1. A URL will be printed - open it in any browser logged in as the
     Drive owner.
  2. Approve the consent screen.
  3. Google redirects to http://127.0.0.1:53682/?code=...
       - On the same machine: caught automatically.
       - Over SSH: tunnel first with
           ssh -L 53682:127.0.0.1:53682 root@<this-server>
         then open the auth URL on your laptop.
       - Otherwise: copy the redirected URL from the address bar (or
         just the code= value) and paste it into the terminal prompt.

EOF
  cd "${INSTALL_DIR}"
  node setup-drive.js
  ok "Refresh token saved"
}

setup_pm2() {
  step "Setting up PM2"
  cd "${INSTALL_DIR}"

  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:retain 7 >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true

  pm2 start ecosystem.config.js
  pm2 save

  info "Configuring systemd auto-start"
  env PATH="$PATH:/usr/bin" pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

  ok "PM2 process registered"
}

success_message() {
  echo -e "\n${BOLD}${GREEN}Installation complete!${NC}\n"
  cat <<EOF
${BOLD}Next steps:${NC}
  - Send /start to your bot in Telegram (only ALLOWED_USERS can use it).
  - Send any file - the bot will upload it to Google Drive and reply with the link.

${BOLD}Useful commands:${NC}
  pm2 logs ${PROJECT}              # follow logs
  pm2 restart ${PROJECT}           # restart
  pm2 stop ${PROJECT}              # stop
  bash ${INSTALL_DIR}/update.sh    # pull latest code and restart
  bash ${INSTALL_DIR}/uninstall.sh # remove everything
  cd ${INSTALL_DIR} && node setup-drive.js  # re-authenticate Google Drive

EOF
}

main() {
  require_root
  banner
  cleanup_existing
  install_system_deps
  clone_repo
  collect_inputs
  confirm_summary
  write_env
  prepare_dirs
  install_npm_deps
  run_drive_setup
  setup_pm2
  success_message
}

main "$@"
