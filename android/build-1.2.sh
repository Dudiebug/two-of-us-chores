#!/usr/bin/env bash
set -euo pipefail
corepack enable
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@11.16.0 install --frozen-lockfile
corepack pnpm@11.16.0 test
cd android/capacitor
npm install --no-audit --no-fund
if [[ ! -d android ]]; then npx cap add android; fi
python3 ../../tools/generate-icons.py
npx cap sync android
mkdir -p android/app/src/main/java/net/dudiebug/chores android/app/src/main/res/drawable android/app/src/androidTest/java/net/dudiebug/chores
cp ../native/*.java android/app/src/main/java/net/dudiebug/chores/
cp ../native/ic_stat_chores.xml android/app/src/main/res/drawable/
cp ../tests/*.java android/app/src/androidTest/java/net/dudiebug/chores/
python3 <<'PY'
from pathlib import Path
import re
for sample in Path('android/app/src/androidTest').rglob('ExampleInstrumentedTest.java'):
    sample.write_text(sample.read_text().replace('com.getcapacitor.app','net.dudiebug.chores'))
p=Path('android/app/build.gradle');s=p.read_text()
s=re.sub(r'versionCode\s+\d+', 'versionCode 4',s,count=1)
s=re.sub(r'versionName\s+"[^"]+"', 'versionName "1.2.0"',s,count=1)
s=s.replace('dependencies {','''dependencies {
    implementation "androidx.work:work-runtime:2.11.2"
    androidTestImplementation "androidx.test.ext:junit:1.2.1"
    androidTestImplementation "androidx.test:core:1.6.1"
    androidTestImplementation "androidx.test:runner:1.6.2"
    androidTestImplementation "androidx.test.uiautomator:uiautomator:2.3.0"
''',1)
p.write_text(s)
p=Path('android/app/src/main/AndroidManifest.xml');s=p.read_text();s=s.replace('<application','<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n    <application',1)
s=s.replace('android:allowBackup="true"','android:allowBackup="false"');p.write_text(s)
PY
cd android
chmod +x gradlew
./gradlew --no-daemon :app:assembleRelease :app:bundleRelease :app:assembleDebug :app:assembleDebugAndroidTest
cd ..
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release-unsigned.apk dist/chores-1.2.0-unsigned.apk
cp android/app/build/outputs/bundle/release/app-release.aab dist/chores-1.2.0-unsigned.aab
cp package-lock.json dist/android-package-lock.json
(cd dist && sha256sum * > SHA256SUMS.txt)
