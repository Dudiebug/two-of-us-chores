import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const index = await readFile(new URL('public/index.html', root), 'utf8');
const app = await readFile(new URL('public/app.js', root), 'utf8');
const colors = await readFile(new URL('public/user-colors.css', root), 'utf8');
const dialogs = await readFile(new URL('public/mobile-dialogs.css', root), 'utf8');
const server = await readFile(new URL('src/server.mjs', root), 'utf8');

test('1.2.4+ loads and serves palette/mobile dialog styles', () => {
  assert.match(index, /user-colors\.css\?v=1\.2\.4/);
  assert.match(index, /mobile-dialogs\.css\?v=1\.2\.4/);
  assert.match(colors, /#choreAssignee\[data-user-color\]/);
  assert.match(server, /PRIVATE_FILES[\s\S]*user-colors\.css/);
  assert.match(server, /PRIVATE_FILES[\s\S]*mobile-dialogs\.css/);
});

test('normal app UI renders configured user colors directly', () => {
  assert.match(app, /const userColors = new Set/);
  assert.match(app, /data-filter=.*data-user-color/);
  assert.match(app, /data-chore-id=.*data-user-color|data-user-color=.*data-chore-id/);
  assert.match(app, /history-row.*data-user-color/);
  assert.match(app, /day-dots[\s\S]*data-user-color/);
  assert.match(app, /choreAssignee.*syncAssigneeColor|syncAssigneeColor\(\)/);
});

test('every mobile dialog shares the Settings safe height and internal scrolling contract', () => {
  assert.match(dialogs, /#choreDialog,[\s\S]*#settingsDialog,[\s\S]*#confirmDialog,[\s\S]*#adminDialog/);
  assert.match(dialogs, /height:\s*min\(84dvh/);
  assert.match(dialogs, /max-height:\s*min\(84dvh/);
  assert.match(dialogs, /safe-area-inset-top/);
  assert.match(dialogs, /#choreDialog \.dialog-body,[\s\S]*#settingsDialog \.dialog-body,[\s\S]*#confirmDialog \.dialog-body,[\s\S]*#adminDialog \.dialog-body[\s\S]*overflow-y:\s*auto/);
  assert.match(dialogs, /#confirmDialog[\s\S]*margin:\s*auto 0 0/);
});
