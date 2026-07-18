/* MeNotMe Super Admin dashboard (black & white, matches the game). */
import { Clerk } from "@clerk/clerk-js/no-rhc";
import { publishableKeyFromHost } from "@clerk/shared/keys";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const clerk = new Clerk(
  publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
  import.meta.env.VITE_CLERK_PROXY_URL ? { proxyUrl: import.meta.env.VITE_CLERK_PROXY_URL } : undefined,
);

const gate = document.getElementById("gate")!;
const nav = document.getElementById("nav")!;
const main = document.getElementById("main")!;

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", "x-timezone": TZ, ...(opts.headers || {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status });
  return res.json();
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function boot() {
  await clerk.load();
  if (!clerk.user) {
    gate.innerHTML = `<h2>SIGN IN REQUIRED</h2><p class="muted">Sign in from the game first, then return here.</p><a class="btn solid" href="./">GO TO GAME</a>`;
    return;
  }
  try {
    const { user } = await api("/account/profile");
    if (user.role !== "admin") {
      gate.innerHTML = `<h2>ADMIN ACCESS REQUIRED</h2>
        <p class="muted">If no admin exists yet, the first user may claim the super-admin role.</p>
        <button class="btn solid" id="claim">CLAIM SUPER ADMIN</button><p class="muted" id="claimMsg"></p>`;
      document.getElementById("claim")!.onclick = async () => {
        try {
          await api("/admin/claim", { method: "POST" });
          location.reload();
        } catch {
          document.getElementById("claimMsg")!.textContent = "An admin already exists. Ask them for access.";
        }
      };
      return;
    }
  } catch (e) {
    gate.innerHTML = `<h2>ACCESS CHECK FAILED</h2><p class="muted">Could not verify your account.</p>`;
    return;
  }
  gate.style.display = "none";
  nav.style.display = "";
  main.style.display = "";
  nav.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      nav.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      show(b.dataset.tab!);
    };
  });
  show("stats");
}

async function show(tab: string) {
  main.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (tab === "stats") await tabStats();
    else if (tab === "users") await tabUsers();
    else if (tab === "reports") await tabReports();
    else if (tab === "announcements") await tabAnnouncements();
    else if (tab === "rules") await tabRules();
    else if (tab === "logs") await tabLogs();
  } catch (e) {
    main.innerHTML = `<p class="muted">Failed to load: ${esc((e as Error).message)}</p>`;
  }
}

async function tabStats() {
  const s = await api("/admin/stats");
  main.innerHTML = `
  <div class="cards">
    <div class="card"><b>${s.totalUsers}</b><span>TOTAL USERS</span></div>
    <div class="card"><b>${s.dau}</b><span>ACTIVE TODAY (DAU)</span></div>
    <div class="card"><b>${s.wau}</b><span>ACTIVE 7 DAYS (WAU)</span></div>
    <div class="card"><b>${s.totalMatches}</b><span>DAILY MATCHES PLAYED</span></div>
    <div class="card"><b>${Number(s.streaks.avg).toFixed(1)}</b><span>AVG CURRENT STREAK</span></div>
    <div class="card"><b>${s.streaks.max}</b><span>LONGEST CURRENT STREAK</span></div>
    <div class="card"><b>${s.streaks.maxBest}</b><span>ALL-TIME BEST STREAK</span></div>
  </div>
  <h2>PLAYERS PER DAY (last 14)</h2>
  <table><tr><th>Date</th><th>Players who finished a match</th></tr>
  ${s.dailyActive.map((d: { date: string; players: number }) => `<tr><td>${esc(d.date)}</td><td>${d.players}</td></tr>`).join("")}</table>
  <div class="row" style="align-items:flex-start;gap:32px;margin-top:20px">
    <div><h2>TOP ASSET TAGS</h2><table>${s.topAssets.map((t: { name: string; uses: number }) => `<tr><td>${esc(t.name)}</td><td>${t.uses}</td></tr>`).join("")}</table></div>
    <div><h2>TOP LIABILITY TAGS</h2><table>${s.topLiabilities.map((t: { name: string; uses: number }) => `<tr><td>${esc(t.name)}</td><td>${t.uses}</td></tr>`).join("")}</table></div>
  </div>`;
}

async function tabUsers(q = "") {
  const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
  main.innerHTML = `
  <div class="row"><input id="q" placeholder="Search email / name / id" value="${esc(q)}" style="width:260px">
  <button class="btn" id="search">SEARCH</button></div>
  <table><tr><th>User</th><th>Timezone</th><th>Streak</th><th>Best</th><th>Status</th><th>Joined</th><th>Last seen</th><th></th></tr>
  ${(users as any[])
    .map(
      (r) => `<tr>
      <td>${esc(r.user.username ?? "—")}<br><span class="muted">${esc(r.user.email ?? r.user.id)}</span>${r.user.role === "admin" ? ' <span class="pill">ADMIN</span>' : ""}</td>
      <td>${esc(r.user.timezone)}</td><td>${r.streak ?? "—"}</td><td>${r.best ?? "—"}</td>
      <td>${esc(r.user.status)}</td>
      <td>${new Date(r.user.createdAt).toLocaleDateString()}</td>
      <td>${new Date(r.user.lastSeenAt).toLocaleString()}</td>
      <td class="row" style="margin:0">
        <button class="btn" data-act="${r.user.status === "active" ? "suspended" : "active"}" data-id="${esc(r.user.id)}">${r.user.status === "active" ? "SUSPEND" : "REACTIVATE"}</button>
        <button class="btn" data-del="${esc(r.user.id)}">DELETE</button>
      </td></tr>`,
    )
    .join("")}</table>`;
  document.getElementById("search")!.onclick = () => tabUsers((document.getElementById("q") as HTMLInputElement).value);
  main.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
    b.onclick = async () => {
      await api(`/admin/users/${b.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.act }) });
      tabUsers(q);
    };
  });
  main.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Permanently delete this user and ALL their data?")) return;
      await api(`/admin/users/${b.dataset.del}`, { method: "DELETE" });
      tabUsers(q);
    };
  });
}

async function tabReports() {
  const { reports } = await api("/admin/reports?status=all");
  main.innerHTML = `<h2>REPORTED CONTENT</h2>
  <table><tr><th>When</th><th>Type</th><th>Content</th><th>Reason</th><th>Status</th><th></th></tr>
  ${(reports as any[])
    .map(
      (r) => `<tr><td>${new Date(r.createdAt).toLocaleString()}</td><td>${esc(r.targetType)}</td>
      <td>${esc(r.targetContent ?? "—")}</td><td>${esc(r.reason)}</td><td>${esc(r.status)}</td>
      <td class="row" style="margin:0">
        <button class="btn" data-id="${r.id}" data-s="resolved">RESOLVE</button>
        <button class="btn" data-id="${r.id}" data-s="dismissed">DISMISS</button>
      </td></tr>`,
    )
    .join("")}</table>
  ${reports.length === 0 ? '<p class="muted">No reports.</p>' : ""}`;
  main.querySelectorAll<HTMLButtonElement>("[data-s]").forEach((b) => {
    b.onclick = async () => {
      await api(`/admin/reports/${b.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.s }) });
      tabReports();
    };
  });
}

async function tabAnnouncements() {
  const { announcements } = await api("/admin/announcements");
  main.innerHTML = `<h2>NEW ANNOUNCEMENT</h2>
  <div class="row"><input id="atitle" placeholder="Title" style="width:240px"></div>
  <div class="row"><textarea id="abody" placeholder="Body" rows="3" style="width:420px;max-width:100%"></textarea></div>
  <div class="row"><button class="btn solid" id="send">SEND TO ALL USERS</button></div>
  <h2>HISTORY</h2>
  <table><tr><th>When</th><th>Title</th><th>Body</th><th>Active</th><th></th></tr>
  ${(announcements as any[])
    .map(
      (a) => `<tr><td>${new Date(a.createdAt).toLocaleString()}</td><td>${esc(a.title)}</td><td>${esc(a.body)}</td>
      <td>${a.active ? "yes" : "no"}</td>
      <td><button class="btn" data-id="${a.id}" data-active="${!a.active}">${a.active ? "DEACTIVATE" : "ACTIVATE"}</button></td></tr>`,
    )
    .join("")}</table>`;
  document.getElementById("send")!.onclick = async () => {
    const title = (document.getElementById("atitle") as HTMLInputElement).value.trim();
    const body = (document.getElementById("abody") as HTMLTextAreaElement).value.trim();
    if (!title || !body) return alert("Title and body required");
    await api("/admin/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
    tabAnnouncements();
  };
  main.querySelectorAll<HTMLButtonElement>("[data-active]").forEach((b) => {
    b.onclick = async () => {
      await api(`/admin/announcements/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ active: b.dataset.active === "true" }) });
      tabAnnouncements();
    };
  });
}

const DEFAULT_RULES = [
  { milestone: 7, title: "Paparazzi Moment", description: "7 days straight — sign your autograph." },
  { milestone: 30, title: "MeNotMe Champion", description: "30 days straight — add one new Asset and Liability." },
  { milestone: 60, title: "Wall of Fame", description: "60 days straight." },
  { milestone: 90, title: "Jersey Retirement", description: "90 days — season complete, jersey retired." },
];

async function tabRules() {
  const { rules } = await api("/admin/achievement-rules");
  const merged = DEFAULT_RULES.map((d) => (rules as any[]).find((r) => r.milestone === d.milestone) ?? { ...d, enabled: true });
  main.innerHTML = `<h2>ACHIEVEMENT RULES</h2>
  <table><tr><th>Milestone</th><th>Title</th><th>Description</th><th>Enabled</th><th></th></tr>
  ${merged
    .map(
      (r: any) => `<tr data-ms="${r.milestone}"><td>${r.milestone} days</td>
      <td><input class="r-title" value="${esc(r.title)}" style="width:170px"></td>
      <td><input class="r-desc" value="${esc(r.description)}" style="width:280px"></td>
      <td><input class="r-en" type="checkbox" ${r.enabled ? "checked" : ""}></td>
      <td><button class="btn solid r-save">SAVE</button></td></tr>`,
    )
    .join("")}</table>`;
  main.querySelectorAll<HTMLTableRowElement>("tr[data-ms]").forEach((tr) => {
    (tr.querySelector(".r-save") as HTMLButtonElement).onclick = async () => {
      await api(`/admin/achievement-rules/${tr.dataset.ms}`, {
        method: "PUT",
        body: JSON.stringify({
          title: (tr.querySelector(".r-title") as HTMLInputElement).value,
          description: (tr.querySelector(".r-desc") as HTMLInputElement).value,
          enabled: (tr.querySelector(".r-en") as HTMLInputElement).checked,
        }),
      });
    };
  });
}

async function tabLogs() {
  const { logs } = await api("/admin/audit-logs");
  main.innerHTML = `<h2>AUDIT &amp; ERROR LOGS</h2>
  <table><tr><th>When</th><th>Level</th><th>Action</th><th>Actor</th><th>User</th><th>Details</th></tr>
  ${(logs as any[])
    .map(
      (l) => `<tr><td>${new Date(l.createdAt).toLocaleString()}</td><td>${esc(l.level)}</td><td>${esc(l.action)}</td>
      <td class="muted">${esc(l.actorId ?? "—")}</td><td class="muted">${esc(l.userId ?? "—")}</td>
      <td class="muted">${esc(l.details ? JSON.stringify(l.details) : "—")}</td></tr>`,
    )
    .join("")}</table>
  ${logs.length === 0 ? '<p class="muted">No log entries yet.</p>' : ""}`;
}

boot();
