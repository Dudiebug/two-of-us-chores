(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const palette = [
    ["teal", "Teal"], ["rose", "Rose"], ["blue", "Blue"],
    ["violet", "Violet"], ["amber", "Amber"], ["green", "Green"],
  ];
  const paletteKeys = new Set(palette.map(([key]) => key));
  let state;
  let colorMap = new Map();
  let colorRefreshTimer = 0;

  // Use an external same-origin stylesheet so this remains compatible with the
  // app's strict CSP instead of injecting an inline <style> block.
  if (!document.querySelector('link[data-user-colors]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/user-colors.css?v=1";
    link.dataset.userColors = "";
    document.head.append(link);
  }

  function colorOptions(selected = "teal") {
    return palette.map(([key, label]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${label}</option>`).join("");
  }
  function normalizeColor(value) { return paletteKeys.has(value) ? value : "teal"; }

  function installCreateUserColorField() {
    const form = $("#adminUserForm");
    if (!form || form.querySelector('[name="colorKey"]')) return;
    const label = document.createElement("label");
    label.innerHTML = `Color<div class="user-color-field"><span class="user-color-swatch" data-user-color="teal" aria-hidden="true"></span><select name="colorKey" aria-label="User color">${colorOptions()}</select></div>`;
    const adminLabel = form.querySelector('[name="isAdmin"]')?.closest("label");
    form.insertBefore(label, adminLabel || form.querySelector("button"));
  }

  function applyUserColors() {
    let missing = false;
    document.querySelectorAll("[data-owner]").forEach((element) => {
      const color = colorMap.get(element.dataset.owner);
      if (color) element.dataset.userColor = color;
      else if (element.dataset.owner) missing = true;
    });
    document.querySelectorAll('.filter-button[data-filter]:not([data-filter="all"])').forEach((element) => {
      const color = colorMap.get(element.dataset.filter);
      if (color) element.dataset.userColor = color;
      else if (element.dataset.filter) missing = true;
    });
    if (missing) scheduleColorRefresh();
  }

  function scheduleColorRefresh() {
    window.clearTimeout(colorRefreshTimer);
    colorRefreshTimer = window.setTimeout(refreshColors, 60);
  }

  async function refreshColors() {
    try {
      const groupId = $("#groupSelect")?.value || new URL(location.href).searchParams.get("groupId");
      if (!groupId) return;
      const url = new URL("/api/state", location.origin);
      url.searchParams.set("groupId", groupId);
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      colorMap = new Map((data.users || []).map((user) => [user.id, normalizeColor(user.colorKey)]));
      applyUserColors();
    } catch { /* Color decoration is non-critical. */ }
  }

  new MutationObserver(applyUserColors).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", (event) => {
    if (event.target.matches("#groupSelect")) scheduleColorRefresh();
    if (event.target.matches('#adminDialog select[name="colorKey"]')) {
      const swatch = event.target.closest("label")?.querySelector(".user-color-swatch");
      if (swatch) swatch.dataset.userColor = normalizeColor(event.target.value);
    }
  });
  window.addEventListener("chores-admin-changed", scheduleColorRefresh);
  window.addEventListener("popstate", scheduleColorRefresh);
  installCreateUserColorField();
  scheduleColorRefresh();

  async function api(path, method = "GET", body) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || "Request failed"); return data;
  }
  const message = (text) => { $("#adminMessage").textContent = text; };
  async function refresh() {
    state = await api("/api/admin/state");
    $("#adminUsers").innerHTML = state.users.map((u) => `<form class="admin-item" data-user="${esc(u.id)}"><strong>${esc(u.username)}</strong>
      <label>Display name<input name="name" value="${esc(u.name)}" required maxlength="80"></label>
      <label>Color<div class="user-color-field"><span class="user-color-swatch" data-user-color="${esc(normalizeColor(u.colorKey))}" aria-hidden="true"></span><select name="colorKey">${colorOptions(normalizeColor(u.colorKey))}</select></div></label>
      <label class="check-field"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>
      <label class="check-field"><input type="checkbox" name="isAdmin" ${u.isAdmin ? 'checked' : ''}> Administrator</label>
      <label>Reset password (leave blank to keep)<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password"></label>
      <button class="button button-secondary" type="submit">Save user</button></form>`).join("");
    $("#adminGroups").innerHTML = state.groups.map((g) => {
      const members = state.memberships.filter((m) => m.groupId === g.id);
      return `<section class="admin-item" data-group="${esc(g.id)}"><form data-group-edit="${esc(g.id)}" class="admin-form"><label>Name<input name="name" value="${esc(g.name)}" required maxlength="80"></label><label>Timezone<input name="timeZone" value="${esc(g.timeZone)}" required maxlength="100"></label><label class="check-field"><input type="checkbox" name="archived" ${g.archivedAt ? 'checked' : ''}> Archived</label><button type="submit" class="button button-secondary">Save group</button></form>
      <div>${members.map((m) => { const u = state.users.find((u) => u.id === m.userId); return `<div class="inline-actions"><span class="user-color-swatch" data-user-color="${esc(normalizeColor(u?.colorKey))}" aria-hidden="true"></span><span>${esc(u?.name || 'Member')} (${esc(u?.username || '')})</span><button class="text-button" type="button" data-remove="${esc(m.userId)}" ${g.archivedAt ? 'disabled' : ''}>Remove</button></div>`; }).join("") || '<p>No members yet.</p>'}</div>
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
    if (form.id === "adminUserForm") return change(async () => { await api("/api/admin/users", "POST", { ...data, isAdmin: data.isAdmin === "on" }); form.reset(); form.querySelector('.user-color-swatch')?.setAttribute('data-user-color', 'teal'); });
    if (form.id === "adminGroupForm") return change(async () => { await api("/api/admin/groups", "POST", data); form.reset(); });
    if (form.dataset.user) return change(() => api(`/api/admin/users/${form.dataset.user}`, "PATCH", { name: data.name, colorKey: data.colorKey, active: data.active === "on", isAdmin: data.isAdmin === "on", ...data.password ? { password: data.password } : {} }));
    if (form.dataset.groupEdit) return change(() => api(`/api/admin/groups/${form.dataset.groupEdit}`, "PATCH", { ...data, archived: data.archived === "on" }));
    if (form.dataset.memberAdd) return change(() => api(`/api/admin/groups/${form.dataset.memberAdd}/members/${data.userId}`, "PUT", {}));
  });
  $("#adminDialog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]"); if (!button) return;
    const group = button.closest("[data-group]").dataset.group;
    change(() => api(`/api/admin/groups/${group}/members/${button.dataset.remove}`, "DELETE", {}));
  });
})();
