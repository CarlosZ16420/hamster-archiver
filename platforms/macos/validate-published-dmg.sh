#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_DIR=${1:?evidence directory is required}
RELEASE_TAG=${RELEASE_TAG:-v4.8.0-beta.mac.2}
EXPECTED_ARCH=${EXPECTED_ARCH:?expected architecture is required}
DMG="$EVIDENCE_DIR/HamsterArchiver-${RELEASE_TAG}-mac-universal.dmg"
MOUNT="$RUNNER_TEMP/hamster-dmg"
INSTALL_ROOT="$HOME/Applications"
APP="$INSTALL_ROOT/Hamster Archiver.app"
APFS_SOURCE_IMAGE="$RUNNER_TEMP/hamster-source.sparsebundle"
APFS_OUTPUT_IMAGE="$RUNNER_TEMP/hamster-output.sparsebundle"
APFS_SOURCE="$RUNNER_TEMP/hamster-source-volume"
APFS_OUTPUT="$RUNNER_TEMP/hamster-output-volume"
REPORT="$EVIDENCE_DIR/report.md"
SYSTEM="$EVIDENCE_DIR/system.txt"

mkdir -p "$EVIDENCE_DIR" "$MOUNT" "$INSTALL_ROOT" "$APFS_SOURCE" "$APFS_OUTPUT"
exec > >(tee -a "$EVIDENCE_DIR/console.log") 2>&1
cat > "$REPORT" <<EOF
# macOS validation: ${RELEASE_TAG}

- Source commit: 9800f629860a729564f98538fe561b45a0c5acdd
- Public DMG SHA-256: 536c28b940b8834e10bc94f59577ac7a200ac4d23f9f6ff2d6bba06bca72c48c
- Expected runner architecture: ${EXPECTED_ARCH}
- Result: IN PROGRESS

EOF
cleanup() {
  if [[ -d "$MOUNT" ]] && mount | grep -Fq "on $MOUNT "; then hdiutil detach "$MOUNT" -quiet || true; fi
  if [[ -d "$APFS_SOURCE" ]] && mount | grep -Fq "on $APFS_SOURCE "; then hdiutil detach "$APFS_SOURCE" -quiet || true; fi
  if [[ -d "$APFS_OUTPUT" ]] && mount | grep -Fq "on $APFS_OUTPUT "; then hdiutil detach "$APFS_OUTPUT" -quiet || true; fi
}
FAILURE_COMMAND=not-recorded
FAILURE_CONTEXT=not-recorded
set -E
trap 'failure_status=$?; FAILURE_COMMAND=$BASH_COMMAND; FAILURE_CONTEXT=$(caller); exit "$failure_status"' ERR
on_exit() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    printf '%s\n' "- FAIL: macOS command failed with exit code ${status}." "- Failed command: \`${FAILURE_COMMAND}\`" "- Failure context: \`${FAILURE_CONTEXT}\`" >> "$REPORT"
  fi
  cleanup
}
trap on_exit EXIT
passed() { printf '%s\n' "- PASS: $1" >> "$REPORT"; }
set -x

ARCH=$(uname -m)
[[ "$ARCH" == "$EXPECTED_ARCH" ]]
printf 'os=%s\narchitecture=%s\nrunner=%s\n' "$(sw_vers -productVersion)" "$ARCH" "$RUNNER_NAME" > "$SYSTEM"
system_profiler SPHardwareDataType | sed -n '/Model Name:/p; /Model Identifier:/p; /Chip:/p; /Processor Name:/p; /Total Number of Cores:/p; /Memory:/p' >> "$SYSTEM"
passed "The workflow ran on the requested native ${ARCH} macOS runner."

hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" > "$EVIDENCE_DIR/dmg-mount.txt"
ditto "$MOUNT/Hamster Archiver.app" "$APP"
hdiutil detach "$MOUNT" -quiet
[[ -x "$APP/Contents/MacOS/Hamster Archiver" ]]
ARCHS=$(lipo -archs "$APP/Contents/MacOS/Hamster Archiver")
[[ " $ARCHS " == *" arm64 "* && " $ARCHS " == *" x86_64 "* ]]
codesign --verify --deep --strict --verbose=2 "$APP" 2> "$EVIDENCE_DIR/codesign-verify.txt"
codesign -dv --verbose=4 "$APP" 2> "$EVIDENCE_DIR/codesign-details.txt" || true
printf 'app_architectures=%s\n' "$ARCHS" >> "$SYSTEM"
passed "The downloaded DMG mounted, the app copied to an Applications-style folder, and the universal app bundle signature and both slices verified."

if spctl --assess --type execute --verbose=4 "$APP" > "$EVIDENCE_DIR/gatekeeper-assessment.txt" 2>&1; then
  GATEKEEPER_RESULT=accepted
else
  GATEKEEPER_RESULT=blocked
fi
printf 'gatekeeper_assessment=%s\n' "$GATEKEEPER_RESULT" >> "$SYSTEM"

open -n "$APP"
sleep 20
if ! pgrep -f "$APP/Contents/MacOS/Hamster Archiver" >/dev/null; then
  printf '%s\n' '- FAIL: The installed GUI process did not remain running after launch.' >> "$REPORT"
  cat "$EVIDENCE_DIR/codesign-details.txt" >> "$REPORT"
  exit 1
fi
osascript -e 'tell application id "com.carlosz.hamsterarchiver" to activate' >/dev/null 2>&1 || true
sleep 2
UI_AUTOMATION=unavailable
if osascript <<'APPLESCRIPT' >/dev/null 2>&1
tell application "System Events"
  tell process "Hamster Archiver"
    set frontmost to true
    try
      click button "Skip guide" of window 1
    on error
      click button "跳过引导" of window 1
    end try
    delay 1
    try
      click button "Workbench" of window 1
    on error
      click button "归档工作台" of window 1
    end try
  end tell
end tell
APPLESCRIPT
then UI_AUTOMATION=workbench-selected; fi
printf 'ui_automation=%s\n' "$UI_AUTOMATION" >> "$SYSTEM"
sleep 1
screencapture -x "$EVIDENCE_DIR/desktop.png"
[[ -s "$EVIDENCE_DIR/desktop.png" ]]
PIXELS=$(sips -g pixelWidth -g pixelHeight "$EVIDENCE_DIR/desktop.png" | tail -n 2 | tr '\n' ' ')
printf 'screenshot=%s\n' "$PIXELS" >> "$SYSTEM"
passed "The installed GUI launched in macOS and a real desktop screenshot was captured."

APP_SUPPORT="$HOME/Library/Application Support/Hamster Archiver"
SETTINGS="$APP_SUPPORT/config/settings.json"
for _ in $(seq 1 30); do [[ -s "$SETTINGS" ]] && break; sleep 1; done
[[ -s "$SETTINGS" ]]
node -e 'const fs=require("node:fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!s.userDataDirectory||s.userDataDirectory!==process.argv[2])process.exit(1);' "$SETTINGS" "$APP_SUPPORT"
osascript -e 'tell application id "com.carlosz.hamsterarchiver" to quit' >/dev/null 2>&1 || true
sleep 2
open -n "$APP"
sleep 8
node -e 'const fs=require("node:fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!s.userDataDirectory||s.userDataDirectory!==process.argv[2])process.exit(1);' "$SETTINGS" "$APP_SUPPORT"
passed "The real installed app created settings in ~/Library/Application Support and retained the same data root across a clean relaunch."

hdiutil create -size 4g -fs 'Case-sensitive APFS' -volname HamsterSource -type SPARSEBUNDLE "$APFS_SOURCE_IMAGE"
hdiutil create -size 4g -fs APFS -volname HamsterOutput -type SPARSEBUNDLE "$APFS_OUTPUT_IMAGE"
hdiutil attach -nobrowse -mountpoint "$APFS_SOURCE" "$APFS_SOURCE_IMAGE" >/dev/null
hdiutil attach -nobrowse -mountpoint "$APFS_OUTPUT" "$APFS_OUTPUT_IMAGE" >/dev/null
SOURCE="$APFS_SOURCE/Source"
OUTPUT="$APFS_OUTPUT/Archives"
mkdir -p "$SOURCE" "$OUTPUT" "$APFS_SOURCE/Case" "$APFS_SOURCE/case"
[[ "$(stat -f %i "$APFS_SOURCE/Case")" != "$(stat -f %i "$APFS_SOURCE/case")" ]]
printf 'lower case entry\n' > "$SOURCE/Case-Sample.txt"
printf 'upper case entry\n' > "$SOURCE/case-sample.txt"
dd if=/dev/urandom of="$SOURCE/random-payload.bin" bs=1048576 count=8 2> "$EVIDENCE_DIR/fixture-generation.txt"
node -e 'require("node:fs").writeFileSync(require("node:path").join(process.argv[1],"Caf\u00e9.txt"),"normalized unicode entry\n");' "$SOURCE"
node -e 'const fs=require("node:fs");const path=require("node:path");const dir=process.argv[1];const composed=fs.statSync(path.join(dir,"Caf\u00e9.txt"));const decomposed=fs.statSync(path.join(dir,"Cafe\u0301.txt"));if(composed.dev!==decomposed.dev||composed.ino!==decomposed.ino)process.exit(1);' "$SOURCE"
printf 'HAMSTER_VALIDATION_EXTERNAL_SENTINEL_9f4c33\n' > "$APFS_OUTPUT/EXTERNAL-SENTINEL.txt"
ln -s "$APFS_OUTPUT/EXTERNAL-SENTINEL.txt" "$SOURCE/external-link.txt"
[[ -L "$SOURCE/external-link.txt" ]]
[[ "$(stat -f %d "$SOURCE")" != "$(stat -f %d "$OUTPUT")" ]]
printf 'source_volume=%s\noutput_volume=%s\n' "$(diskutil info "$APFS_SOURCE" | awk -F': *' '/File System Personality/ {print $2; exit}')" "$(diskutil info "$APFS_OUTPUT" | awk -F': *' '/File System Personality/ {print $2; exit}')" >> "$SYSTEM"
passed "Case-distinct names remained separate on case-sensitive APFS; composed/decomposed Unicode names resolved to the same APFS object; source and output were on different APFS volumes; a cross-volume symlink fixture was present."

CLI="$APP/Contents/Resources/hamster"
"$CLI" version --json > "$EVIDENCE_DIR/cli-version.json"
INTAKE=$("$CLI" intake "$SOURCE" --archive --layout single --source keep --output "$OUTPUT" --json)
TASK_ID=$(printf '%s' "$INTAKE" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const r=JSON.parse(s);const id=r.task&&r.task.id;if(!id)process.exit(1);process.stdout.write(id);});')
WAIT=$("$CLI" task wait "$TASK_ID" --timeout 60 --json)
printf '%s\n' "$WAIT" > "$EVIDENCE_DIR/archive-task.json"
printf '%s' "$WAIT" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.task?.terminal!==true||!new Set(["completed","completed_with_warnings"]).has(r.task.status)||Number(r.summary?.created)<1)process.exit(1);});'
ARCHIVE=$(find "$OUTPUT" -type f \( -name '*.7z' -o -name '*.zip' \) -print -quit)
[[ -n "$ARCHIVE" ]]
SEVEN_ZIP="$APP/Contents/Resources/tools/7zip/7zz"
"$SEVEN_ZIP" t "$ARCHIVE" > "$EVIDENCE_DIR/archive-verify.txt"
"$SEVEN_ZIP" l "$ARCHIVE" > "$EVIDENCE_DIR/archive-list.txt"
EXTRACT="$APFS_SOURCE/Extracted"
mkdir -p "$EXTRACT"
"$SEVEN_ZIP" x "$ARCHIVE" "-o$EXTRACT" > "$EVIDENCE_DIR/archive-extract.txt"
grep -Fq 'Case-Sample.txt' "$EVIDENCE_DIR/archive-list.txt"
grep -Fq 'case-sample.txt' "$EVIDENCE_DIR/archive-list.txt"
grep -Fq 'Café.txt' "$EVIDENCE_DIR/archive-list.txt"
while IFS= read -r -d '' file; do
  if grep -Fq 'HAMSTER_VALIDATION_EXTERNAL_SENTINEL_9f4c33' "$file"; then
  printf '%s\n' '- FAIL: The archive followed a symlink and included content outside the source.' >> "$REPORT"
  exit 1
  fi
done < <(find "$EXTRACT" -type f -print0)
if grep -Fq 'EXTERNAL-SENTINEL' "$EVIDENCE_DIR/archive-list.txt"; then
  printf '%s\n' '- FAIL: The archive included the external file name.' >> "$REPORT"
  exit 1
fi
passed "The packaged CLI completed a verified archive from case-sensitive APFS to a separate APFS volume, preserving case-distinct and Unicode paths without following an external symlink."

sed -i '' 's/- Result: IN PROGRESS/- Result: PASS/' "$REPORT"
cat >> "$REPORT" <<EOF
- Gatekeeper assessment from \`spctl\`: ${GATEKEEPER_RESULT}; the build is documented as ad-hoc signed and not notarized.
- Human approval through System Settings → Privacy & Security was not performed by this runner.
EOF
