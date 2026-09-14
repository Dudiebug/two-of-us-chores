#!/usr/bin/env bash
set -euo pipefail

python3 android/prepare-capacitor-1-1.py

corepack enable
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@11.16.0 install --frozen-lockfile
corepack pnpm@11.16.0 test

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add src/server.mjs src/db.mjs public/index.html public/native-app.js test/native-notifications.test.mjs docs/ANDROID_CAPACITOR.md
if ! git diff --cached --quiet; then
  git commit -m "Add Capacitor native notification support"
  git push origin HEAD:main
fi

cd android/capacitor
rm -rf android node_modules package-lock.json dist assets
npm install --no-audit --no-fund
npx cap add android

mkdir -p assets
cp ../../public/icon.svg assets/icon.svg
npx @capacitor/assets generate --android \
  --iconBackgroundColor '#c65a6b' \
  --iconBackgroundColorDark '#c65a6b' \
  --splashBackgroundColor '#161e20' \
  --splashBackgroundColorDark '#161e20'

python3 <<'PY'
from pathlib import Path
import re

build = Path("android/app/build.gradle")
text = build.read_text()
text = re.sub(r"versionCode\s+1\b", "versionCode 2", text, count=1)
text = re.sub(r'versionName\s+"[^"]+"', 'versionName "1.1.0"', text, count=1)
runner_lib = "../../node_modules/@capacitor/background-runner/android/src/main/libs"
if runner_lib not in text:
    marker = "dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'"
    if marker in text:
        text = text.replace(marker, marker + f", '{runner_lib}'", 1)
    else:
        text += f"\nrepositories {{\n    flatDir {{ dirs '{runner_lib}' }}\n}}\n"
build.write_text(text)

manifest = Path("android/app/src/main/AndroidManifest.xml")
text = manifest.read_text()
perm = '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
if perm not in text:
    text = text.replace("<manifest", "<manifest", 1)
    close = text.find(">")
    text = text[:close + 1] + "\n    " + perm + text[close + 1:]
manifest.write_text(text)
PY

npx cap sync android

# cap sync can rewrite Gradle metadata, so assert our release identity remains intact.
grep -q 'versionCode 2' android/app/build.gradle
grep -q 'versionName "1.1.0"' android/app/build.gradle

cd android
chmod +x gradlew
./gradlew --no-daemon clean assembleRelease bundleRelease
cd ..

mkdir -p dist
APK="$(find android/app/build/outputs/apk/release -type f -name '*.apk' -print -quit)"
AAB="$(find android/app/build/outputs/bundle/release -type f -name '*.aab' -print -quit)"
test -n "$APK" && test -s "$APK"
test -n "$AAB" && test -s "$AAB"
cp "$APK" dist/two-of-us-chores-1.1.0-unsigned.apk
cp "$AAB" dist/two-of-us-chores-1.1.0-unsigned.aab
sha256sum dist/* > dist/SHA256SUMS.txt
