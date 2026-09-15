from pathlib import Path
p = Path('public/app.js')
s = p.read_text()
old = '''      state.user = { ...state.user, colorKey };
      state.users = state.users.map((user) => user.id === state.user.id ? { ...user, colorKey } : user);
      render();
      $("#userColorSuccess").hidden = false;
'''
new = '''      state.user = { ...state.user, colorKey };
      state.users = state.users.map((user) => user.id === state.user.id ? { ...user, colorKey } : user);
      $$('[data-owner], .filter-button[data-filter]').forEach((element) => {
        const ownerId = element.dataset.owner || element.dataset.filter;
        if (ownerId === state.user.id) element.dataset.userColor = colorKey;
      });
      syncAssigneeColor();
      render();
      $("#userColorSuccess").hidden = false;
'''
assert old in s
p.write_text(s.replace(old, new, 1))
print('Updates visible ownership colors immediately after self-service color changes')
