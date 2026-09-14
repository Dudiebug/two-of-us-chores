(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state;
  async function api(path, method = "GET", body) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || "Request failed"); return data;
  }
  const message = (text) => { $("#adminMessage").textContent = text; };
  async function refresh() {
    state = await api("/api/admin/state");
    $("#adminUsers").innerHTML = state.users.map((u) => `<form class="admin-item" data-user="${esc(u.id)}"><strong>${esc(u.username)}</strong>
      <label>Display name<input name="name" value="${esc(u.name)}" required maxlength="80"></label>
      <label class="check-field"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>
      <label class="check-field"><input type="checkbox" name="isAdmin" ${u.isAdmin ? 'checked' : ''}> Administrator</label>
      <label>Reset password (leave blank to keep)<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password"></label>
      <button class="button button-secondary" type="submit">Save user</button></form>`).join("");
    $("#adminGroups").innerHTML = state.groups.map((g) => {
      const members = state.memberships.filter((m) => m.groupId === g.id);
      return `<section class="admin-item" data-group="${esc(g.id)}"><form data-group-edit="${esc(g.id)}" class="admin-form"><label>Name<input name="name" value="${esc(g.name)}" required maxlength="80"></label><label>Timezone<input name="timeZone" value="${esc(g.timeZone)}" required maxlength="100"></label><label class="check-field"><input type="checkbox" name="archived" ${g.archivedAt ? 'checked' : ''}> Archived</label><button type="submit" class="button button-secondary">Save group</button></form>
      <div>${members.map((m) => { const u = state.users.find((u) => u.id === m.userId); return `<div class="inline-actions"><span>${esc(u?.name || 'Member')} (${esc(u?.username || '')})</span><button class="text-button" type="button" data-remove="${esc(m.userId)}" ${g.archivedAt ? 'disabled' : ''}>Remove</button></div>`; }).join("") || '<p>No members yet.</p>'}</div>
      ${g.archivedAt ? '' : `<form data-member-add="${esc(g.id)}" class="admin-form"><label>Add member<select name="userId" required><option value="">Select user</option>${state.users.filter((u) => u.active && !members.some((m) => m.userId === u.id)).map((u) => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.username)})</option>`).join("")}</select></label><button type="submit" class="button button-secondary">Add to group</button></form>`}</section>`;
    }).join("");
  }
  async function change(action) {
    const buttons = [...$("#adminDialog").querySelectorAll("button")]; buttons.forEach((b) => b.disabled = true);
    try { await action(); await refresh(); message("Saved."); window.dispatchEvent(new Event("chores-admin-changed")); }
    catch (error) { message(error.message); }
    finally { buttons.forEach((b) => b.disabled = false); }
  }
  $("#adminButton").addEventListener("click", async () => { $("#adminDialog").showModal(); message("Loading…"); try { await refresh(); message(""); } catch (e) { message(e.message); } });
  $("#closeAdmin").addEventListener("click", () => $("#adminDialog").close());
  $("#adminDialog").addEventListener("submit", (event) => {
    event.preventDefault(); const form = event.target; if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "adminUserForm") return change(async () => { await api("/api/admin/users", "POST", { ...data, isAdmin: data.isAdmin === "on" }); form.reset(); });
    if (form.id === "adminGroupForm") return change(async () => { await api("/api/admin/groups", "POST", data); form.reset(); });
    if (form.dataset.user) return change(() => api(`/api/admin/users/${form.dataset.user}`, "PATCH", { name: data.name, active: data.active === "on", isAdmin: data.isAdmin === "on", ...data.password ? { password: data.password } : {} }));
    if (form.dataset.groupEdit) return change(() => api(`/api/admin/groups/${form.dataset.groupEdit}`, "PATCH", { ...data, archived: data.archived === "on" }));
    if (form.dataset.memberAdd) return change(() => api(`/api/admin/groups/${form.dataset.memberAdd}/members/${data.userId}`, "PUT", {}));
  });
  $("#adminDialog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]"); if (!button) return;
    const group = button.closest("[data-group]").dataset.group;
    change(() => api(`/api/admin/groups/${group}/members/${button.dataset.remove}`, "DELETE", {}));
  });
})();
