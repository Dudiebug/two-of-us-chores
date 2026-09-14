from pathlib import Path
import json

p=Path('android/capacitor/package.json')
config=json.loads(p.read_text()); config['devDependencies'].pop('@capacitor/assets',None)
p.write_text(json.dumps(config,indent=2)+'\n')

p=Path('android/build-1.2.sh'); s=p.read_text()
s=s.replace('./gradlew --no-daemon assembleRelease bundleRelease assembleDebug assembleDebugAndroidTest','./gradlew --no-daemon :app:assembleRelease :app:bundleRelease :app:assembleDebug :app:assembleDebugAndroidTest')
a=s.index('mkdir -p assets\n'); b=s.index('npx cap sync android',a)
s=s[:a]+'python3 ../../tools/generate-icons.py\n'+s[b:]
s=s.replace("import re\np=Path('android/app/build.gradle')", "import re\nfor sample in Path('android/app/src/androidTest').rglob('ExampleInstrumentedTest.java'):\n    sample.write_text(sample.read_text().replace('com.getcapacitor.app','net.dudiebug.chores'))\np=Path('android/app/build.gradle')",1)
p.write_text(s)

Path('tools/generate-icons.py').write_text('''"""Render the checked-in checklist artwork without a Node native-addon dependency."""
from pathlib import Path
import cairosvg

root=Path(__file__).resolve().parent.parent
res=root/'android/capacitor/android/app/src/main/res'
source=(root/'public/icon.svg').read_bytes()
for n in (192,512):
    cairosvg.svg2png(bytestring=source,write_to=str(root/f'public/icon-{n}.png'),output_width=n,output_height=n)
for density,n,foreground in [('mdpi',48,108),('hdpi',72,162),('xhdpi',96,216),('xxhdpi',144,324),('xxxhdpi',192,432)]:
    folder=res/f'mipmap-{density}'; folder.mkdir(parents=True,exist_ok=True)
    for name in ('ic_launcher','ic_launcher_round'):
        cairosvg.svg2png(bytestring=source,write_to=str(folder/f'{name}.png'),output_width=n,output_height=n)
    cairosvg.svg2png(bytestring=source,write_to=str(folder/'ic_launcher_foreground.png'),output_width=foreground,output_height=foreground)
values=res/'values'; values.mkdir(exist_ok=True,parents=True)
(values/'icon_background.xml').write_text('<resources><color name="chores_icon_background">#087f83</color></resources>')
adaptive=res/'mipmap-anydpi-v26'; adaptive.mkdir(exist_ok=True,parents=True)
for name in ('ic_launcher','ic_launcher_round'):
    (adaptive/f'{name}.xml').write_text('<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/chores_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>')
# Keep the splash artwork consistent with the launcher (no stock Capacitor logo).
for folder in res.glob('drawable*'):
    splash=folder/'splash.png'
    if splash.exists():
        cairosvg.svg2png(bytestring=source,write_to=str(splash),output_width=512,output_height=512)
print('Rendered Chores checklist web, launcher, adaptive and splash icons.')
''')

p=Path('src/groups.mjs'); s=p.read_text()
anchor='    if (db.prepare("PRAGMA foreign_key_check").all().length)'
addition='''    if (db.prepare("SELECT 1 FROM groups WHERE id='legacy'").get()) {
      db.exec(`UPDATE notification_markers SET marker_key=
        substr(marker_key,1,instr(marker_key,':')) || 'legacy:' || substr(marker_key,instr(marker_key,':')+1)
        WHERE marker_key LIKE 'digest:%' OR marker_key LIKE 'missed:%' OR marker_key LIKE 'chore:%'`);
    }
'''
assert anchor in s; p.write_text(s.replace(anchor,addition+anchor,1))
p=Path('public/styles.css'); p.write_text(p.read_text()+'''
.admin-form input:not([type="checkbox"]), .admin-item input:not([type="checkbox"]), .admin-item select {
  min-height:44px; padding:.6rem .75rem; border:1px solid var(--line); border-radius:10px;
  color:var(--ink); background:var(--field); font:inherit; width:100%;
}
.admin-form input[type="checkbox"], .admin-item input[type="checkbox"] { width:20px; height:20px; }
''')
Path('test/migration-markers.test.mjs').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateGroups } from '../src/groups.mjs';

test('v6 migration preserves notification deduplication across upgrade and repeated startup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,initial TEXT,password_salt TEXT,password_hash TEXT,digest_time TEXT,missed_alert_time TEXT,default_reminder_time TEXT,activity_notifications INTEGER,updated_at TEXT);
      INSERT INTO users VALUES ('D','Dylan','D','salt','hash',NULL,NULL,NULL,1,'2026-09-14');
      CREATE TABLE chores(id INTEGER PRIMARY KEY); INSERT INTO chores VALUES (1);
      CREATE TABLE completion_history(id INTEGER PRIMARY KEY,undo_snapshot TEXT);
      CREATE TABLE native_notification_events(id INTEGER PRIMARY KEY);
      CREATE TABLE notification_markers(marker_key TEXT PRIMARY KEY,sent_at TEXT);
      INSERT INTO notification_markers VALUES ('digest:D:2026-09-14','preserved'),('chore:D:1:2026-09-14','preserved'),('other:unchanged','preserved');
      PRAGMA user_version=6;`);
    migrateGroups(db,'UTC');
    const values=db.prepare('SELECT marker_key FROM notification_markers ORDER BY marker_key').all().map(r=>r.marker_key);
    assert.deepEqual(values,['chore:legacy:D:1:2026-09-14','digest:legacy:D:2026-09-14','other:unchanged']);
    migrateGroups(db,'UTC');
    assert.deepEqual(db.prepare('SELECT marker_key FROM notification_markers ORDER BY marker_key').all().map(r=>r.marker_key),values);
    assert.equal(db.prepare("SELECT count(*) AS n FROM notification_markers WHERE sent_at='preserved'").get().n,3);
  } finally { db.close(); }
});
''')
