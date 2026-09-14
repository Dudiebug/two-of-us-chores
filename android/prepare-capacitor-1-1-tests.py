from pathlib import Path

path = Path("test/undo-persistence.test.mjs")
text = path.read_text()
old = 'assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);'
new = 'assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);'
if new not in text:
    if old not in text:
        raise SystemExit("Unable to find schema-version migration assertion")
    path.write_text(text.replace(old, new, 1))
