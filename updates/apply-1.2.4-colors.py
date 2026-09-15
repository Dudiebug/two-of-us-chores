from pathlib import Path

# Make the user palette styles and mobile dialog overrides actually load.
p = Path('public/index.html')
s = p.read_text()
old = '    <link rel="stylesheet" href="/styles.css?v=13">\n'
new = '    <link rel="stylesheet" href="/styles.css?v=13">\n    <link rel="stylesheet" href="/user-colors.css?v=1.2.4">\n    <link rel="stylesheet" href="/mobile-dialogs.css?v=1.2.4">\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)
p.write_text(s)

# Keep mobile dialog CSS independent from the user palette stylesheet.
p = Path('public/user-colors.css')
s = p.read_text()
s = s.replace('@import url("/mobile-dialogs.css?v=1.2.4");\n\n', '', 1)
if '#choreAssignee[data-user-color]' not in s:
    s += '''\n#choreAssignee[data-user-color] {\n  background:var(--user-bg);\n  color:var(--user-ink);\n  border-color:var(--user-dot);\n}\n#choreAssignee option[data-user-color] { color:var(--user-ink); }\n'''
p.write_text(s)

# Render colors directly from /api/state instead of depending on the admin-side
# MutationObserver/follow-up fetch to decorate the normal app UI.
p = Path('public/app.js')
s = p.read_text()
old = '  const themes = new Set(["system", "light", "dark", "blush"]);\n'
new = old + '  const userColors = new Set(["teal", "rose", "blue", "violet", "amber", "green"]);\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '''  function ownerName(id) {\n    return state.users.find((user) => user.id === id)?.name || "Former member";\n  }\n'''
new = old + '''\n  function ownerColor(id) {\n    const value = state.users.find((user) => user.id === id)?.colorKey;\n    return userColors.has(value) ? value : "teal";\n  }\n\n  function syncAssigneeColor() {\n    const select = $("#choreAssignee");\n    if (!select) return;\n    if (!select.value) delete select.dataset.userColor;\n    else select.dataset.userColor = ownerColor(select.value);\n  }\n'''
if 'function ownerColor(id)' not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    $(".filter-bar").innerHTML = `<button class="filter-button" type="button" data-filter="all">Everyone</button>` + state.users.map((u) => `<button class="filter-button" type="button" data-filter="${escapeHtml(u.id)}">${escapeHtml(u.name)}</button>`).join("");\n'
new = '    $(".filter-bar").innerHTML = `<button class="filter-button" type="button" data-filter="all">Everyone</button>` + state.users.map((u) => `<button class="filter-button" type="button" data-filter="${escapeHtml(u.id)}" data-user-color="${ownerColor(u.id)}">${escapeHtml(u.name)}</button>`).join("");\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    assignee.innerHTML = state.users.filter((u) => u.active).map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join("");\n    if (state.users.some((u) => u.active && u.id === selectedAssignee)) assignee.value = selectedAssignee;\n'
new = '    assignee.innerHTML = state.users.filter((u) => u.active).map((u) => `<option value="${escapeHtml(u.id)}" data-user-color="${ownerColor(u.id)}">${escapeHtml(u.name)}</option>`).join("");\n    if (state.users.some((u) => u.active && u.id === selectedAssignee)) assignee.value = selectedAssignee;\n    syncAssigneeColor();\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    return `<article class="chore-row ${group === "missed" ? "is-missed" : ""}" data-owner="${escapeHtml(chore.assigneeId)}" data-chore-id="${Number(chore.id)}">\n'
new = '    return `<article class="chore-row ${group === "missed" ? "is-missed" : ""}" data-owner="${escapeHtml(chore.assigneeId)}" data-user-color="${ownerColor(chore.assigneeId)}" data-chore-id="${Number(chore.id)}">\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '${owners.map((owner) => `<i data-owner="${escapeHtml(owner)}"></i>`).join("")}'
new = '${owners.map((owner) => `<i data-owner="${escapeHtml(owner)}" data-user-color="${ownerColor(owner)}"></i>`).join("")}'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    return `<article class="chore-row agenda-chore ${projected ? "is-projected" : ""}" data-owner="${escapeHtml(chore.assigneeId)}">\n'
new = '    return `<article class="chore-row agenda-chore ${projected ? "is-projected" : ""}" data-owner="${escapeHtml(chore.assigneeId)}" data-user-color="${ownerColor(chore.assigneeId)}">\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    return `<article class="history-row" data-owner="${escapeHtml(record.assigneeId)}">\n'
new = '    return `<article class="history-row" data-owner="${escapeHtml(record.assigneeId)}" data-user-color="${ownerColor(record.assigneeId)}">\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    $("#choreAssignee").value = chore?.assigneeId || state.user.id;\n'
new = old + '    syncAssigneeColor();\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '    $("#reminderMode").addEventListener("change", updateReminderFields);\n'
new = old + '    $("#choreAssignee").addEventListener("change", syncAssigneeColor);\n'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

p.write_text(s)
print('Applied Chores 1.2.4 user-color rendering and stylesheet loading fixes')
