import { occurrencesInRange } from "./calendar-recurrence.js";

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    user: null,
    groups: [],
    groupId: new URL(location.href).searchParams.get("groupId") || null,
    stateRequest: 0,
    users: [],
    chores: [],
    history: [],
    filter: "all",
    loading: true,
    error: null,
    online: navigator.onLine,
    eventSource: null,
    lastUpdated: null,
    installPrompt: null,
    householdTimezone: "America/Los_Angeles",
    today: null,
    view: "today",
    calendarDate: null,
    calendarDays: 14,
    theme: "system",
  };
  let savedFocus = null;
  let pendingDeleteId = null;
  let toastTimer = 0;
  let toastRemaining = 0;
  let toastStarted = 0;
  let toastCompletionId = null;
  const pendingWrites = new Set();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const themes = new Set(["system", "light", "dark", "blush"]);

  function applyTheme(value, { save = true } = {}) {
    const theme = themes.has(value) ? value : "system";
    state.theme = theme;
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $$('input[name="theme"]').forEach((input) => { input.checked = input.value === theme; });
    if (save) try { localStorage.setItem("two-of-us-theme", theme); } catch { /* Theme persistence is optional. */ }
  }

  function loadTheme() {
    let saved = "system";
    try { saved = localStorage.getItem("two-of-us-theme") || "system"; } catch { /* Use the system theme. */ }
    applyTheme(saved, { save: false });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function browserTodayISO() {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
  }

  function timezoneTodayISO(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch {
      return browserTodayISO();
    }
  }

  function todayISO() {
    return state.today || timezoneTodayISO(state.householdTimezone);
  }

  function dateFromISO(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function dateLabel(value) {
    if (!value) return "No date";
    const date = dateFromISO(value);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function ownerName(id) {
    return state.users.find((user) => user.id === id)?.name || "Former member";
  }

  function scheduleLabel(chore) {
    const interval = Number(chore.scheduleInterval) || 1;
    if (chore.scheduleKind === "once") return "Once";
    if (chore.scheduleKind === "daily") return interval === 1 ? "Every day" : `Every ${interval} days`;
    if (chore.scheduleKind === "every") return `Every ${interval} days`;
    if (chore.scheduleKind === "weekly") {
      const days = dayNames.filter((_, index) => Number(chore.weekdaysMask || 0) & (1 << index));
      return `${interval === 1 ? "Every week" : `Every ${interval} weeks`} · ${days.join(", ")}`;
    }
    return interval === 1 ? `Monthly on the ${ordinal(chore.monthDay)}` : `Every ${interval} months on the ${ordinal(chore.monthDay)}`;
  }

  function ordinal(value) {
    const number = Number(value) || 1;
    const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
    return `${number}${suffix}`;
  }

  function dueGroup(chore) {
    const today = todayISO();
    if (Number(chore.missedCount) > 0) return "missed";
    if (chore.nextDue <= today) return "today";
    return "later";
  }

  function canWrite() {
    return state.online && Boolean(state.user) && Boolean(state.groupId);
  }

  function pauseToast() {
    window.clearTimeout(toastTimer);
    if (toastStarted) toastRemaining = Math.max(0, toastRemaining - (performance.now() - toastStarted));
    toastStarted = 0;
  }

  function resumeToast() {
    const toast = $("#toast");
    pauseToast();
    if (toast.hidden || toast.matches(":hover, :focus-within")) return;
    toastStarted = performance.now();
    toastTimer = window.setTimeout(dismissToast, toastRemaining);
  }

  function dismissToast() {
    pauseToast();
    if ($("#toast").contains(document.activeElement)) $(".view-tab.is-active").focus();
    $("#toast").hidden = true;
    toastCompletionId = null;
  }

  function showToast(message, kind = "success", completionId = null) {
    const toast = $("#toast");
    pauseToast();
    $("#toastMessage").textContent = message;
    toastCompletionId = completionId;
    $("#toastUndo").hidden = !completionId;
    $("#toastUndo").disabled = !canWrite();
    toast.classList.toggle("is-error", kind === "error");
    toast.hidden = false;
    toastRemaining = completionId ? 10000 : 4200;
    resumeToast();
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = new Headers(options.headers || {});
    if (method !== "GET") headers.set("Content-Type", "application/json");
    if (state.groupId && /^\/api\/(state|events|chores|history)(?:[/?]|$)/.test(path)) {
      const scoped = new URL(path, location.origin); scoped.searchParams.set("groupId", state.groupId); path = scoped.pathname + scoped.search;
    }
    const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
    let body = null;
    const text = await response.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = { error: "The server returned an invalid response." }; }
    }
    if (!response.ok) {
      if (response.status === 401) { stopEvents(); $("#appView").hidden = true; dismissToast(); location.replace("/login"); }
      const error = new Error(body?.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function jsonRequest(path, method, body) {
    return request(path, { method, body: JSON.stringify(body ?? {}) });
  }

  function acceptState(data) {
    state.user = data.user;
    state.groups = data.groups || [];
    state.groupId = data.activeGroup?.id || null;
    const groupSelect = $("#groupSelect");
    groupSelect.innerHTML = state.groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
    groupSelect.value = state.groupId || "";
    groupSelect.disabled = state.groups.length < 2;
    $("#groupTimezone").textContent = data.activeGroup?.timeZone || "Ask an administrator to add you to a group.";
    $("#adminButton").hidden = !data.user?.isAdmin;
    const groupUrl = new URL(location.href);
    if (state.groupId) groupUrl.searchParams.set("groupId", state.groupId); else groupUrl.searchParams.delete("groupId");
    history.replaceState(null, "", groupUrl);
    state.users = data.users || [];
    $(".filter-bar").innerHTML = `<button class="filter-button" type="button" data-filter="all">Everyone</button>` + state.users.map((u) => `<button class="filter-button" type="button" data-filter="${escapeHtml(u.id)}">${escapeHtml(u.name)}</button>`).join("");
    const assignee = $("#choreAssignee"); const selectedAssignee = assignee.value;
    assignee.innerHTML = state.users.filter((u) => u.active).map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join("");
    if (state.users.some((u) => u.active && u.id === selectedAssignee)) assignee.value = selectedAssignee;
    if (state.filter !== "all" && !state.users.some((u) => u.id === state.filter)) state.filter = "all";
    state.chores = Array.isArray(data.chores) ? data.chores : [];
    state.history = Array.isArray(data?.history) ? data.history : [];
    state.householdTimezone = data.household?.timeZone || "America/Los_Angeles";
    state.today = /^\d{4}-\d{2}-\d{2}$/.test(data.household?.today || "") ? data.household.today : timezoneTodayISO(state.householdTimezone);
    state.calendarDate ||= state.today;
    state.error = null;
    state.loading = false;
    state.lastUpdated = new Date();
  }

  async function loadState({ silent = false } = {}) {
    const generation = ++state.stateRequest;
    if (!silent) { state.loading = true; state.error = null; render(); }
    try {
      const result = await request("/api/state");
      if (generation !== state.stateRequest) return;
      acceptState(result);
      render();
      connectEvents();
    } catch (error) {
      if (generation !== state.stateRequest) return;
      if (error.status === 404 && state.groupId) {
        stopEvents(); state.groupId = null; state.chores = []; state.history = []; state.users = [];
        return loadState();
      }
      if (error.status === 401) {
        stopEvents();
        location.replace("/login");
        return;
      }
      state.loading = false;
      state.error = error.message;
      render();
    }
  }

  function connectEvents() {
    if (!state.user || !state.groupId || !window.EventSource) return;
    if (state.eventSource && state.eventSource.readyState !== window.EventSource.CLOSED) return;
    const source = new EventSource(`/api/events?groupId=${encodeURIComponent(state.groupId)}`);
    let opened = false;
    state.eventSource = source;
    source.addEventListener("change", () => loadState({ silent: true }));
    source.addEventListener("open", () => {
      const reconnected = opened;
      opened = true;
      updateConnection("Live");
      if (reconnected) loadState({ silent: true });
    });
    source.addEventListener("error", () => { updateConnection(state.online ? "Reconnecting" : "Offline"); if (state.online) loadState({ silent: true }); });
  }

  function stopEvents() {
    state.eventSource?.close();
    state.eventSource = null;
  }

  function updateConnection(label) {
    const status = $("#connectionStatus");
    if (!status) return;
    status.classList.toggle("is-offline", !state.online);
    $("span:last-child", status).textContent = state.online ? label : "Offline";
  }

  function updateWriteControls() {
    const disabled = !canWrite();
    $$("#addChoreButton, #emptyAddButton, #saveChoreButton, #deleteChoreButton, #confirmDeleteButton, #logoutButton, #settingsForm button[type=submit], #passwordForm button[type=submit], [data-action=complete], [data-action=undo], [data-action=edit]").forEach((button) => {
      button.disabled = disabled || pendingWrites.has(`${button.dataset.action}:${button.dataset.id}`);
    });
    $("#logoutButton").disabled = !state.online;
    $("#groupSelect").disabled = state.groups.length < 2 || pendingWrites.size > 0;
    $("#toastUndo").disabled = disabled || pendingWrites.has(`undo:${toastCompletionId}`) || !state.history.some((record) => record.id === toastCompletionId && record.canUndo);
    if (disabled) $$("#pushButton, #pushTestButton").forEach((button) => { button.disabled = true; });
  }

  function render() {
    const focused = document.activeElement;
    $("#offlineBanner").hidden = state.online || !state.user;
    if (!state.user) {
      $("#loadingState").hidden = !state.loading;
      $("#errorState").hidden = !state.error;
      if (state.error) $("#errorCopy").textContent = state.error;
      return;
    }
    updateConnection(state.online ? "Live" : "Offline");
    updateWriteControls();
    $("#loadingState").hidden = !state.loading;
    $("#errorState").hidden = state.loading || !state.error;
    $("#todayPanel").hidden = state.view !== "today" || state.loading || Boolean(state.error);
    $("#calendarPanel").hidden = state.view !== "calendar" || state.loading || Boolean(state.error);
    $("#historyPanel").hidden = state.view !== "history" || state.loading || Boolean(state.error);
    $("#emptyState").hidden = state.loading || Boolean(state.error) || todayChores().length > 0;
    if (state.error) $("#errorCopy").textContent = state.error;
    renderHeader();
    if (!state.loading && !state.error) {
      renderSections();
      if (state.view === "calendar") renderCalendar();
      if (state.view === "history") renderHistory();
      updateWriteControls();
    }
    if (focused && !document.contains(focused)) {
      const { action, id, calendarDate } = focused.dataset;
      const replacement = calendarDate ? $(`[data-calendar-date="${calendarDate}"]`) : action && id ? $(`#${state.view === "today" ? "choreSections" : state.view === "calendar" ? "calendarAgenda" : "historyGroups"} [data-action="${action}"][data-id="${id}"]`) : null;
      (replacement || $(".view-tab.is-active"))?.focus({ preventScroll: true });
    }
  }

  function renderHeader() {
    $("#appView").dataset.view = state.view;
    const due = todayChores();
    const missed = due.filter((chore) => dueGroup(chore) === "missed");
    const todayView = state.view === "today";
    $("#dashboardDate").textContent = todayView ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(dateFromISO(todayISO())) : state.view === "history" ? "Completed chores" : "Upcoming schedule";
    $("#dashboardTitle").textContent = todayView ? "Today" : state.view === "history" ? "History" : "Calendar";
    $("#todaySummary").textContent = todayView ? due.length ? `${due.length} chore${due.length === 1 ? "" : "s"} need attention` : "You’re all caught up." : state.view === "history" ? `${filteredHistory().length} completed chore${filteredHistory().length === 1 ? "" : "s"}` : `${filteredChores().length} active chore${filteredChores().length === 1 ? "" : "s"}`;
    $("#listSummary").textContent = todayView ? `${due.length} due${missed.length ? ` · ${missed.length} overdue` : ""}` : state.view === "history" ? `${filteredHistory().length} completed` : `${filteredChores().length} scheduled`;
    $("#lastUpdated").textContent = state.lastUpdated ? `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for the first refresh.";
    const emptyTitle = $("#emptyTitle");
    const emptyCopy = $("#emptyCopy");
    if (!state.groupId) {
      emptyTitle.textContent = "No group assigned";
      emptyCopy.textContent = "Ask an administrator to add you to a group. Your account is ready.";
    } else if (state.chores.length === 0) {
      emptyTitle.textContent = "Nothing here yet.";
      emptyCopy.textContent = "Add your first chore to get started.";
    } else {
      const label = ownerName(state.filter);
      emptyTitle.textContent = "All done for today";
      emptyCopy.textContent = state.filter === "all" ? "There’s nothing due right now." : `Nothing is due for ${label}.`;
    }
    $$(".view-tab").forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$(".filter-button").forEach((button) => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function filteredChores() {
    return state.filter === "all" ? state.chores : state.chores.filter((chore) => chore.assigneeId === state.filter);
  }

  function filteredHistory() {
    return state.filter === "all" ? state.history : state.history.filter((record) => record.assigneeId === state.filter);
  }

  function todayChores() {
    return filteredChores().filter((chore) => chore.nextDue <= todayISO() || Number(chore.missedCount) > 0);
  }

  function renderSections() {
    const labels = { missed: "Overdue", today: "Due today" };
    const groups = { missed: [], today: [] };
    todayChores().forEach((chore) => groups[dueGroup(chore) === "missed" ? "missed" : "today"].push(chore));
    Object.values(groups).forEach((group) => group.sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.id - b.id));
    $("#choreSections").innerHTML = Object.entries(groups).filter(([, chores]) => chores.length).map(([key, chores]) => `
      <section class="chore-section" aria-labelledby="${key}Title">
        <div class="chore-section-heading ${key === "missed" ? "is-missed" : ""}"><h2 id="${key}Title">${labels[key]}</h2><span>${chores.length}</span></div>
        <div class="chore-list">${chores.map(cardMarkup).join("")}</div>
      </section>`).join("");
  }

  function cardMarkup(chore) {
    const group = dueGroup(chore);
    const owner = ownerName(chore.assigneeId);
    const due = group === "missed" ? `Missed · ${dateLabel(chore.nextDue)}` : group === "today" ? "Due today" : `Due ${dateLabel(chore.nextDue)}`;
    return `<article class="chore-row ${group === "missed" ? "is-missed" : ""}" data-owner="${escapeHtml(chore.assigneeId)}" data-chore-id="${Number(chore.id)}">
      ${completionCheckbox(chore)}
      <div class="chore-main"><h3>${escapeHtml(chore.title)}</h3><p class="assigned">Assigned to ${escapeHtml(owner)}</p><div class="chore-meta"><span class="due-label ${group === "missed" ? "is-missed" : ""}">${due}</span><span>${escapeHtml(scheduleLabel(chore))}</span></div></div>
      <button class="text-button edit-chevron" type="button" data-action="edit" data-id="${Number(chore.id)}" aria-label="Edit ${escapeHtml(chore.title)}">›</button>
    </article>`;
  }

  function completionCheckbox(chore) {
    return `<label class="completion-control"><input class="check-button" type="checkbox" data-action="complete" data-id="${Number(chore.id)}" aria-label="Mark ${escapeHtml(chore.title)} complete"></label>`;
  }

  function renderCalendar() {
    const selected = state.calendarDate || todayISO();
    const selectedDate = dateFromISO(selected);
    const weekStart = addDays(selected, -selectedDate.getUTCDay());
    const end = addDays(selected, state.calendarDays - 1);
    $("#calendarTitle").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(selectedDate);
    $("#calendarMonth").value = selected.slice(0, 7);
    $("#calendarWeek").innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const owners = [...new Set([
        ...filteredChores().filter((chore) => occurrencesInRange(chore, date, date).length).map((chore) => chore.assigneeId),
        ...filteredHistory().filter((record) => record.completedOn === date).map((record) => record.assigneeId),
      ])].sort();
      const label = `${dateLabel(date)}${owners.length ? `; chores for ${owners.map(ownerName).join(" and ")}` : "; no chores"}`;
      return `<button class="calendar-day-button ${date === selected ? "is-selected" : ""} ${date === todayISO() ? "is-today" : ""}" type="button" data-calendar-date="${date}" aria-label="${escapeHtml(label)}" aria-pressed="${date === selected}"><span class="day-name">${dayNames[index]}</span><span class="day-number">${dateFromISO(date).getUTCDate()}<span class="day-dots" aria-hidden="true">${owners.map((owner) => `<i data-owner="${escapeHtml(owner)}"></i>`).join("")}</span></span></button>`;
    }).join("");
    const occurrencesByDate = new Map();
    const addOccurrence = (date, occurrence) => {
      const occurrences = occurrencesByDate.get(date) || [];
      occurrences.push(occurrence);
      occurrencesByDate.set(date, occurrences);
    };
    filteredChores().forEach((chore) => occurrencesInRange(chore, selected, end).forEach((occurrenceDate) => {
      addOccurrence(occurrenceDate, { type: "active", chore, occurrenceDate });
    }));
    filteredHistory().forEach((record) => {
      if (record.completedOn >= selected && record.completedOn <= end) addOccurrence(record.completedOn, { type: "completed", record });
    });
    occurrencesByDate.forEach((occurrences) => occurrences.sort(compareAgendaEntries));
    $("#calendarEmpty").hidden = occurrencesByDate.size > 0;
    const dates = Array.from({ length: state.calendarDays }, (_, index) => addDays(selected, index));
    const groups = dates.filter((date) => date === selected || occurrencesByDate.has(date)).map((date) => {
      const label = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(dateFromISO(date));
      const entries = occurrencesByDate.get(date) || [];
      return `<section class="agenda-group"><h3>${escapeHtml(date === todayISO() ? `Today · ${label}` : date === addDays(todayISO(), 1) ? `Tomorrow · ${label}` : label)}</h3>${entries.length ? entries.map(agendaEntryMarkup).join("") : "<p class=\"agenda-empty\">No chores scheduled.</p>"}</section>`;
    });
    $("#calendarAgenda").innerHTML = groups.join("");
    $("#calendarMore").hidden = state.calendarDays >= 56;
  }

  function addDays(iso, amount) {
    const date = dateFromISO(iso);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function compareAgendaEntries(a, b) {
    const rank = (entry) => entry.type === "active" ? entry.occurrenceDate === entry.chore.nextDue ? 0 : 2 : 1;
    const title = (entry) => String(entry.type === "completed" ? entry.record.title : entry.chore.title);
    const id = (entry) => Number(entry.type === "completed" ? entry.record.id : entry.chore.id);
    return rank(a) - rank(b) || title(a).localeCompare(title(b)) || id(a) - id(b);
  }

  function agendaEntryMarkup(entry) {
    if (entry.type === "completed") return historyRecordMarkup(entry.record);
    const { chore, occurrenceDate } = entry;
    const owner = ownerName(chore.assigneeId);
    const projected = occurrenceDate !== chore.nextDue;
    const titleText = String(chore.title ?? "Untitled chore");
    const title = escapeHtml(titleText);
    const editLabel = projected ? `Edit recurring series for ${titleText}` : `Edit ${titleText}`;
    const indicator = projected
      ? `<span class="calendar-repeat" role="img" aria-label="Upcoming recurring occurrence for ${title}; not directly completable">↻</span>`
      : completionCheckbox(chore);
    return `<article class="chore-row agenda-chore ${projected ? "is-projected" : ""}" data-owner="${escapeHtml(chore.assigneeId)}">
      ${indicator}
      <div class="chore-main"><h3>${title}</h3><p class="assigned">Assigned to ${escapeHtml(owner)}</p>${projected ? '<p class="chore-meta">Upcoming recurring occurrence</p>' : ''}</div>
      <button class="text-button edit-chevron" type="button" data-action="edit" data-id="${Number(chore.id)}" aria-label="${escapeHtml(editLabel)}">›</button>
    </article>`;
  }

  function safeDateLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Date unavailable";
    try { return dateLabel(value); } catch { return "Date unavailable"; }
  }

  function completedTimeLabel(value) {
    if (!value) return "Time unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: state.householdTimezone }).format(date);
    } catch {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
  }

  function historyScheduleLabel(record) {
    const labels = { once: "Once", daily: "Every day", every: "Recurring", weekly: "Every week", monthly: "Every month" };
    return labels[record.scheduleKind] || `Schedule · ${String(record.scheduleKind || "Unknown")}`;
  }

  function compareHistoryRecords(a, b) {
    const completedAt = (record) => {
      const value = Date.parse(record.completedAt || "");
      return Number.isFinite(value) ? value : 0;
    };
    const id = (record) => Number(record.id);
    return String(b.completedOn || "").localeCompare(String(a.completedOn || "")) || completedAt(b) - completedAt(a) || String(a.title || "").localeCompare(String(b.title || "")) || id(a) - id(b);
  }

  function renderHistory() {
    const records = filteredHistory().slice().sort(compareHistoryRecords);
    const groups = new Map();
    records.forEach((record) => {
      const date = record.completedOn || "";
      const group = groups.get(date) || [];
      group.push(record);
      groups.set(date, group);
    });
    $("#historyEmpty").hidden = records.length > 0;
    $("#historyGroups").innerHTML = [...groups.entries()].map(([date, group], index) => `
      <section class="history-group" aria-labelledby="historyDate${index}">
        <div class="history-group-heading"><h2 id="historyDate${index}">${escapeHtml(date ? safeDateLabel(date) : "Date unavailable")}</h2><span>${group.length}</span></div>
        <div class="history-list">${group.map(historyRecordMarkup).join("")}</div>
      </section>`).join("");
  }

  function historyRecordMarkup(record) {
    const title = escapeHtml(String(record.title ?? "Untitled chore"));
    const detail = record.dueDate ? `Due ${safeDateLabel(record.dueDate)}` : historyScheduleLabel(record);
    const owner = escapeHtml(ownerName(record.assigneeId));
    const completedBy = escapeHtml(ownerName(record.completedById));
    const completedAt = record.completedAt || (record.completedOn ? `${record.completedOn}T00:00:00` : "");
    return `<article class="history-row" data-owner="${escapeHtml(record.assigneeId)}">
      <span class="history-check" role="img" aria-label="Completed"><span>✓</span></span>
      <div class="history-main"><h3>${title}</h3><p class="assigned">Assigned to ${owner}</p><div class="history-meta"><span>${escapeHtml(detail)}</span></div><div class="history-completion"><span>Completed by ${completedBy}</span><time datetime="${escapeHtml(completedAt)}">${escapeHtml(completedTimeLabel(record.completedAt))}</time></div></div>
      ${record.canUndo ? `<button class="text-button undo-button" data-action="undo" data-id="${Number(record.id)}" aria-label="Undo completion of ${title}">Undo</button>` : ''}
    </article>`;
  }

  function animateCardExit(id) {
    $((`[data-chore-id="${Number(id)}"]`))?.classList.add("is-completing");
    return Promise.resolve();
  }

  function openDialog(dialog) {
    savedFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => $("input, select, button", dialog)?.focus(), 0);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    if (savedFocus && document.contains(savedFocus)) savedFocus.focus({ preventScroll: true });
    else $(".view-tab.is-active")?.focus({ preventScroll: true });
  }

  function resetChoreErrors() {
    ["titleError", "weekdayError", "choreError"].forEach((id) => { $("#" + id).hidden = true; $("#" + id).textContent = ""; });
    $("#choreTitle").setAttribute("aria-invalid", "false");
    $(".weekday-options").setAttribute("aria-invalid", "false");
    $$('input[name="weekday"]').forEach((input) => input.setAttribute("aria-invalid", "false"));
  }

  function openChoreDialog(id = null) {
    if (!canWrite()) { showToast("Reconnect before changing chores.", "error"); return; }
    const form = $("#choreForm");
    const chore = id ? state.chores.find((item) => Number(item.id) === Number(id)) : null;
    resetChoreErrors();
    form.reset();
    form.dataset.id = chore ? String(chore.id) : "";
    $("#choreDialogTitle").textContent = chore ? "Edit chore" : "Add a chore";
    $("#saveChoreButton").textContent = chore ? "Save changes" : "Save chore";
    $("#deleteChoreButton").hidden = !chore;
    $("#choreTitle").value = chore?.title || "";
    $("#choreAssignee").value = chore?.assigneeId || state.user.id;
    $("#choreDate").value = chore?.nextDue || todayISO();
    $("#scheduleKind").value = chore?.scheduleKind || "once";
    $("#scheduleInterval").value = chore?.scheduleInterval || 1;
    $("#reminderMode").value = chore?.reminderMode || "inherit";
    $("#reminderTime").value = chore?.reminderTime || "";
    $$('input[name="weekday"]').forEach((input) => { input.checked = Boolean(chore && (Number(chore.weekdaysMask) & (1 << Number(input.value)))); });
    updateScheduleFields();
    updateReminderFields();
    openDialog($("#choreDialog"));
  }

  function updateScheduleFields() {
    const kind = $("#scheduleKind").value;
    const recurring = kind !== "once";
    $("#intervalField").hidden = !recurring;
    $("#scheduleInterval").required = recurring;
    $("#weekdayPicker").hidden = kind !== "weekly";
    $("#intervalSuffix").textContent = kind === "weekly" ? "weeks" : kind === "monthly" ? "months" : "days";
    $("#scheduleHint").textContent = kind === "once" ? "A one-time chore leaves the list when completed." : kind === "weekly" ? "Choose at least one weekday, including the due date." : kind === "monthly" ? "Repeats on this day of the month, or the last day of a shorter month." : "The next due date advances by this many days.";
  }

  function updateReminderFields() {
    const override = $("#reminderMode").value === "override";
    $("#reminderTimeField").hidden = !override;
    $("#reminderTime").required = override;
  }

  function weekdayForISO(value) {
    return dateFromISO(value).getUTCDay();
  }

  function choreFormData() {
    resetChoreErrors();
    const form = $("#choreForm");
    const current = form.dataset.id ? state.chores.find((item) => Number(item.id) === Number(form.dataset.id)) : null;
    const title = $("#choreTitle").value.trim();
    const date = $("#choreDate").value;
    const kind = $("#scheduleKind").value;
    const interval = Number($("#scheduleInterval").value);
    const weekdays = $$('input[name="weekday"]:checked').map((input) => Number(input.value));
    let valid = true;
    if (!title || title.length > 120) { $("#titleError").textContent = "Use 1-120 characters."; $("#titleError").hidden = false; $("#choreTitle").setAttribute("aria-invalid", "true"); valid = false; }
    if (!date) valid = false;
    if (kind !== "once" && (!Number.isInteger(interval) || interval < 1 || interval > 365)) valid = false;
    if (kind === "weekly" && (!weekdays.length || (date && !weekdays.includes(weekdayForISO(date))))) {
      $("#weekdayError").textContent = weekdays.length ? "The due date must be one of the selected weekdays." : "Choose at least one weekday.";
      $("#weekdayError").hidden = false;
      $(".weekday-options").setAttribute("aria-invalid", "true");
      $$('input[name="weekday"]').forEach((input) => input.setAttribute("aria-invalid", "true"));
      valid = false;
    }
    if (!form.reportValidity() || !valid) {
      if (!valid) $("#choreError").textContent = "Check the highlighted fields.";
      $("#choreError").hidden = valid;
      if (valid === false && !title) $("#choreTitle").focus();
      else if (valid === false && kind === "weekly") $('input[name="weekday"]')?.focus();
      return null;
    }
    const body = { title, assigneeId: $("#choreAssignee").value, scheduleKind: kind, scheduleInterval: kind === "once" ? 1 : interval, nextDue: date, weekdays, reminderMode: $("#reminderMode").value, reminderTime: $("#reminderTime").value || null };
    if (current) {
      body.revision = current.revision;
      if (kind === "monthly" && current.scheduleKind === "monthly" && Number(current.scheduleInterval) === interval && date === current.nextDue) {
        body.anchorDate = current.anchorDate;
        body.monthDay = current.monthDay;
      }
    }
    return body;
  }

  async function saveChore(event) {
    event.preventDefault();
    if (!canWrite()) { showToast("Reconnect before saving changes.", "error"); return; }
    const body = choreFormData();
    if (!body) return;
    const id = $("#choreForm").dataset.id;
    const button = $("#saveChoreButton");
    button.disabled = true;
    try {
      await jsonRequest(id ? `/api/chores/${Number(id)}` : "/api/chores", id ? "PATCH" : "POST", body);
      closeDialog($("#choreDialog"));
      showToast(id ? "Chore updated." : "Chore added.");
      await loadState({ silent: true });
    } catch (error) {
      $("#choreError").textContent = error.message;
      $("#choreError").hidden = false;
    } finally {
      updateWriteControls();
    }
  }

  function openDeleteDialog(id) {
    if (!canWrite()) { showToast("Reconnect before removing chores.", "error"); return; }
    const chore = state.chores.find((item) => Number(item.id) === Number(id));
    if (!chore) return;
    pendingDeleteId = Number(id);
    $("#confirmCopy").textContent = `“${chore.title}” will be removed for both people.`;
    openDialog($("#confirmDialog"));
  }

  async function confirmDelete() {
    if (!pendingDeleteId || !canWrite()) return;
    const id = pendingDeleteId;
    $("#confirmDeleteButton").disabled = true;
    try {
      await request(`/api/chores/${id}`, { method: "DELETE", body: "{}" });
      await animateCardExit(id);
      closeDialog($("#confirmDialog"));
      pendingDeleteId = null;
      showToast("Chore removed.");
      await loadState({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      updateWriteControls();
    }
  }

  async function completeChore(id, button) {
    button.checked = false;
    if (pendingWrites.has(`complete:${id}`)) return;
    if (!canWrite()) { showToast("Reconnect before completing chores.", "error"); return; }
    const chore = state.chores.find((item) => Number(item.id) === Number(id));
    if (!chore) return;
    pendingWrites.add(`complete:${id}`);
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const result = await jsonRequest(`/api/chores/${Number(id)}/complete`, "POST", { revision: chore.revision });
      button.checked = true;
      await animateCardExit(id);
      showToast("Chore completed.", "success", result.completionId);
      await loadState({ silent: true });
    } catch (error) {
      if (error.status === 409) {
        showToast("This chore changed on another device. The list is refreshed.", "error");
        await loadState({ silent: true });
      } else showToast(error.message, "error");
      button.disabled = false;
      button.removeAttribute("aria-busy");
    } finally {
      pendingWrites.delete(`complete:${id}`);
      updateWriteControls();
    }
  }

  async function undoCompletion(id) {
    if (!id || pendingWrites.has(`undo:${id}`)) return;
    if (!canWrite()) { showToast("Reconnect before undoing a completion.", "error"); return; }
    pendingWrites.add(`undo:${id}`);
    updateWriteControls();
    try {
      await jsonRequest(`/api/history/${Number(id)}/undo`, "POST", {});
      showToast("Completion undone.");
      await loadState({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
      if (error.status === 409) await loadState({ silent: true });
    } finally {
      pendingWrites.delete(`undo:${id}`);
      updateWriteControls();
    }
  }

  async function logout() {
    if (!state.online || !state.user) { showToast("Reconnect before signing out.", "error"); return; }
    if (window.ChoresNative) await window.ChoresNative.disable().catch(() => {});
    try { await request("/api/session", { method: "DELETE", body: "{}" }); } catch (error) { showToast(error.message, "error"); return; }
    if (!window.ChoresNative) try { const registration = await navigator.serviceWorker?.getRegistration(); const subscription = await registration?.pushManager.getSubscription(); await subscription?.unsubscribe(); } catch { /* Server subscription already removed. */ }
    stopEvents();
    location.replace("/login");
  }

  function fillSettings() {
    const settings = state.user || {};
    $("#signedInAs").textContent = `Signed in as ${settings.name || ownerName(settings.id)}`;
    applyTheme(state.theme, { save: false });
    setTimeSetting("digest", settings.digestTime);
    setTimeSetting("missed", settings.missedAlertTime);
    setTimeSetting("defaultReminder", settings.defaultReminderTime);
    $("#activityNotifications").checked = settings.activityNotifications !== false;
  }

  function setTimeSetting(name, value) {
    const checkbox = $(`#${name}Enabled`);
    const input = $(`#${name === "missed" ? "missedAlertTime" : name === "defaultReminder" ? "defaultReminderTime" : "digestTime"}`);
    checkbox.checked = Boolean(value);
    input.value = value || "";
    input.disabled = !value;
  }

  function bindTimeToggle(id, inputId) {
    $(id).addEventListener("change", (event) => { $(inputId).disabled = !event.target.checked; if (!event.target.checked) $(inputId).value = ""; });
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!state.online || !state.user) { showToast("Reconnect before saving settings.", "error"); return; }
    const errorNode = $("#settingsError");
    errorNode.hidden = true;
    try {
      const activityNotifications = $("#activityNotifications").checked;
      await jsonRequest("/api/settings", "PATCH", { digestTime: $("#digestEnabled").checked ? $("#digestTime").value : null, missedAlertTime: $("#missedEnabled").checked ? $("#missedAlertTime").value : null, defaultReminderTime: $("#defaultReminderEnabled").checked ? $("#defaultReminderTime").value : null, activityNotifications });
      state.user = { ...state.user, digestTime: $("#digestEnabled").checked ? $("#digestTime").value : null, missedAlertTime: $("#missedEnabled").checked ? $("#missedAlertTime").value : null, defaultReminderTime: $("#defaultReminderEnabled").checked ? $("#defaultReminderTime").value : null, activityNotifications };
      $("#settingsSuccess").hidden = false;
      window.setTimeout(() => { $("#settingsSuccess").hidden = true; }, 2400);
      showToast("Notification times saved.");
    } catch (requestError) { errorNode.textContent = requestError.message; errorNode.hidden = false; }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (!state.online || !state.user) { showToast("Reconnect before changing your password.", "error"); return; }
    const form = $("#passwordForm");
    if (!form.reportValidity()) return;
    const errorNode = $("#passwordError");
    errorNode.hidden = true;
    const current = $("#currentPassword").value;
    const next = $("#newPassword").value;
    if (next !== $("#confirmPassword").value) { errorNode.textContent = "New passwords do not match."; errorNode.hidden = false; return; }
    if (next.length < 12) { errorNode.textContent = "Use at least 12 characters."; errorNode.hidden = false; return; }
    try {
      await jsonRequest("/api/password", "PATCH", { currentPassword: current, newPassword: next });
      $("#passwordForm").reset();
      $("#passwordSuccess").hidden = false;
      window.setTimeout(() => { $("#passwordSuccess").hidden = true; }, 2400);
      showToast("Password updated.");
    } catch (requestError) { errorNode.textContent = requestError.message; errorNode.hidden = false; }
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function updateInstallGuidance() {
    const hint = $("#installHint");
    if (!hint) return;
    hint.hidden = false;
    hint.textContent = isStandalone() ? "You’re using the installed app." : state.installPrompt ? "Use Install app to add this list to your home screen." : isIOS() ? "Use your browser's Share menu, then choose Add to Home Screen." : "Use your browser's install option to add this list to your home screen.";
  }

  async function refreshPushState() {
    if (window.ChoresNative) return window.ChoresNative.refresh();
    const status = $("#pushStatus");
    const button = $("#pushButton");
    const hint = $("#iosPushHint");
    hint.hidden = !(isIOS() && !isStandalone());
    if (!state.online || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      status.textContent = "Push is not available in this browser.";
      button.disabled = true;
      return;
    }
    try {
      const config = await request("/api/push-key");
      if (!config.configured || !config.publicKey) { status.textContent = "Push is not configured on this server."; button.disabled = true; return; }
      if (isIOS() && !isStandalone()) { status.textContent = "Add the app to your Home Screen to enable push."; button.disabled = true; return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await jsonRequest("/api/push-subscriptions", "PUT", subscription.toJSON());
        status.textContent = "Push is enabled on this device.";
        button.textContent = "Disable push";
        button.disabled = false;
        $("#pushTestButton").hidden = false;
      } else {
        status.textContent = Notification.permission === "denied" ? "Notifications are blocked in browser settings." : "Push is ready to enable.";
        button.textContent = "Enable push";
        button.disabled = Notification.permission === "denied";
        $("#pushTestButton").hidden = true;
      }
    } catch (error) { status.textContent = error.message; button.disabled = true; }
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function togglePush() {
    if (window.ChoresNative) return window.ChoresNative.toggle();
    if (!canWrite()) { showToast("Reconnect before changing push settings.", "error"); return; }
    const button = $("#pushButton");
    button.disabled = true;
    try {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") throw new Error("Notifications are blocked in browser settings.");
      const config = await request("/api/push-key");
      if (!config.configured || !config.publicKey) throw new Error("Push is not configured on this server.");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await jsonRequest("/api/push-subscriptions", "DELETE", { endpoint: existing.endpoint });
        await existing.unsubscribe();
        showToast("Push disabled on this device.");
      } else {
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
        await jsonRequest("/api/push-subscriptions", "PUT", subscription.toJSON());
        showToast("Push enabled on this device.");
      }
    } catch (error) { showToast(error.message, "error"); }
    finally { await refreshPushState(); }
  }

  async function testPush() {
    if (window.ChoresNative) return window.ChoresNative.test();
    const button = $("#pushTestButton");
    button.disabled = true;
    try { await jsonRequest("/api/push-test", "POST", {}); showToast("Test notification sent."); }
    catch (error) { showToast(error.message, "error"); }
    finally { button.disabled = false; }
  }

  async function registerServiceWorker() {
    if (window.ChoresNative) return;
    if (!("serviceWorker" in navigator)) return;
    try { await navigator.serviceWorker.register("/sw.js"); } catch { showToast("Notifications could not be prepared on this browser.", "error"); }
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      $("#installButton").hidden = false;
      updateInstallGuidance();
    });
    window.addEventListener("appinstalled", () => { state.installPrompt = null; $("#installButton").hidden = true; updateInstallGuidance(); showToast("App installed."); });
    $("#installButton").addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      $("#installButton").hidden = true;
      updateInstallGuidance();
    });
  }

  function bindEvents() {
    $$("dialog").forEach((dialog) => dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(dialog); }));
    $("#toastUndo").addEventListener("click", () => undoCompletion(toastCompletionId));
    $("#toastDismiss").addEventListener("click", dismissToast);
    $("#toast").addEventListener("mouseenter", pauseToast);
    $("#toast").addEventListener("mouseleave", resumeToast);
    $("#toast").addEventListener("focusin", pauseToast);
    $("#toast").addEventListener("focusout", () => window.setTimeout(resumeToast, 0));
    $("#deleteChoreButton").addEventListener("click", () => { const id = Number($("#choreForm").dataset.id); closeDialog($("#choreDialog")); openDeleteDialog(id); });
    $("#logoutButton").addEventListener("click", logout);
    $("#addChoreButton").addEventListener("click", () => openChoreDialog());
    $("#emptyAddButton").addEventListener("click", () => openChoreDialog());
    $("#retryButton").addEventListener("click", () => loadState());
    $("#settingsButton").addEventListener("click", () => { fillSettings(); updateInstallGuidance(); openDialog($("#settingsDialog")); refreshPushState(); });
    $("#closeSettingsButton").addEventListener("click", () => closeDialog($("#settingsDialog")));
    $("#closeChoreButton").addEventListener("click", () => closeDialog($("#choreDialog")));
    $("#cancelChoreButton").addEventListener("click", () => closeDialog($("#choreDialog")));
    $("#closeConfirmButton").addEventListener("click", () => closeDialog($("#confirmDialog")));
    $("#cancelConfirmButton").addEventListener("click", () => closeDialog($("#confirmDialog")));
    $("#confirmDeleteButton").addEventListener("click", confirmDelete);
    $("#choreForm").addEventListener("submit", saveChore);
    $("#settingsForm").addEventListener("submit", saveSettings);
    $("#passwordForm").addEventListener("submit", savePassword);
    $("#pushButton").addEventListener("click", togglePush);
    $("#pushTestButton").addEventListener("click", testPush);
    $("#themeOptions").addEventListener("change", (event) => { if (event.target.name === "theme") applyTheme(event.target.value); });
    $("#scheduleKind").addEventListener("change", updateScheduleFields);
    $("#reminderMode").addEventListener("change", updateReminderFields);
    $(".filter-bar").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (button) { state.filter = button.dataset.filter; render(); } });
    $("#groupSelect").addEventListener("change", (event) => {
      stopEvents(); dismissToast(); $$("dialog[open]").forEach((d) => closeDialog(d));
      state.groupId = event.target.value; state.filter = "all"; state.calendarDate = null;
      state.chores = []; state.history = []; state.users = []; loadState();
    });
    window.addEventListener("chores-admin-changed", () => loadState({ silent: true }));
    $$(".view-tab").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; render(); }));
    $(".view-tabs").addEventListener("keydown", (event) => {
      const tabs = $$(".view-tab");
      const current = tabs.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length : -1;
      if (next < 0) return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
    $("#previousWeek").addEventListener("click", () => changeWeek(-1));
    $("#nextWeek").addEventListener("click", () => changeWeek(1));
    $("#calendarToday").addEventListener("click", () => { state.calendarDate = todayISO(); state.calendarDays = 14; render(); });
    $("#calendarMonth").addEventListener("change", (event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) { state.calendarDate = `${event.target.value}-01`; state.calendarDays = 14; render(); } });
    $("#calendarWeek").addEventListener("click", (event) => { const date = event.target.closest("[data-calendar-date]")?.dataset.calendarDate; if (date) { state.calendarDate = date; state.calendarDays = 14; render(); } });
    $("#calendarMore").addEventListener("click", () => { state.calendarDays += 14; render(); });
    const handleChoreAction = (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.disabled) return;
      const id = Number(button.dataset.id);
      if (button.dataset.action === "edit") openChoreDialog(id);
      if (button.dataset.action === "delete") openDeleteDialog(id);
      if (button.dataset.action === "complete") completeChore(id, button);
      if (button.dataset.action === "undo") undoCompletion(id);
    };
    $("#choreSections").addEventListener("click", handleChoreAction);
    $("#calendarAgenda").addEventListener("click", handleChoreAction);
    $("#historyGroups").addEventListener("click", handleChoreAction);
    bindTimeToggle("#digestEnabled", "#digestTime");
    bindTimeToggle("#missedEnabled", "#missedAlertTime");
    bindTimeToggle("#defaultReminderEnabled", "#defaultReminderTime");
    window.addEventListener("offline", () => { state.online = false; render(); });
    window.addEventListener("online", () => { state.online = true; render(); if (state.user) loadState({ silent: true }); });
  }

  function changeWeek(offset) {
    state.calendarDate = addDays(state.calendarDate || todayISO(), offset * 7);
    state.calendarDays = 14;
    render();
  }

  async function boot() {
    loadTheme();
    bindEvents();
    setupInstallPrompt();
    registerServiceWorker();
    updateScheduleFields();
    updateReminderFields();
    render();
    await loadState();
    if (window.ChoresNative) window.ChoresNative.initialize().catch(() => {});
  }

  boot();
})();
