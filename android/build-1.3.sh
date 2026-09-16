#!/usr/bin/env bash
set -euo pipefail
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@11.16.0 install --frozen-lockfile
corepack pnpm@11.16.0 test
cd android/capacitor
npm install --no-audit --no-fund
if [[ ! -d android ]]; then npx cap add android; fi
npx cap sync android
python3 ../../tools/generate-icons.py
mkdir -p android/app/src/main/java/net/dudiebug/chores android/app/src/main/res/drawable android/app/src/androidTest/java/net/dudiebug/chores
cp ../native/*.java android/app/src/main/java/net/dudiebug/chores/
cp ../native/ic_stat_chores.xml android/app/src/main/res/drawable/
cp ../tests/*.java android/app/src/androidTest/java/net/dudiebug/chores/
cp ../firebase/google-services.json android/app/google-services.json
python3 <<'PY'
from pathlib import Path
import re
import xml.etree.ElementTree as ET
for sample in Path('android/app/src/androidTest').rglob('ExampleInstrumentedTest.java'):
    sample.write_text(sample.read_text().replace('com.getcapacitor.app','net.dudiebug.chores'))
root=Path('android/build.gradle');s=root.read_text()
if 'com.google.gms:google-services' not in s:
    s=s.replace('dependencies {','''dependencies {
        classpath 'com.google.gms:google-services:4.5.0' ''',1)
root.write_text(s)
p=Path('android/app/build.gradle');s=p.read_text()
s=re.sub(r'versionCode\s+\d+', 'versionCode 11',s,count=1)
s=re.sub(r'versionName\s+"[^"]+"', 'versionName "1.3.0"',s,count=1)
s=s.replace('dependencies {','''dependencies {
    implementation "androidx.work:work-runtime:2.11.2"
    implementation platform("com.google.firebase:firebase-bom:34.19.0")
    implementation "com.google.firebase:firebase-messaging"
    androidTestImplementation "androidx.test.ext:junit:1.2.1"
    androidTestImplementation "androidx.test:core:1.6.1"
    androidTestImplementation "androidx.test:runner:1.6.2"
    androidTestImplementation "androidx.test.uiautomator:uiautomator:2.3.0"
''',1)
if 'apply plugin: \'com.google.gms.google-services\'' not in s:
    s += "\napply plugin: 'com.google.gms.google-services'\n"
p.write_text(s)
manifest=Path('android/app/src/main/AndroidManifest.xml')
ET.register_namespace('android','http://schemas.android.com/apk/res/android')
android='{http://schemas.android.com/apk/res/android}'
tree=ET.parse(manifest); root=tree.getroot()
if not any(node.get(android+'name') == 'android.permission.POST_NOTIFICATIONS' for node in root.findall('uses-permission')):
    root.insert(0,ET.Element('uses-permission',{android+'name':'android.permission.POST_NOTIFICATIONS'}))
application=root.find('application'); application.set(android+'allowBackup','false'); application.set(android+'icon','@mipmap/chores_launcher'); application.set(android+'roundIcon','@mipmap/chores_launcher_round')
for activity in application.findall('activity'):
    if activity.get(android+'name') == '.MainActivity': activity.set(android+'icon','@mipmap/chores_launcher')
if not any(node.get(android+'name') == '.ChoresFirebaseMessagingService' for node in application.findall('service')):
    service=ET.SubElement(application,'service',{android+'name':'.ChoresFirebaseMessagingService',android+'exported':'false'})
    intent=ET.SubElement(service,'intent-filter')
    ET.SubElement(intent,'action',{android+'name':'com.google.firebase.MESSAGING_EVENT'})
ET.indent(tree,space='    '); tree.write(manifest,encoding='unicode',xml_declaration=True)
PY
grep -q 'versionCode 11' android/app/build.gradle
grep -q 'versionName "1.3.0"' android/app/build.gradle
grep -q 'com.google.firebase:firebase-messaging' android/app/build.gradle
grep -q 'ChoresFirebaseMessagingService' android/app/src/main/AndroidManifest.xml
grep -q 'android:icon="@mipmap/chores_launcher"' android/app/src/main/AndroidManifest.xml
grep -q 'android:roundIcon="@mipmap/chores_launcher_round"' android/app/src/main/AndroidManifest.xml
test -s android/app/google-services.json
test -s android/app/src/main/res/mipmap-anydpi-v33/chores_launcher.xml
cd android
chmod +x gradlew
./gradlew --no-daemon :app:assembleRelease :app:bundleRelease :app:assembleDebug :app:assembleDebugAndroidTest
cd ..
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release-unsigned.apk dist/chores-1.3.0-unsigned.apk
cp android/app/build/outputs/bundle/release/app-release.aab dist/chores-1.3.0-unsigned.aab
cp package-lock.json dist/android-package-lock.json
(cd dist && sha256sum * > SHA256SUMS.txt)
