#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_DIR=${1:?evidence directory is required}
DMG="$EVIDENCE_DIR/HamsterArchiver-v4.8.0-beta.mac.2-mac-universal.dmg"
MOUNT="$RUNNER_TEMP/hamster-ui-dmg"
PROFILE="$RUNNER_TEMP/hamster-ui-profile"
PROFILE_DATA="$PROFILE/UserData"
INSTALL_ROOT="$PROFILE/Applications"
APP="$INSTALL_ROOT/Hamster Archiver.app"
PRESERVED_APP="$RUNNER_TEMP/Hamster Archiver before replacement.app"
SETTINGS="$PROFILE_DATA/config/settings.json"
POINTER_ROOT="$HOME/Library/Application Support/Hamster Archiver"
USER_DATA_POINTER="$POINTER_ROOT/user-data-location.json"
APP_PID=
POINTER_CREATED=0
FIXTURE_ID="run-${GITHUB_RUN_ID}"
export MAC_VALIDATION_FIXTURE_ID="$FIXTURE_ID"
export MAC_VALIDATION_PROFILE_DATA="$PROFILE_DATA"

mkdir -p "$EVIDENCE_DIR" "$MOUNT" "$INSTALL_ROOT" "$PROFILE"
exec > >(tee -a "$EVIDENCE_DIR/console.log") 2>&1
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 1
    done
  fi
  if [[ "$POINTER_CREATED" == 1 && -f "$USER_DATA_POINTER" ]]; then rm -f "$USER_DATA_POINTER"; fi
  if [[ -d "$MOUNT" ]] && mount | grep -Fq "on $MOUNT "; then hdiutil detach "$MOUNT" -quiet || true; fi
}
trap 'status=$?; printf -- "- FAIL: UI or replacement validation stopped at exit code %s.\\n" "$status" >> "$EVIDENCE_DIR/report.md"; exit "$status"' ERR
trap cleanup EXIT

cat > "$EVIDENCE_DIR/report.md" <<EOF
# Supplemental macOS UI and replacement validation

- Published version: v4.8.0-beta.mac.2
- Source commit: 9800f629860a729564f98538fe561b45a0c5acdd
- Public DMG SHA-256: 536c28b940b8834e10bc94f59577ac7a200ac4d23f9f6ff2d6bba06bca72c48c
- Runner: macos-15, expected native arm64
- Isolated profile: $PROFILE
- User data pointer: $USER_DATA_POINTER
- Result: IN PROGRESS

EOF

ARCH=$(uname -m)
[[ "$ARCH" == arm64 ]]
printf 'os=%s\narchitecture=%s\n' "$(sw_vers -productVersion)" "$ARCH" > "$EVIDENCE_DIR/system.txt"
system_profiler SPHardwareDataType | sed -n '/Model Name:/p; /Model Identifier:/p; /Chip:/p; /Total Number of Cores:/p; /Memory:/p' >> "$EVIDENCE_DIR/system.txt"
if [[ -e "$USER_DATA_POINTER" ]]; then
  echo "Refusing to replace the runner's pre-existing Hamster Archiver data-location pointer." >&2
  exit 1
fi
mkdir -p "$POINTER_ROOT" "$PROFILE_DATA"
node - "$USER_DATA_POINTER" "$PROFILE_DATA" <<'NODE'
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({version:1,userDataDirectory:process.argv[3]}) + '\n', {flag:'wx'});
NODE
POINTER_CREATED=1
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" > "$EVIDENCE_DIR/dmg-mount.txt"
ditto "$MOUNT/Hamster Archiver.app" "$APP"
codesign --verify --deep --strict "$APP" 2> "$EVIDENCE_DIR/codesign-verify.txt"

launch_app() {
  "$APP/Contents/MacOS/Hamster Archiver" \
    --remote-debugging-port=9222 \
    --remote-allow-origins='*' \
    > "$EVIDENCE_DIR/app-console.log" 2>&1 &
  APP_PID=$!
}
stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID"
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$APP_PID" 2>/dev/null; then
      echo "The isolated Hamster Archiver process did not exit after SIGTERM." >&2
      return 1
    fi
  fi
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=
}

launch_app
node platforms/macos/mac-ui-cdp.cjs initial "$EVIDENCE_DIR"
[[ -s "$EVIDENCE_DIR/workbench.png" && -s "$EVIDENCE_DIR/repository.png" ]]
[[ -s "$SETTINGS" ]]
node - "$SETTINGS" "$FIXTURE_ID" "$EVIDENCE_DIR" <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keys = ['archiveFormat', 'recordBackupLocation', 'backupLocation', 'suppressOnboarding'];
const observed = Object.fromEntries(keys.map((key) => [key, settings[key]]));
fs.writeFileSync(process.argv[4] + '/persisted-settings.json', JSON.stringify(observed, null, 2) + '\n');
console.log('Persisted setting fields before replacement: ' + JSON.stringify(observed));
NODE
printf '%s\n' \
  '- PASS: The packaged app used an isolated profile and its real renderer bridge suppressed onboarding and saved distinct settings.' \
  '- PASS: Real CDP mouse input opened the workbench and warehouse; the Windows recycle-bin control was hidden; Command+V and Mac update distribution assertions passed.' \
  '- OBSERVED: The hidden Windows recycle-bin checkbox is not disabled after a configuration save.' \
  '- PASS: A real renderer-bridge-created catalog record was visible in the warehouse screenshot.' >> "$EVIDENCE_DIR/report.md"

stop_app
[[ -d "$APP" ]]
mv "$APP" "$PRESERVED_APP"
ditto "$MOUNT/Hamster Archiver.app" "$APP"
codesign --verify --deep --strict "$APP" 2> "$EVIDENCE_DIR/replacement-codesign-verify.txt"
launch_app
node platforms/macos/mac-ui-cdp.cjs after-replacement "$EVIDENCE_DIR"
[[ -s "$EVIDENCE_DIR/after-replacement.png" ]]
printf '%s\n' '- PASS: After a clean application exit and replacement with the same DMG bundle, the custom settings and warehouse record remained in the same profile and rendered again.' >> "$EVIDENCE_DIR/report.md"
sed -i '' 's/- Result: IN PROGRESS/- Result: PASS/' "$EVIDENCE_DIR/report.md"
{
  printf 'settings_path=%s\n' "$SETTINGS"
  printf 'user_data_pointer=%s\n' "$USER_DATA_POINTER"
  printf 'isolated_user_data_root=%s\n' "$PROFILE_DATA"
  printf 'fixture_id=%s\n' "$FIXTURE_ID"
  printf 'replacement_install_path=%s\n' "$APP"
} >> "$EVIDENCE_DIR/system.txt"
