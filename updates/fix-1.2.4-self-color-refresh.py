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
      await loadState({ silent: true });
      $("#userColorSuccess").hidden = false;
'''
assert old in s
p.write_text(s.replace(old, new, 1))
print('Refreshes visible ownership colors immediately after self-service color changes')
