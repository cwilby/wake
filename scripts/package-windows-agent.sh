#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Use the exact Node 24 release running the build; no independent floating download version.
node_version=$(node -p 'process.version')
[[ "$node_version" == v24.* ]] || { echo 'Build with Node 24.' >&2; exit 1; }
archive="node-${node_version}-win-x64.zip"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location --retry 3 "https://nodejs.org/dist/${node_version}/${archive}" -o "$work/$archive"
curl --fail --silent --show-error --location --retry 3 "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
(cd "$work"; awk -v name="$archive" '$2 == name {print}' SHASUMS256.txt > checksum.txt; test -s checksum.txt; sha256sum --check checksum.txt)
mkdir -p "$work/wake-agent/runtime" dist
unzip -p "$work/$archive" "node-${node_version}-win-x64/node.exe" > "$work/wake-agent/runtime/node.exe"
unzip -p "$work/$archive" "node-${node_version}-win-x64/LICENSE" > "$work/wake-agent/runtime/LICENSE"
cp agent/index.js "$work/wake-agent/agent.mjs"
cp agent/windows/*.ps1 agent/windows/README.txt "$work/wake-agent/"
printf '%s\n' "$node_version" > "$work/wake-agent/runtime/VERSION"
# Always create a fresh archive; zip updates otherwise retain removed files from earlier builds.
(cd "$work"; zip -qr wake-agent-windows-x64.zip wake-agent)
cp "$work/wake-agent-windows-x64.zip" dist/wake-agent-windows-x64.zip
