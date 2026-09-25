#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_USER:?Set the DEPLOY_USER repository secret}"
: "${DEPLOY_SSH_KEY:?Set the DEPLOY_SSH_KEY repository secret}"
: "${DEPLOY_KNOWN_HOSTS:?Set the DEPLOY_KNOWN_HOSTS repository secret}"
[[ "$DEPLOY_USER" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid DEPLOY_USER' >&2; exit 1; }

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
export RSYNC_RSH="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
# Copy checkout contents into ~/docker/wake, preserving remote-only files (including .env).
# Linux rsync spells compression -z (lowercase).
rsync -avz --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='.env' --exclude='.env.*' \
    ./ "${DEPLOY_USER}@192.168.86.2:docker/wake/"
