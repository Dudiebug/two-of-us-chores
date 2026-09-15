# Verification trigger: Chores 1.2.3
from pathlib import Path

p = Path('public/app.js')
s = p.read_text()
old = '''    groupSelect.value = state.groupId || "";
    groupSelect.disabled = state.groups.length < 2;
    $("#groupTimezone").textContent = data.activeGroup?.timeZone || "Ask an administrator to add you to a group.";'''
new = '''    groupSelect.value = state.groupId || "";
    groupSelect.disabled = state.groups.length < 2;
    $(".group-toolbar").hidden = state.groups.length === 1;
    $("#groupTimezone").textContent = data.activeGroup?.timeZone || "Ask an administrator to add you to a group.";'''
if new not in s:
    assert old in s, 'group picker state block changed unexpectedly'
    s = s.replace(old, new, 1)
p.write_text(s)
print('Applied Chores 1.2.3 single-group picker behavior')
