from pathlib import Path
p = Path('android/build-1.2.sh')
s = p.read_text()
old = './gradlew --no-daemon assembleRelease bundleRelease assembleDebug assembleDebugAndroidTest'
new = './gradlew --no-daemon :app:assembleRelease :app:bundleRelease :app:assembleDebug :app:assembleDebugAndroidTest'
assert old in s
p.write_text(s.replace(old, new, 1))
