#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_USER:?Set the DEPLOY_USER repository secret}"
: "${DEPLOY_HOST:?Set the DEPLOY_HOST repository secret}"
: "${DEPLOY_PATH:=docker/wake}"
: "${DEPLOY_SSH_KEY:?Set the DEPLOY_SSH_KEY repository secret}"
: "${DEPLOY_KNOWN_HOSTS:?Set the DEPLOY_KNOWN_HOSTS repository secret}"
[[ "$DEPLOY_USER" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid DEPLOY_USER' >&2; exit 1; }
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid DEPLOY_HOST' >&2; exit 1; }
[[ "$DEPLOY_PATH" =~ ^[a-zA-Z0-9_./-]+$ && "$DEPLOY_PATH" != /* && "$DEPLOY_PATH" != *..* ]] || { echo 'DEPLOY_PATH must be a safe relative path without parent traversal' >&2; exit 1; }

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >> "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
export RSYNC_RSH="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
# Copy checkout contents to the configured remote directory, preserving remote-only files (including .env).
# Linux rsync spells compression -z (lowercase).
rsync -avz --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='.env' --exclude='.env.*' \
    ./ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH%/}/"

# Rebuild from the synced source and recreate the Compose services with the new image.
ssh -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" \
    "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "cd '$DEPLOY_PATH' && docker compose up -d --build --force-recreate"
