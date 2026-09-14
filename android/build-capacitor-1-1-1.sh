#!/usr/bin/env bash
set -euo pipefail

corepack enable
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@11.16.0 install --frozen-lockfile
corepack pnpm@11.16.0 test

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

npx cap sync android

mkdir -p android/app/src/main/java/net/dudiebug/chores
mkdir -p android/app/src/main/res/drawable
cp ../native/ChoresNotificationsPlugin.java android/app/src/main/java/net/dudiebug/chores/ChoresNotificationsPlugin.java
cp ../native/ChoresNotificationWorker.java android/app/src/main/java/net/dudiebug/chores/ChoresNotificationWorker.java
cp ../native/ic_stat_chores.xml android/app/src/main/res/drawable/ic_stat_chores.xml

cat > android/app/src/main/java/net/dudiebug/chores/MainActivity.java <<'JAVA'
package net.dudiebug.chores;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChoresNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
JAVA

python3 <<'PY'
from pathlib import Path
import re

build = Path("android/app/build.gradle")
text = build.read_text()
text = re.sub(r"versionCode\s+1\b", "versionCode 3", text, count=1)
text = re.sub(r'versionName\s+"[^"]+"', 'versionName "1.1.1"', text, count=1)
work = '    implementation "androidx.work:work-runtime:2.11.2"\n'
if 'androidx.work:work-runtime:2.11.2' not in text:
    marker = 'dependencies {\n'
    if marker not in text:
        raise SystemExit('Unable to locate Gradle dependencies block')
    text = text.replace(marker, marker + work, 1)
build.write_text(text)

manifest = Path("android/app/src/main/AndroidManifest.xml")
text = manifest.read_text()
perm = '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
if perm not in text:
    manifest_start = text.find('<manifest')
    root_end = text.find('>', manifest_start)
    if manifest_start < 0 or root_end < 0:
        raise SystemExit('Unable to locate Android manifest root')
    text = text[:root_end + 1] + "\n    " + perm + text[root_end + 1:]
manifest.write_text(text)
PY

grep -q 'versionCode 3' android/app/build.gradle
grep -q 'versionName "1.1.1"' android/app/build.gradle
grep -q 'androidx.work:work-runtime:2.11.2' android/app/build.gradle
grep -q 'android.permission.POST_NOTIFICATIONS' android/app/src/main/AndroidManifest.xml
grep -q 'registerPlugin(ChoresNotificationsPlugin.class)' android/app/src/main/java/net/dudiebug/chores/MainActivity.java
grep -q '"appName": "Chores"' capacitor.config.json

cd android
chmod +x gradlew
./gradlew --no-daemon clean assembleRelease bundleRelease
cd ..

mkdir -p dist
APK="$(find android/app/build/outputs/apk/release -type f -name '*.apk' -print -quit)"
AAB="$(find android/app/build/outputs/bundle/release -type f -name '*.aab' -print -quit)"
test -n "$APK" && test -s "$APK"
test -n "$AAB" && test -s "$AAB"
cp "$APK" dist/chores-1.1.1-unsigned.apk
cp "$AAB" dist/chores-1.1.1-unsigned.aab
sha256sum dist/* > dist/SHA256SUMS.txt
