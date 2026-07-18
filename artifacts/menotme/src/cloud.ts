/*
 * MeNotMe cloud layer.
 * Additive only: authentication gate, cloud sync, notification bell,
 * settings & profile. The game UI and logic (app.js) are untouched.
 */
import { Clerk } from "@clerk/clerk-js/no-rhc";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import "./cloud.css";

const KEY = "menotme_complete_v1";
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

declare global {
  interface Window {
    saveState?: () => void;
    loadState?: () => void;
    render?: () => void;
    renderPower?: (n?: number) => void;
  }
}

// ---------- tiny helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-timezone": TZ,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status, res });
  return res.json();
}
function toast(msg: string) {
  document.querySelector(".mnm-toast")?.remove();
  const t = el("div", "mnm-toast", msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const clerk = new Clerk(clerkPubKey, clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : undefined);

// ---------- custom black & white auth overlay (Clerk headless API) ----------
let overlay: HTMLDivElement | null = null;

function authField(placeholder: string, type = "text"): HTMLInputElement {
  const i = el("input") as HTMLInputElement;
  i.type = type;
  i.placeholder = placeholder;
  i.autocomplete = type === "password" ? "current-password" : type === "email" ? "email" : "off";
  i.setAttribute("style", "width:min(300px,80vw)");
  return i;
}

function showAuthOverlay() {
  if (overlay) return;
  overlay = el("div", "mnm-overlay") as HTMLDivElement;
  document.body.appendChild(overlay);
  renderAuth("in");
}
function hideAuthOverlay() {
  overlay?.remove();
  overlay = null;
}

function renderAuth(mode: "in" | "up" | "forgot") {
  if (!overlay) return;
  overlay.innerHTML = "";
  overlay.appendChild(el("h1", undefined, "MeNotMe"));
  overlay.appendChild(el("p", "mnm-slogan", "Play for the person you want to become."));

  if (mode !== "forgot") {
    const toggle = el("div", "mnm-auth-toggle");
    const bIn = el("button", mode === "in" ? "active" : undefined, "SIGN IN");
    const bUp = el("button", mode === "up" ? "active" : undefined, "SIGN UP");
    bIn.onclick = () => renderAuth("in");
    bUp.onclick = () => renderAuth("up");
    toggle.append(bIn, bUp);
    overlay.appendChild(toggle);
  }

  const form = el("div", "mnm-panel") as HTMLDivElement;
  form.setAttribute("style", "position:static;width:min(340px,92vw)");
  overlay.appendChild(form);
  const err = el("p", "mnm-muted");
  err.setAttribute("style", "min-height:14px");

  const email = authField("Email", "email");
  const password = authField("Password", "password");

  const showError = (e: unknown) => {
    const msg =
      (e as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]?.longMessage ??
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      "Something went wrong. Try again.";
    err.textContent = msg;
  };

  const row = (n: HTMLElement) => {
    const r = el("div", "mnm-row");
    r.appendChild(n);
    form.appendChild(r);
  };

  if (mode === "in") {
    row(email);
    row(password);
    const go = el("button", "mnm-btn solid", "SIGN IN");
    go.onclick = async () => {
      go.disabled = true;
      err.textContent = "";
      try {
        const res = await clerk.client!.signIn.create({ identifier: email.value.trim(), password: password.value });
        if (res.status === "complete") {
          await clerk.setActive({ session: res.createdSessionId });
          hideAuthOverlay();
          onSignedIn();
        } else {
          err.textContent = "Additional verification required — check your email.";
        }
      } catch (e) {
        showError(e);
      }
      go.disabled = false;
    };
    row(go);
    const forgot = el("button", "mnm-btn", "FORGOT PASSWORD?");
    forgot.onclick = () => renderAuth("forgot");
    row(forgot);
  } else if (mode === "up") {
    row(email);
    password.autocomplete = "new-password";
    row(password);
    const go = el("button", "mnm-btn solid", "CREATE ACCOUNT");
    const codeInput = authField("Verification code");
    go.onclick = async () => {
      go.disabled = true;
      err.textContent = "";
      try {
        const su = await clerk.client!.signUp.create({ emailAddress: email.value.trim(), password: password.value });
        await su.prepareEmailAddressVerification({ strategy: "email_code" });
        // swap to code entry
        form.innerHTML = "";
        form.appendChild(el("p", "mnm-muted", `We emailed a verification code to ${esc(email.value.trim())}.`));
        const r = el("div", "mnm-row");
        r.appendChild(codeInput);
        form.appendChild(r);
        const verify = el("button", "mnm-btn solid", "VERIFY EMAIL");
        verify.onclick = async () => {
          verify.disabled = true;
          try {
            const done = await clerk.client!.signUp.attemptEmailAddressVerification({ code: codeInput.value.trim() });
            if (done.status === "complete") {
              await clerk.setActive({ session: done.createdSessionId });
              hideAuthOverlay();
              onSignedIn();
            } else {
              err.textContent = "Verification incomplete — check the code.";
            }
          } catch (e) {
            showError(e);
          }
          verify.disabled = false;
        };
        const r2 = el("div", "mnm-row");
        r2.appendChild(verify);
        form.appendChild(r2);
        form.appendChild(err);
      } catch (e) {
        showError(e);
      }
      go.disabled = false;
    };
    row(go);
  } else {
    // forgot password
    form.appendChild(el("p", "mnm-muted", "Enter your email and we'll send a reset code."));
    row(email);
    const send = el("button", "mnm-btn solid", "SEND RESET CODE");
    send.onclick = async () => {
      send.disabled = true;
      err.textContent = "";
      try {
        await clerk.client!.signIn.create({
          strategy: "reset_password_email_code",
          identifier: email.value.trim(),
        });
        form.innerHTML = "";
        form.appendChild(el("p", "mnm-muted", `Code sent to ${esc(email.value.trim())}. Enter it with a new password.`));
        const code = authField("Reset code");
        const newPw = authField("New password", "password");
        newPw.autocomplete = "new-password";
        const r1 = el("div", "mnm-row");
        r1.appendChild(code);
        form.appendChild(r1);
        const r2 = el("div", "mnm-row");
        r2.appendChild(newPw);
        form.appendChild(r2);
        const doReset = el("button", "mnm-btn solid", "RESET PASSWORD");
        doReset.onclick = async () => {
          doReset.disabled = true;
          try {
            const att = await clerk.client!.signIn.attemptFirstFactor({
              strategy: "reset_password_email_code",
              code: code.value.trim(),
            });
            if (att.status === "needs_new_password" || att.status !== "complete") {
              const done = await clerk.client!.signIn.resetPassword({ password: newPw.value });
              if (done.status === "complete") {
                await clerk.setActive({ session: done.createdSessionId });
                hideAuthOverlay();
                onSignedIn();
                return;
              }
            } else if (att.status === "complete") {
              await clerk.setActive({ session: att.createdSessionId });
              hideAuthOverlay();
              onSignedIn();
              return;
            }
            err.textContent = "Could not finish the reset. Try again.";
          } catch (e) {
            showError(e);
          }
          doReset.disabled = false;
        };
        const r3 = el("div", "mnm-row");
        r3.appendChild(doReset);
        form.appendChild(r3);
        const back2 = el("button", "mnm-btn", "BACK TO SIGN IN");
        back2.onclick = () => renderAuth("in");
        const r4 = el("div", "mnm-row");
        r4.appendChild(back2);
        form.appendChild(r4);
        form.appendChild(err);
      } catch (e) {
        showError(e);
      }
      send.disabled = false;
    };
    row(send);
    const back = el("button", "mnm-btn", "BACK TO SIGN IN");
    back.onclick = () => renderAuth("in");
    row(back);
  }
  form.appendChild(err);
}

// ---------- cloud sync ----------
let syncTimer: number | undefined;
function scheduleSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(pushState, 1500);
}
async function pushState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    await api("/game/state", { method: "PUT", body: JSON.stringify({ state: JSON.parse(raw) }) });
  } catch (e) {
    /* offline or transient — next save retries */
  }
}
function hookSaveState() {
  const orig = window.saveState;
  if (typeof orig !== "function") return;
  window.saveState = () => {
    orig();
    scheduleSync();
  };
}
async function pullCloudState() {
  // 1) one-time import of pre-account local progress (idempotent server-side)
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      await api("/game/migrate", { method: "POST", body: JSON.stringify({ state: JSON.parse(raw) }) });
    } catch (e) {
      /* invalid local state — ignore */
    }
  } else {
    await api("/game/migrate", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  }
  // 2) cloud is the source of truth
  try {
    const { state } = await api("/game/state");
    localStorage.setItem(KEY, JSON.stringify(state));
    window.loadState?.();
    window.renderPower?.(0);
    window.render?.();
    // loadState() may roll the day/season — persist the result back
    scheduleSync();
  } catch (e) {
    // no cloud state (fresh account with no local progress) — push defaults
    scheduleSync();
  }
}

// ---------- notification bell + account ----------
let unread = 0;
let bellBadge: HTMLSpanElement | null = null;
function fab() {
  const wrap = el("div", "mnm-fab");
  const bell = el("button", undefined, "&#128276;");
  bell.setAttribute("aria-label", "Notifications");
  bellBadge = el("span", "mnm-badge") as HTMLSpanElement;
  bellBadge.style.display = "none";
  bell.appendChild(bellBadge);
  const account = el("button", undefined, "&#9786;");
  account.setAttribute("aria-label", "Account");
  wrap.append(bell, account);
  document.body.appendChild(wrap);
  bell.onclick = () => togglePanel("notifications");
  account.onclick = () => togglePanel("account");
}
function setUnread(n: number) {
  unread = n;
  if (!bellBadge) return;
  bellBadge.style.display = n > 0 ? "" : "none";
  bellBadge.textContent = String(n);
}

let panelEl: HTMLDivElement | null = null;
let panelKind: string | null = null;
function closePanel() {
  panelEl?.remove();
  panelEl = null;
  panelKind = null;
}
function openPanel(kind: string): HTMLDivElement {
  closePanel();
  panelKind = kind;
  panelEl = el("div", "mnm-panel") as HTMLDivElement;
  document.body.appendChild(panelEl);
  return panelEl;
}
function togglePanel(kind: "notifications" | "account") {
  if (panelKind === kind) return closePanel();
  if (kind === "notifications") renderNotifications();
  else renderAccount();
}

async function refreshUnread() {
  try {
    const { unread: n } = await api("/notifications");
    setUnread(n);
  } catch (e) {
    /* signed out or offline */
  }
}

async function renderNotifications() {
  const p = openPanel("notifications");
  p.innerHTML = `<h3>NOTIFICATIONS <button aria-label="Close">&times;</button></h3><p class="mnm-muted">Loading…</p>`;
  (p.querySelector("h3 button") as HTMLButtonElement).onclick = closePanel;
  try {
    const { notifications, unread: n } = await api("/notifications");
    setUnread(n);
    const list = notifications as { id: number; title: string; body: string; read: boolean; createdAt: string }[];
    p.querySelector("p")?.remove();
    if (n > 0) {
      const all = el("button", "mnm-btn", "MARK ALL READ");
      all.onclick = async () => {
        await api("/notifications/read-all", { method: "POST" });
        renderNotifications();
      };
      p.appendChild(all);
      p.appendChild(el("hr", "mnm-sep"));
    }
    if (list.length === 0) p.appendChild(el("p", "mnm-muted", "No notifications yet."));
    for (const note of list) {
      const d = el("div", "mnm-note" + (note.read ? "" : " unread"));
      d.innerHTML = `<b>${esc(note.title)}</b><span>${esc(note.body)}</span><time>${new Date(note.createdAt).toLocaleString()}</time>`;
      if (!note.read)
        d.onclick = async () => {
          await api(`/notifications/${note.id}/read`, { method: "POST" });
          d.classList.remove("unread");
          setUnread(Math.max(0, unread - 1));
        };
      p.appendChild(d);
    }
  } catch (e) {
    p.appendChild(el("p", "mnm-muted", "Could not load notifications."));
  }
}

async function enablePush(): Promise<string> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "Push is not supported in this browser.";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Permission was not granted.";
  const reg = await navigator.serviceWorker.register(`${BASE}/sw.js`);
  const { publicKey } = await api("/push/public-key");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
  return "Push notifications enabled.";
}
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const TYPE_LABELS: Record<string, string> = {
  final_bell_reminder: "Final Bell approaching",
  liabilities_unaddressed: "Liabilities not addressed",
  notme_winning: "Team Not Me is winning",
  one_more_asset: "One more Asset to lead",
  milestone_approaching: "Milestone approaching",
  streak_at_risk: "Streak at risk",
  milestone_achieved: "Milestone achieved",
  friend_challenge: "Friend challenge updates",
  announcement: "Announcements",
};

async function renderAccount() {
  const p = openPanel("account");
  p.innerHTML = `<h3>ACCOUNT <button aria-label="Close">&times;</button></h3><p class="mnm-muted">Loading…</p>`;
  (p.querySelector("h3 button") as HTMLButtonElement).onclick = closePanel;
  try {
    const [{ user }, settings] = await Promise.all([api("/account/profile"), api("/settings")]);
    p.querySelector("p")?.remove();

    const who = el("p", "mnm-muted", `${esc(user.email ?? "")} · timezone: ${esc(user.timezone)}`);
    p.appendChild(who);

    const nameRow = el("div", "mnm-row");
    nameRow.innerHTML = `<label>Display name</label>`;
    const nameInput = el("input") as HTMLInputElement;
    nameInput.type = "text";
    nameInput.value = user.username ?? "";
    nameRow.appendChild(nameInput);
    p.appendChild(nameRow);

    const sigRow = el("div", "mnm-row");
    sigRow.innerHTML = `<label>Signature</label>`;
    const sigInput = el("input") as HTMLInputElement;
    sigInput.type = "text";
    sigInput.value = user.signature ?? "Team Me";
    sigRow.appendChild(sigInput);
    p.appendChild(sigRow);

    const saveProfile = el("button", "mnm-btn solid", "SAVE PROFILE");
    saveProfile.onclick = async () => {
      await api("/account/profile", {
        method: "PATCH",
        body: JSON.stringify({ username: nameInput.value, signature: sigInput.value }),
      });
      toast("Profile saved");
    };
    p.appendChild(saveProfile);
    p.appendChild(el("hr", "mnm-sep"));

    // notification prefs
    p.appendChild(el("p", "mnm-muted", "NOTIFICATIONS — in-app / push per type"));
    const prefs: Record<string, { inapp: boolean; push: boolean }> = settings.notificationPrefs;
    for (const t of settings.types as string[]) {
      const row = el("div", "mnm-row");
      row.appendChild(el("label", undefined, esc(TYPE_LABELS[t] ?? t)));
      const sw = el("span", "mnm-switch");
      const inapp = el("input") as HTMLInputElement;
      inapp.type = "checkbox";
      inapp.checked = prefs[t]?.inapp ?? true;
      inapp.onchange = () => (prefs[t] = { ...prefs[t], inapp: inapp.checked });
      const push = el("input") as HTMLInputElement;
      push.type = "checkbox";
      push.checked = prefs[t]?.push ?? true;
      push.onchange = () => (prefs[t] = { ...prefs[t], push: push.checked });
      sw.append("app", inapp, "push", push);
      row.appendChild(sw);
      p.appendChild(row);
    }
    const btnRow = el("div", "mnm-row");
    const savePrefs = el("button", "mnm-btn solid", "SAVE PREFERENCES");
    savePrefs.onclick = async () => {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ notificationPrefs: prefs, pushEnabled: settings.pushEnabled }),
      });
      toast("Preferences saved");
    };
    const pushBtn = el("button", "mnm-btn", settings.pushEnabled ? "PUSH ENABLED" : "ENABLE PUSH");
    pushBtn.onclick = async () => {
      try {
        toast(await enablePush());
        settings.pushEnabled = true;
        pushBtn.textContent = "PUSH ENABLED";
      } catch (e) {
        toast("Could not enable push");
      }
    };
    btnRow.append(savePrefs, pushBtn);
    p.appendChild(btnRow);
    p.appendChild(el("hr", "mnm-sep"));

    // security: change password (Clerk headless)
    p.appendChild(el("p", "mnm-muted", "CHANGE PASSWORD"));
    const curPw = el("input") as HTMLInputElement;
    curPw.type = "password";
    curPw.placeholder = "Current password";
    curPw.autocomplete = "current-password";
    const newPw = el("input") as HTMLInputElement;
    newPw.type = "password";
    newPw.placeholder = "New password";
    newPw.autocomplete = "new-password";
    const r1 = el("div", "mnm-row");
    r1.appendChild(curPw);
    const r2 = el("div", "mnm-row");
    r2.appendChild(newPw);
    p.append(r1, r2);
    const pwBtn = el("button", "mnm-btn", "UPDATE PASSWORD");
    pwBtn.onclick = async () => {
      if (!curPw.value || newPw.value.length < 8) return toast("New password must be 8+ characters");
      try {
        await clerk.user!.updatePassword({ currentPassword: curPw.value, newPassword: newPw.value });
        curPw.value = newPw.value = "";
        toast("Password updated");
      } catch (e) {
        const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message;
        toast(msg || "Could not update password");
      }
    };
    const r3 = el("div", "mnm-row");
    r3.appendChild(pwBtn);
    p.appendChild(r3);

    const outRow = el("div", "mnm-row");
    const out = el("button", "mnm-btn", "LOG OUT");
    out.onclick = async () => {
      await pushState();
      localStorage.removeItem(KEY);
      await clerk.signOut();
      window.location.reload();
    };
    outRow.appendChild(out);
    p.appendChild(outRow);

    const delRow = el("div", "mnm-row");
    const del = el("button", "mnm-btn danger", "DELETE ACCOUNT");
    del.onclick = async () => {
      if (!confirm("Permanently delete your account and ALL game data? This cannot be undone.")) return;
      if (!confirm("Last check — everything (streaks, history, achievements) will be erased. Continue?")) return;
      await api("/account", { method: "DELETE" });
      localStorage.removeItem(KEY);
      await clerk.signOut().catch(() => {});
      window.location.reload();
    };
    delRow.appendChild(del);
    p.appendChild(delRow);

    if (user.role === "admin") {
      p.appendChild(el("hr", "mnm-sep"));
      const adminLink = el("a", undefined, "OPEN ADMIN DASHBOARD");
      adminLink.setAttribute("href", `${BASE}/admin.html`);
      adminLink.setAttribute("style", "color:#fff;font-size:11px;letter-spacing:1px");
      p.appendChild(adminLink);
    }
  } catch (e) {
    p.appendChild(el("p", "mnm-muted", "Could not load account."));
  }
}

// ---------- boot ----------
(async () => {
  try {
    await clerk.load();
  } catch (e) {
    console.error("Clerk failed to load", e);
    return; // leave the game playable locally rather than blocking it
  }

  if (!clerk.user) {
    showAuthOverlay();
    return;
  }
  onSignedIn();
})();

async function onSignedIn() {
  hookSaveState();
  await pullCloudState();
  fab();
  refreshUnread();
  setInterval(refreshUnread, 60_000);
}
