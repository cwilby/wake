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
printf '%s\n' "$AGENT_WINDOWS_DEPLOY_KNOWN_HOSTS" >> "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
export RSYNC_RSH="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
# Copy checkout contents into ~/docker/wake, preserving remote-only files (including .env).
# Linux rsync spells compression -z (lowercase).
rsync -avz --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='.env' --exclude='.env.*' \
    ./ "${DEPLOY_USER}@192.168.86.2:docker/wake/"

# Rebuild from the synced source and recreate the Compose services with the new image.
ssh -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" \
    "${DEPLOY_USER}@192.168.86.2" \
    'cd docker/wake && docker compose up -d --build --force-recreate'

# Deploy the uploaded artifact for this gitea action
if [[ -f dist/wake-agent-windows-x64.zip ]]; then
    scp -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
        -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" \
        ./dist/wake-agent-windows-x64.zip \
        "${AGENT_WINDOWS_DEPLOY_USERNAME}@${AGENT_WINDOWS_DEPLOY_HOST}:/C:/Applications/wake-agent-windows-x64.zip"

    ssh -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
        -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" \
        "${AGENT_WINDOWS_DEPLOY_USERNAME}@${AGENT_WINDOWS_DEPLOY_HOST}" \
        'powershell.exe -NoProfile -NonInteractive -Command "& {
            Stop-ScheduledTask -TaskName \"Wake Agent\" -ErrorAction SilentlyContinue;
            Remove-Item -Recurse -Force \"C:\Applications\wake-agent\" -ErrorAction SilentlyContinue;
            New-Item -ItemType Directory -Force \"C:\Applications\wake-agent\" | Out-Null;
            Expand-Archive -Path \"C:\Applications\wake-agent-windows-x64.zip\" -DestinationPath \"C:\Applications\wake-agent\" -Force;
            Remove-Item \"C:\Applications\wake-agent-windows-x64.zip\";
            Start-ScheduledTask -TaskName \"Wake Agent\";
        }"'
fi