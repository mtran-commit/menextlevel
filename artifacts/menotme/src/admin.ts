/* MeNotMe Super Admin — full dashboard */
import { Clerk } from "@clerk/clerk-js/no-rhc";
import { publishableKeyFromHost } from "@clerk/shared/keys";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const clerk = new Clerk(
  publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
  { proxyUrl: `${window.location.origin}/api/__clerk` },
);

const gate  = document.getElementById("gate")!;
const gateMsg = document.getElementById("gateMsg")!;
const shell = document.getElementById("shell")!;
const navEl = document.getElementById("nav")!;
const main  = document.getElementById("main")!;
const topbarTitle = document.getElementById("topbar-title")!;

// ── API helper ──────────────────────────────────────────────────────────────
async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", "x-timezone": TZ, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status });
  return res.json();
}

// ── Escape helper ───────────────────────────────────────────────────────────
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);

const TAB_LABELS: Record<string, string> = {
  dashboard: "DASHBOARD",
  users: "USERS",
  reports: "REPORTS",
  statistics: "STATISTICS",
  announcements: "ANNOUNCEMENTS",
  rules: "ACHIEVEMENT RULES",
  logs: "AUDIT LOGS",
};

// ── Inline sign-in form ─────────────────────────────────────────────────────
function showSignInForm() {
  gate.innerHTML = `
    <div class="g-logo">ME NEXT LEVEL</div>
    <h2>ADMIN SIGN IN</h2>
    <form id="adminSignInForm" class="signin-form" autocomplete="on">
      <div class="form-field">
        <label for="si-email">Email</label>
        <input id="si-email" type="email" placeholder="admin@example.com" autocomplete="email" required>
      </div>
      <div class="form-field">
        <label for="si-password">Password</label>
        <input id="si-password" type="password" placeholder="••••••••" autocomplete="current-password" required>
      </div>
      <div id="si-err" class="si-error" style="display:none"></div>
      <button class="btn primary" type="submit" id="si-submit">SIGN IN</button>
    </form>
    <a class="btn" href="../" style="margin-top:12px">GO TO GAME</a>`;

  const form     = document.getElementById("adminSignInForm") as HTMLFormElement;
  const emailEl  = document.getElementById("si-email")   as HTMLInputElement;
  const passEl   = document.getElementById("si-password") as HTMLInputElement;
  const errEl    = document.getElementById("si-err")!;
  const submitBtn = document.getElementById("si-submit")  as HTMLButtonElement;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    submitBtn.disabled = true;
    errEl.style.display = "none";
    try {
      const res = await fetch(`${BASE}/api/admin/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailEl.value.trim(), password: passEl.value }),
      });
      const data = await res.json();
      if (data.ok) {
        await boot();
      } else {
        errEl.textContent = "⚠ " + (data.error ?? "Invalid credentials. Try again.");
        errEl.style.display = "block";
        submitBtn.disabled = false;
      }
    } catch {
      errEl.textContent = "⚠ Network error. Please try again.";
      errEl.style.display = "block";
      submitBtn.disabled = false;
    }
  };
}

function showNewPasswordStep(signInRes: any) {
  gate.innerHTML = `
    <div class="g-logo">ME NEXT LEVEL</div>
    <h2>SET NEW PASSWORD</h2>
    <p style="color:var(--g3);font-size:12px;letter-spacing:1px;margin-bottom:16px">Your account requires a new password.</p>
    <form id="adminNewPwForm" class="signin-form">
      <div class="form-field">
        <label for="np-password">New Password</label>
        <input id="np-password" type="password" placeholder="••••••••" required autocomplete="new-password">
      </div>
      <div id="np-err" class="si-error" style="display:none"></div>
      <button type="submit" class="btn primary" id="np-submit">SET PASSWORD</button>
    </form>`;

  const form     = document.getElementById("adminNewPwForm") as HTMLFormElement;
  const passEl   = document.getElementById("np-password") as HTMLInputElement;
  const errEl    = document.getElementById("np-err") as HTMLElement;
  const submitBtn = document.getElementById("np-submit") as HTMLButtonElement;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    submitBtn.disabled = true;
    errEl.style.display = "none";
    try {
      const res = await signInRes.resetPassword({ password: passEl.value });
      if (res.status === "complete") {
        await clerk.setActive({ session: res.createdSessionId });
        await boot();
      } else {
        errEl.textContent = "⚠ Could not set password. Please try again.";
        errEl.style.display = "block";
        submitBtn.disabled = false;
      }
    } catch (e: any) {
      errEl.textContent = `⚠ ${e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.message ?? "Error setting password."}`;
      errEl.style.display = "block";
      submitBtn.disabled = false;
    }
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const { user } = await api("/account/profile");
    if (user.role !== "admin") {
      gate.innerHTML = `
        <div class="g-logo">ME NEXT LEVEL</div>
        <h2>ACCESS DENIED</h2>
        <p>This area is restricted to administrators.</p>
        <a class="btn" href="../" style="margin-top:4px">BACK TO GAME</a>`;
      return;
    }
  } catch (e: any) {
    // 401 means not authenticated — show sign-in form
    if (e?.status === 401) {
      showSignInForm();
      return;
    }
    gate.innerHTML = `
      <div class="g-logo">ME NEXT LEVEL</div>
      <h2>ACCESS CHECK FAILED</h2>
      <p>Could not verify your account. Try again.</p>
      <button class="btn primary" onclick="location.reload()">RETRY</button>`;
    return;
  }

  // Authenticated admin — show dashboard
  gate.style.display = "none";
  shell.style.display = "";

  // Nav click handlers
  navEl.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) => {
    b.onclick = () => {
      navEl.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const tab = b.dataset.tab!;
      topbarTitle.textContent = TAB_LABELS[tab] ?? tab.toUpperCase();
      show(tab);
    };
  });

  // Sign out — clear admin cookie and return to sign-in form
  document.getElementById("signOutBtn")!.onclick = async () => {
    await fetch(`${BASE}/api/admin/logout`, { method: "POST", credentials: "include" });
    showSignInForm();
  };

  show("dashboard");
}

// ── Tab router ──────────────────────────────────────────────────────────────
async function show(tab: string) {
  main.innerHTML = `<div class="loading-msg">Loading…</div>`;
  try {
    if      (tab === "dashboard")     await tabDashboard();
    else if (tab === "users")         await tabUsers();
    else if (tab === "reports")       await tabReports();
    else if (tab === "statistics")    await tabStatistics();
    else if (tab === "announcements") await tabAnnouncements();
    else if (tab === "rules")         await tabRules();
    else if (tab === "logs")          await tabLogs();
  } catch (e) {
    main.innerHTML = `<div class="empty">Failed to load: ${esc((e as Error).message)}</div>`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function badge(status: string) {
  const map: Record<string, string> = {
    active: "badge-active", suspended: "badge-suspended",
    open: "badge-open", resolved: "badge-resolved", dismissed: "badge-dismissed",
    admin: "badge-admin", info: "badge-info", error: "badge-error",
  };
  return `<span class="badge ${map[status] ?? "badge-info"}">${esc(status)}</span>`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    admin_claimed:             "Admin role claimed",
    user_suspended:            "User suspended",
    user_active:               "User reactivated",
    account_deleted_by_admin:  "Account deleted",
    announcement_created:      "Announcement published",
    achievement_rule_updated:  "Achievement rule updated",
    report_resolved:           "Report resolved",
    report_dismissed:          "Report dismissed",
    sponsor_created:           "Sponsor campaign created",
    sponsor_updated:           "Sponsor campaign updated",
    sponsor_deleted:           "Sponsor campaign deleted",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function actDotClass(action: string) {
  if (action.includes("delete") || action.includes("suspend")) return "red";
  if (action.includes("active") || action.includes("resolved")) return "green";
  return "";
}

// ── DASHBOARD ───────────────────────────────────────────────────────────────
async function tabDashboard() {
  const [statsData, logsData] = await Promise.all([
    api("/admin/stats"),
    api("/admin/audit-logs?limit=8"),
  ]);
  const s = statsData;
  const logs: any[] = logsData.logs ?? [];

  main.innerHTML = `
    <div class="sec">OVERVIEW</div>
    <div class="cards">
      <div class="card"><b>${s.totalUsers}</b><span>Total Users</span></div>
      <div class="card accent"><b>${s.dau}</b><span>Active Today (DAU)</span></div>
      <div class="card"><b>${s.wau}</b><span>Active 7 Days (WAU)</span></div>
      <div class="card"><b>${s.totalMatches}</b><span>Matches Played</span></div>
      <div class="card"><b>${Number(s.streaks?.avg ?? 0).toFixed(1)}</b><span>Avg Streak</span></div>
      <div class="card accent"><b>${s.streaks?.max ?? 0}</b><span>Highest Streak</span></div>
      <div class="card"><b>${s.totalAssetsCompleted ?? "—"}</b><span>Assets Completed</span></div>
      <div class="card"><b>${s.totalLiabilitiesDefeated ?? "—"}</b><span>Liabilities Defeated</span></div>
    </div>

    <div class="sec">RECENT ACTIVITY</div>
    <div class="activity">
      ${logs.length === 0
        ? `<div class="empty">No activity yet.</div>`
        : logs.map((l) => `
          <div class="activity-item">
            <div class="act-dot ${actDotClass(l.action)}"></div>
            <div class="act-info">
              <div class="act-action">${esc(actionLabel(l.action))}</div>
              <div class="act-meta">${fmtDateTime(l.createdAt)}${l.actorId ? ` &nbsp;·&nbsp; by ${esc(l.actorId.slice(0, 12))}…` : ""}${l.details ? ` &nbsp;·&nbsp; ${esc(JSON.stringify(l.details))}` : ""}</div>
            </div>
          </div>`).join("")}
    </div>

    <div class="sec" style="margin-top:28px">PLATFORM SNAPSHOT</div>
    <div class="two-col">
      <div>
        <table>
          <tr><th colspan="2">Top Assets</th></tr>
          ${(s.topAssets ?? []).slice(0, 5).map((t: any) => `<tr><td>${esc(t.name)}</td><td style="color:var(--g3)">${t.uses} uses</td></tr>`).join("") || '<tr><td class="muted" colspan="2">No data</td></tr>'}
        </table>
      </div>
      <div>
        <table>
          <tr><th colspan="2">Top Liabilities</th></tr>
          ${(s.topLiabilities ?? []).slice(0, 5).map((t: any) => `<tr><td>${esc(t.name)}</td><td style="color:var(--g3)">${t.uses} uses</td></tr>`).join("") || '<tr><td class="muted" colspan="2">No data</td></tr>'}
        </table>
      </div>
    </div>`;
}

// ── USERS ───────────────────────────────────────────────────────────────────
async function tabUsers(q = "") {
  const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);

  main.innerHTML = `
    <div class="search-row">
      <input id="q" placeholder="Search by email, username, or ID…" value="${esc(q)}">
      <button class="btn primary" id="doSearch">SEARCH</button>
    </div>
    <table>
      <tr>
        <th>User</th><th>Status</th><th>Streak</th><th>All-time</th><th>Joined</th><th>Last seen</th><th>Actions</th>
      </tr>
      ${(users as any[]).map((r) => `
        <tr>
          <td>
            <div style="font-weight:600">${esc(r.user.username ?? "—")}</div>
            <div class="muted">${esc(r.user.email ?? r.user.id)}</div>
            ${r.user.role === "admin" ? '<span class="badge badge-admin" style="margin-top:3px;display:inline-block">ADMIN</span>' : ""}
          </td>
          <td>${badge(r.user.status ?? "active")}</td>
          <td>${r.streak ?? "—"}</td>
          <td>${r.best ?? "—"}</td>
          <td class="muted">${fmtDate(r.user.createdAt)}</td>
          <td class="muted">${fmtDateTime(r.user.lastSeenAt)}</td>
          <td>
            <div class="btn-row">
              <button class="btn ${r.user.status === "active" ? "" : "primary"}"
                data-act="${r.user.status === "active" ? "suspended" : "active"}"
                data-id="${esc(r.user.id)}"
                ${r.user.role === "admin" ? "disabled title='Cannot suspend another admin'" : ""}>
                ${r.user.status === "active" ? "SUSPEND" : "REACTIVATE"}
              </button>
              <button class="btn danger" data-del="${esc(r.user.id)}"
                ${r.user.role === "admin" ? "disabled title='Cannot delete admin account here'" : ""}>
                DELETE
              </button>
            </div>
          </td>
        </tr>`).join("")}
    </table>
    ${users.length === 0 ? '<div class="empty">No users found.</div>' : ""}
    <div class="muted" style="margin-top:12px">${users.length} result${users.length !== 1 ? "s" : ""}</div>`;

  const doSearch = () => tabUsers((document.getElementById("q") as HTMLInputElement).value.trim());
  document.getElementById("doSearch")!.onclick = doSearch;
  (document.getElementById("q") as HTMLInputElement).onkeydown = (e) => { if (e.key === "Enter") doSearch(); };

  main.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = "…";
      await api(`/admin/users/${b.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.act }) });
      tabUsers(q);
    };
  });

  main.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Permanently delete this user and ALL their data? This cannot be undone.")) return;
      if (!confirm("Final confirmation — streaks, history, achievements will all be erased. Continue?")) return;
      b.disabled = true;
      b.textContent = "Deleting…";
      await api(`/admin/users/${b.dataset.del}`, { method: "DELETE" });
      tabUsers(q);
    };
  });
}

// ── REPORTS ─────────────────────────────────────────────────────────────────
async function tabReports() {
  const { reports } = await api("/admin/reports?status=all");

  main.innerHTML = `
    <table>
      <tr>
        <th>When</th><th>Type</th><th>Content</th><th>Reason</th><th>Reporter</th><th>Status</th><th>Actions</th>
      </tr>
      ${(reports as any[]).map((r) => `
        <tr>
          <td class="muted">${fmtDateTime(r.createdAt)}</td>
          <td><span class="badge badge-info">${esc(r.targetType)}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.targetContent ?? "—")}</td>
          <td style="max-width:200px">${esc(r.reason)}</td>
          <td class="muted">${r.reporterId ? esc(r.reporterId.slice(0, 10)) + "…" : "—"}</td>
          <td>${badge(r.status)}</td>
          <td>
            <div class="btn-row">
              <button class="btn primary" data-id="${r.id}" data-s="resolved">RESOLVE</button>
              <button class="btn" data-id="${r.id}" data-s="dismissed">DISMISS</button>
            </div>
          </td>
        </tr>`).join("")}
    </table>
    ${reports.length === 0 ? '<div class="empty">No reports. All clear.</div>' : ""}`;

  main.querySelectorAll<HTMLButtonElement>("[data-s]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/admin/reports/${b.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.s }) });
      tabReports();
    };
  });
}

// ── STATISTICS ──────────────────────────────────────────────────────────────
async function tabStatistics() {
  const s = await api("/admin/stats");

  main.innerHTML = `
    <div class="sec">PLATFORM USAGE</div>
    <div class="cards">
      <div class="card"><b>${s.totalUsers}</b><span>Total Users</span></div>
      <div class="card accent"><b>${s.dau}</b><span>Active Today (DAU)</span></div>
      <div class="card"><b>${s.wau}</b><span>Active 7 Days (WAU)</span></div>
      <div class="card"><b>${s.totalMatches}</b><span>Matches Played</span></div>
      <div class="card"><b>${s.totalAssetsCompleted ?? "—"}</b><span>Assets Completed</span></div>
      <div class="card"><b>${s.totalLiabilitiesDefeated ?? "—"}</b><span>Liabilities Defeated</span></div>
    </div>

    <div class="sec">STREAK PERFORMANCE</div>
    <div class="cards">
      <div class="card"><b>${Number(s.streaks?.avg ?? 0).toFixed(1)}</b><span>Avg Current Streak</span></div>
      <div class="card accent"><b>${s.streaks?.max ?? 0}</b><span>Longest Current Streak</span></div>
      <div class="card"><b>${s.streaks?.maxBest ?? 0}</b><span>All-Time Best Streak</span></div>
    </div>

    <div class="sec">DAILY ACTIVE PLAYERS (LAST 14 DAYS)</div>
    <table>
      <tr><th>Date</th><th>Players who completed a match</th></tr>
      ${(s.dailyActive ?? []).map((d: any) => `
        <tr><td>${esc(d.date)}</td><td>${d.players}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No match data yet.</td></tr>'}
    </table>

    <div class="two-col" style="margin-top:24px">
      <div>
        <div class="sec">POPULAR ASSETS</div>
        <table>
          <tr><th>Asset Name</th><th>Times Used</th></tr>
          ${(s.topAssets ?? []).map((t: any) => `<tr><td>${esc(t.name)}</td><td>${t.uses}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No data yet.</td></tr>'}
        </table>
      </div>
      <div>
        <div class="sec">POPULAR LIABILITIES</div>
        <table>
          <tr><th>Liability Name</th><th>Times Used</th></tr>
          ${(s.topLiabilities ?? []).map((t: any) => `<tr><td>${esc(t.name)}</td><td>${t.uses}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No data yet.</td></tr>'}
        </table>
      </div>
    </div>`;
}

// ── ANNOUNCEMENTS ───────────────────────────────────────────────────────────
async function tabAnnouncements() {
  const { announcements } = await api("/admin/announcements");

  main.innerHTML = `
    <div class="sec">CREATE ANNOUNCEMENT</div>
    <div class="form-field">
      <label>Title</label>
      <input id="atitle" placeholder="e.g. New feature: Achievement badges" style="max-width:420px">
    </div>
    <div class="form-field">
      <label>Message</label>
      <textarea id="abody" placeholder="Write your message to all users…" style="max-width:520px"></textarea>
    </div>
    <div class="btn-row" style="margin-bottom:28px">
      <button class="btn primary" id="doSend">SEND TO ALL USERS</button>
      <span class="muted" id="sendMsg"></span>
    </div>

    <div class="sec">HISTORY</div>
    <table>
      <tr><th>When</th><th>Title</th><th>Message</th><th>Status</th><th>Actions</th></tr>
      ${(announcements as any[]).map((a) => `
        <tr>
          <td class="muted">${fmtDateTime(a.createdAt)}</td>
          <td style="font-weight:600">${esc(a.title)}</td>
          <td class="muted" style="max-width:260px">${esc(a.body)}</td>
          <td>${a.active ? badge("active") : badge("dismissed")}</td>
          <td>
            <button class="btn ${a.active ? "" : "primary"}" data-id="${a.id}" data-active="${!a.active}">
              ${a.active ? "DEACTIVATE" : "ACTIVATE"}
            </button>
          </td>
        </tr>`).join("")}
    </table>
    ${announcements.length === 0 ? '<div class="empty">No announcements yet.</div>' : ""}`;

  document.getElementById("doSend")!.onclick = async () => {
    const title = (document.getElementById("atitle") as HTMLInputElement).value.trim();
    const body  = (document.getElementById("abody")  as HTMLTextAreaElement).value.trim();
    const msg   = document.getElementById("sendMsg")!;
    if (!title || !body) { msg.textContent = "Title and message are required."; return; }
    msg.textContent = "Sending…";
    try {
      await api("/admin/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
      tabAnnouncements();
    } catch (e) {
      msg.textContent = "Failed: " + (e as Error).message;
    }
  };

  main.querySelectorAll<HTMLButtonElement>("[data-active]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/admin/announcements/${b.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: b.dataset.active === "true" }),
      });
      tabAnnouncements();
    };
  });
}

// ── ACHIEVEMENT RULES ────────────────────────────────────────────────────────
const DEFAULT_RULES = [
  { milestone: 7,  title: "Paparazzi Moment",   description: "7 days straight — sign your autograph." },
  { milestone: 30, title: "MeNotMe Champion",    description: "30 days straight — add one new Asset and Liability." },
  { milestone: 60, title: "Wall of Fame",        description: "60 days straight." },
  { milestone: 90, title: "Jersey Retirement",   description: "90 days — season complete, jersey retired." },
];

async function tabRules() {
  const { rules } = await api("/admin/achievement-rules");
  const merged = DEFAULT_RULES.map((d) => (rules as any[]).find((r) => r.milestone === d.milestone) ?? { ...d, enabled: true });

  main.innerHTML = `
    <p class="muted" style="margin-bottom:20px">Configure the title, description and enabled state for each streak milestone badge. Changes apply immediately.</p>
    ${merged.map((r: any) => `
      <div class="rule-row" data-ms="${r.milestone}">
        <div class="rule-top">
          <div class="rule-milestone">${r.milestone}d</div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--g3);margin-left:auto">
            <input class="r-en" type="checkbox" ${r.enabled !== false ? "checked" : ""}> Enabled
          </label>
        </div>
        <div class="form-row">
          <div class="form-field" style="flex:1;min-width:160px">
            <label>Badge Title</label>
            <input class="r-title" value="${esc(r.title)}">
          </div>
          <div class="form-field" style="flex:2;min-width:220px">
            <label>Description shown to user</label>
            <input class="r-desc" value="${esc(r.description)}">
          </div>
          <div class="form-field" style="align-self:flex-end">
            <button class="btn primary r-save">SAVE</button>
          </div>
        </div>
        <div class="muted r-msg"></div>
      </div>`).join("")}`;

  main.querySelectorAll<HTMLElement>(".rule-row[data-ms]").forEach((row) => {
    (row.querySelector(".r-save") as HTMLButtonElement).onclick = async () => {
      const msg = row.querySelector(".r-msg")!;
      msg.textContent = "Saving…";
      try {
        await api(`/admin/achievement-rules/${row.dataset.ms}`, {
          method: "PUT",
          body: JSON.stringify({
            title:       (row.querySelector(".r-title") as HTMLInputElement).value,
            description: (row.querySelector(".r-desc")  as HTMLInputElement).value,
            enabled:     (row.querySelector(".r-en")    as HTMLInputElement).checked,
          }),
        });
        msg.textContent = "✓ Saved";
        setTimeout(() => { msg.textContent = ""; }, 2000);
      } catch (e) {
        msg.textContent = "Error: " + (e as Error).message;
      }
    };
  });
}

// ── AUDIT LOGS ───────────────────────────────────────────────────────────────
async function tabLogs() {
  const { logs } = await api("/admin/audit-logs");

  main.innerHTML = `
    <table>
      <tr><th>When</th><th>Level</th><th>Action</th><th>Administrator</th><th>Affected User</th><th>Details</th></tr>
      ${(logs as any[]).map((l) => `
        <tr>
          <td class="muted" style="white-space:nowrap">${fmtDateTime(l.createdAt)}</td>
          <td>${badge(l.level === "error" ? "error" : "info")}</td>
          <td style="font-weight:600">${esc(actionLabel(l.action))}</td>
          <td class="muted">${l.actorId ? esc(l.actorId.slice(0, 14)) + "…" : "—"}</td>
          <td class="muted">${l.userId  ? esc(l.userId.slice(0, 14))  + "…" : "—"}</td>
          <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${l.details ? esc(JSON.stringify(l.details)) : "—"}</td>
        </tr>`).join("")}
    </table>
    ${logs.length === 0 ? '<div class="empty">No audit entries yet.</div>' : `<div class="muted" style="margin-top:12px">${logs.length} entries (most recent 200)</div>`}`;
}

boot();
