/*
 * MeNotMe cloud layer.
 * Additive only: authentication gate, cloud sync, notification bell,
 * settings & profile. The game UI and logic (app.js) are untouched.
 */
import { Clerk } from "@clerk/clerk-js"; // full bundle — includes Turnstile bot-protection (required for Clerk v6 signup)
import { publishableKeyFromHost } from "@clerk/shared/keys";
import "./cloud.css";
import { initTutorial, startTutorial, practiceActive } from "./tutorial";

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

// ---------- analytics (guest-friendly funnel events) ----------
const ANON_KEY = "mnm_anon_id";
function anonId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}
const SENT_KEY = "mnm_sent_events";
function track(event: string, opts: { once?: boolean } = {}) {
  try {
    if (opts.once) {
      const sent: string[] = JSON.parse(localStorage.getItem(SENT_KEY) || "[]");
      if (sent.includes(event)) return;
      sent.push(event);
      localStorage.setItem(SENT_KEY, JSON.stringify(sent));
    }
    void fetch(`${BASE}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonId: anonId(), events: [{ event }] }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break the game */
  }
}

// ---------- game state access (read-only peek at the game's localStorage) ----------
interface PeekState {
  me: number;
  notme: number;
  ended: boolean;
  selected: number | null;
  assets: { name: string; done: boolean; scored: boolean }[];
  liabilities: { name: string; addressed: boolean; avoided: boolean }[];
  weekly: { meWins: number; notMeWins: number; history: unknown[] };
}
function peekState(): PeekState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

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

let authDismissible = true;
function showAuthOverlay(mode: "in" | "up" = "up", heading?: string) {
  if (overlay) return;
  overlay = el("div", "mnm-overlay") as HTMLDivElement;
  document.body.appendChild(overlay);
  renderAuth(mode, heading);
  track("signup_started", { once: true });
}
function hideAuthOverlay() {
  overlay?.remove();
  overlay = null;
}

function renderAuth(mode: "in" | "up" | "forgot", heading?: string) {
  if (!overlay) return;
  overlay.innerHTML = "";
  // LED logo in auth overlay
  const ledCanvas = document.createElement("canvas");
  ledCanvas.setAttribute("aria-label", "Me Next Level");
  ledCanvas.setAttribute("role", "img");
  ledCanvas.style.cssText = "display:block;width:min(340px,80vw);margin:0 auto 4px";
  overlay.appendChild(ledCanvas);
  if (window.LEDLogo) (window as any).LEDLogo.init(ledCanvas);
  overlay.appendChild(el("p", "mnm-slogan", esc(heading ?? "Save your Me Next Level progress. Protect your streak. Play on any device.")));

  if (mode !== "forgot") {
    const toggle = el("div", "mnm-auth-toggle");
    const bIn = el("button", mode === "in" ? "active" : undefined, "SIGN IN");
    const bUp = el("button", mode === "up" ? "active" : undefined, "CREATE FREE ACCOUNT");
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

  // Google OAuth (works for both sign-in and sign-up via transfer flow)
  if (mode !== "forgot") {
    const google = el("button", "mnm-btn solid", "CONTINUE WITH GOOGLE");
    google.onclick = async () => {
      google.disabled = true;
      try {
        sessionStorage.setItem("mnm_oauth_pending", "1");
        await clerk.client!.signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: window.location.href.split("#")[0],
          redirectUrlComplete: window.location.href.split("#")[0],
        });
      } catch (e) {
        showError(e);
        google.disabled = false;
      }
    };
    row(google);
    row(el("p", "mnm-muted", "— or use email —"));
  }

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
        } else if (res.status === "needs_first_factor" || res.status === "needs_second_factor") {
          // Clerk requires an email verification code (e.g. account email not yet verified).
          // Show an inline code-entry form — do NOT dead-end the user.
          const isFirst = res.status === "needs_first_factor";
          const factors: any[] = (isFirst ? (res as any).supportedFirstFactors : (res as any).supportedSecondFactors) ?? [];
          const emailFactor = factors.find((f: any) => f.strategy === "email_code");
          if (emailFactor) {
            if (isFirst) {
              await (res as any).prepareFirstFactor({ strategy: "email_code", emailAddressId: emailFactor.emailAddressId });
            } else {
              await (res as any).prepareSecondFactor({ strategy: "email_code" });
            }
            // Swap form to code-entry UI
            form.innerHTML = "";
            form.appendChild(el("p", "mnm-muted", `A verification code was sent to ${esc(email.value.trim())}. Enter it below to sign in.`));
            const codeInput = authField("Verification code");
            const r1 = el("div", "mnm-row"); r1.appendChild(codeInput); form.appendChild(r1);
            form.appendChild(err);
            const verify = el("button", "mnm-btn solid", "VERIFY & SIGN IN");
            verify.onclick = async () => {
              verify.disabled = true;
              try {
                const done: any = isFirst
                  ? await (res as any).attemptFirstFactor({ strategy: "email_code", code: codeInput.value.trim() })
                  : await (res as any).attemptSecondFactor({ strategy: "email_code", code: codeInput.value.trim() });
                if (done.status === "complete") {
                  await clerk.setActive({ session: done.createdSessionId });
                  hideAuthOverlay();
                  onSignedIn();
                } else {
                  err.textContent = "Code incorrect or expired. Please try again.";
                }
              } catch (e) { showError(e); }
              verify.disabled = false;
            };
            const r2 = el("div", "mnm-row"); r2.appendChild(verify); form.appendChild(r2);
            const back = el("button", "mnm-btn", "BACK TO SIGN IN");
            back.onclick = () => renderAuth("in");
            const r3 = el("div", "mnm-row"); r3.appendChild(back); form.appendChild(r3);
          } else {
            // No email_code factor available — guide user to alternatives
            console.warn("[MNM Auth] Sign-in non-complete, status:", res.status, res);
            err.textContent = "Your account needs additional verification. Try Google sign-in or use Forgot Password to reset your account.";
          }
        } else {
          console.warn("[MNM Auth] Unexpected sign-in status:", res.status, res);
          err.textContent = "Sign-in incomplete. Please try Google sign-in or reset your password.";
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
    const go = el("button", "mnm-btn solid", "CREATE FREE ACCOUNT");
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

  if (authDismissible) {
    const guest = el("button", "mnm-btn ghost", "CONTINUE AS GUEST");
    guest.onclick = () => {
      hideAuthOverlay();
      track("continued_as_guest", { once: true });
    };
    overlay.appendChild(guest);
  }
}

// ---------- single saveState hook registry ----------
// Multiple features (cloud sync, guest triggers, onboarding shot watcher)
// need to observe game saves. Wrap window.saveState exactly once and
// dispatch to a listener set so hooks can be added/removed independently.
type SaveListener = () => void;
const saveListeners = new Set<SaveListener>();
let saveHookInstalled = false;
function onGameSave(fn: SaveListener): () => void {
  if (!saveHookInstalled) {
    const orig = window.saveState;
    if (typeof orig === "function") {
      window.saveState = () => {
        orig();
        for (const l of [...saveListeners]) {
          try {
            l();
          } catch {
            /* a listener must never break the game's save */
          }
        }
      };
      saveHookInstalled = true;
    }
  }
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

// ---------- cloud sync ----------
let syncTimer: number | undefined;
function scheduleSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(pushState, 1500);
}
async function pushState() {
  if (practiceActive()) return; // tutorial practice mode must never sync its throwaway state
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    await api("/game/state", { method: "PUT", body: JSON.stringify({ state: JSON.parse(raw) }) });
  } catch (e) {
    /* offline or transient — next save retries */
  }
}
function hookSaveState() {
  onGameSave(scheduleSync);
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
  // Notification bell stays as a floating FAB (top-right, below header).
  const wrap = el("div", "mnm-fab");
  const bell = el("button", undefined, "&#128276;");
  bell.setAttribute("aria-label", "Notifications");
  bellBadge = el("span", "mnm-badge") as HTMLSpanElement;
  bellBadge.style.display = "none";
  bell.appendChild(bellBadge);
  wrap.appendChild(bell);
  document.body.appendChild(wrap);
  bell.onclick = () => togglePanel("notifications");

  // Arena auth bar — hide guest buttons, show profile button
  const guestBtns = document.getElementById("arenaGuestBtns");
  const userBtns = document.getElementById("arenaUserBtns");
  if (guestBtns) guestBtns.style.display = "none";
  if (userBtns) userBtns.style.display = "";
  const arenaProfile = document.getElementById("arenaProfile") as HTMLButtonElement | null;
  if (arenaProfile) arenaProfile.onclick = () => togglePanel("account");
  // Bottom nav Profile → open account panel for signed-in users
  const navProfileBtn = document.getElementById("navProfile") as HTMLButtonElement | null;
  if (navProfileBtn) navProfileBtn.onclick = () => togglePanel("account");

  // Menu — hide guest items, show signed-in items
  const menuGuestItems = document.getElementById("menuGuestItems");
  const menuUserItems = document.getElementById("menuUserItems");
  if (menuGuestItems) menuGuestItems.style.display = "none";
  if (menuUserItems) menuUserItems.style.display = "";
  const menuProfile = document.getElementById("menuProfile") as HTMLButtonElement | null;
  if (menuProfile) menuProfile.onclick = () => {
    document.getElementById("menuModal")?.classList.remove("show");
    togglePanel("account");
  };
  const menuSignOut = document.getElementById("menuSignOut") as HTMLButtonElement | null;
  if (menuSignOut) menuSignOut.onclick = async () => {
    document.getElementById("menuModal")?.classList.remove("show");
    await clerk.signOut().catch(() => {});
    window.location.reload();
  };
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
  notme_winning: "Team Holding Me Back is currently ahead",
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
    sigInput.value = user.signature ?? "Team Me Next Level";
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
      adminLink.setAttribute("href", `${BASE}/admin/`);
      adminLink.setAttribute("style", "color:#fff;font-size:11px;letter-spacing:1px");
      p.appendChild(adminLink);
    }
  } catch (e) {
    p.appendChild(el("p", "mnm-muted", "Could not load account."));
  }
}

// ---------- guest-mode signup triggers ----------
let unhookGuestTriggers: (() => void) | null = null;
const FLAG_ONBOARDED = "mnm_onboarded_v1";
const FLAG_PROMPT_WIN = "mnm_prompt_first_win";
const FLAG_PROMPT_3D = "mnm_prompt_three_days";

function signupPrompt(title: string, body: string, cta: string) {
  if (overlay || document.querySelector(".mnm-onb") || document.querySelector(".tut")) return;
  track("signup_prompt_shown");
  const wrap = el("div", "mnm-onb") as HTMLDivElement;
  const card = el("div", "mnm-panel mnm-onb-card");
  card.appendChild(el("h3", undefined, esc(title)));
  card.appendChild(el("p", "mnm-muted", esc(body)));
  const go = el("button", "mnm-btn solid", esc(cta));
  go.onclick = () => {
    wrap.remove();
    showAuthOverlay("up");
  };
  const later = el("button", "mnm-btn ghost", "CONTINUE AS GUEST");
  later.onclick = () => {
    wrap.remove();
    track("continued_as_guest", { once: true });
  };
  const r1 = el("div", "mnm-row");
  r1.appendChild(go);
  const r2 = el("div", "mnm-row");
  r2.appendChild(later);
  card.append(r1, r2);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
}

/** Watches guest saves for value moments worth a signup prompt. Returns an unsubscribe. */
function watchGuestTriggers(): () => void {
  let prevEnded = peekState()?.ended ?? false;
  return onGameSave(() => {
    const s = peekState();
    if (!s) return;
    // Trigger A — first daily win
    if (!prevEnded && s.ended && s.me > s.notme && !localStorage.getItem(FLAG_PROMPT_WIN)) {
      localStorage.setItem(FLAG_PROMPT_WIN, "1");
      setTimeout(
        () => signupPrompt("TEAM ME NEXT LEVEL WON TODAY", "Save your progress and protect your streak.", "CREATE FREE ACCOUNT"),
        2200,
      );
    }
    prevEnded = s.ended;
    // Trigger B — 3 days of playing
    if (s.weekly.history.length >= 3 && !localStorage.getItem(FLAG_PROMPT_3D)) {
      localStorage.setItem(FLAG_PROMPT_3D, "1");
      setTimeout(
        () =>
          signupPrompt("Your streak is growing.", "Create a free account so you never lose your progress.", "SAVE MY PROGRESS"),
        1200,
      );
    }
  });
}

// ---------- onboarding (over the live game) ----------
function needsOnboarding(): boolean {
  if (localStorage.getItem(FLAG_ONBOARDED)) return false;
  const s = peekState();
  if (!s) return true;
  const hasProgress = s.me > 0 || s.notme > 0 || s.ended || s.weekly.history.length > 0;
  // custom tags = the player has already built their teams
  const hasCustomTags = s.assets.length > 0 || s.liabilities.length > 0;
  if (hasProgress || hasCustomTags) {
    localStorage.setItem(FLAG_ONBOARDED, "1");
    return false;
  }
  return true;
}


// ---------- arena auth bar (guest: Sign In + Create Account | signed-in: Profile) ----------
function guestFab() {
  // Arena auth bar — guest state
  const signIn = document.getElementById("arenaSignIn") as HTMLButtonElement | null;
  const createAcct = document.getElementById("arenaCreateAcct") as HTMLButtonElement | null;
  const menuSignIn = document.getElementById("menuSignIn") as HTMLButtonElement | null;
  const menuCreateAcct = document.getElementById("menuCreateAcct") as HTMLButtonElement | null;

  if (signIn) signIn.onclick = () => showAuthOverlay("in");
  if (createAcct) createAcct.onclick = () => showAuthOverlay("up");
  if (menuSignIn) menuSignIn.onclick = () => {
    document.getElementById("menuModal")?.classList.remove("show");
    showAuthOverlay("in");
  };
  if (menuCreateAcct) menuCreateAcct.onclick = () => {
    document.getElementById("menuModal")?.classList.remove("show");
    showAuthOverlay("up");
  };
  // Bottom nav Profile → open auth overlay for guests
  const navProfile = document.getElementById("navProfile") as HTMLButtonElement | null;
  if (navProfile) navProfile.onclick = () => showAuthOverlay("up");
}

// ---------- boot ----------
(async () => {
  initTutorial({
    api,
    track,
    onGameSave,
    isSignedIn: () => !!clerk.user,
  });
  track("landing_game_loaded");
  try {
    await clerk.load();
  } catch (e) {
    console.error("Clerk failed to load", e);
    // Clerk down — game still fully playable as guest
    if (needsOnboarding()) startTutorial({ practice: false });
    return;
  }

  // returning from Google OAuth redirect?
  if (sessionStorage.getItem("mnm_oauth_pending") && !clerk.user) {
    sessionStorage.removeItem("mnm_oauth_pending");
    try {
      await clerk.handleRedirectCallback({});
    } catch {
      /* not an OAuth callback or it failed — continue as guest */
    }
  } else {
    sessionStorage.removeItem("mnm_oauth_pending");
  }

  if (clerk.user) {
    await onSignedIn();
    return;
  }

  // Guest mode: play first, sign up later.
  unhookGuestTriggers = watchGuestTriggers();
  guestFab();
  if (needsOnboarding()) startTutorial({ practice: false });
})();

async function onSignedIn() {
  // guest-mode hooks must not fire once authenticated
  unhookGuestTriggers?.();
  unhookGuestTriggers = null;
  document.querySelector(".mnm-fab")?.remove();
  document.querySelector(".mnm-onb")?.remove();
  track("signup_completed", { once: true });
  const hadLocal = !!localStorage.getItem(KEY);
  hookSaveState();
  await pullCloudState();
  if (hadLocal) track("guest_data_migrated", { once: true });
  fab();
  refreshUnread();
  setInterval(refreshUnread, 60_000);
  // tutorial completion is account-level for registered users
  try {
    const { user } = (await api("/account/profile")) as { user: { tutorialDone?: boolean } };
    if (user?.tutorialDone) {
      localStorage.setItem("mnm_tutorial_done_v1", "1");
      localStorage.setItem(FLAG_ONBOARDED, "1");
    }
  } catch {
    /* offline — fall back to local flags */
  }
  // brand-new registered user with no prior guest data → same tutorial
  if (needsOnboarding()) startTutorial({ practice: false });
}
