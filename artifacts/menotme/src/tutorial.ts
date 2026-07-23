/*
 * MeNotMe first-time interactive tutorial.
 * A guided spotlight layer over the LIVE arena — the real scoreboard, panels,
 * paper and hoop. No separate onboarding page, no redesign: black & white,
 * existing glass UI, existing typography.
 *
 * First run  : builds the player's real teams, teaches the real shot.
 * Replay     : "Profile → How to Play" — PRACTICE MODE on a throwaway copy
 *              of the state; official score/streak/history are untouched.
 */
import "./tutorial.css";

const KEY = "menotme_complete_v1";
const PRACTICE_SNAPSHOT_KEY = "mnm_tutorial_practice_v1"; // crash-safe restore point
const DONE_KEY = "mnm_tutorial_done_v1";
const FLAG_ONBOARDED = "mnm_onboarded_v1";
const INTRO_DAY_KEY = "mnm_intro_day";

interface Deps {
  api: (path: string, opts?: RequestInit) => Promise<unknown>;
  track: (event: string, opts?: { once?: boolean }) => void;
  onGameSave: (fn: () => void) => () => void;
  isSignedIn: () => boolean;
}
let deps: Deps | null = null;

interface Tag { name: string; done?: boolean; scored?: boolean; addressed?: boolean; avoided?: boolean }
interface GState {
  me: number; notme: number; ended: boolean; selected: number | null;
  assets: Tag[]; liabilities: Tag[];
  [k: string]: unknown;
}
function peek(): GState | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function write(s: GState) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.loadState?.();
  window.render?.();
}
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SUGGESTED_ASSETS = ["Workout", "Reading", "Family Time", "Saving Money", "Building My Business", "Healthy Eating", "Learning"];
const SUGGESTED_LIABILITIES = ["Procrastination", "Overspending", "Self-Doubt", "Too Much Screen Time", "Poor Sleep", "Negative Thinking"];

// ---------- module state ----------
let active = false;
let practice = false;
let snapshot: string | null = null; // practice-mode restore point
let root: HTMLDivElement | null = null;
let cardEl: HTMLDivElement | null = null;
let holeEl: HTMLDivElement | null = null;
let blockers: HTMLDivElement[] = [];
let repositionTimer: number | undefined;
let currentTargets: (() => Element | null)[] = [];
let currentPad = 10;
const cleanups: (() => void)[] = [];

export function practiceActive(): boolean { return active && practice; }
export function tutorialActive(): boolean { return active; }

function trk(event: string) {
  if (!deps) return;
  // first-run funnel events are once-only; replays only log tutorial_replayed
  if (practice) return;
  deps.track(event, { once: true });
}

// ---------- spotlight geometry ----------
function unionRect(): DOMRect | null {
  const rects = currentTargets
    .map((g) => g())
    .filter((e): e is Element => !!e)
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r.left)) - currentPad;
  const t = Math.min(...rects.map((r) => r.top)) - currentPad;
  const rr = Math.max(...rects.map((r) => r.right)) + currentPad;
  const b = Math.max(...rects.map((r) => r.bottom)) + currentPad;
  return new DOMRect(Math.max(0, l), Math.max(0, t), Math.min(window.innerWidth, rr) - Math.max(0, l), Math.min(window.innerHeight, b) - Math.max(0, t));
}

function layout() {
  if (!root || !holeEl) return;
  const r = unionRect();
  const W = window.innerWidth, H = window.innerHeight;
  const px = (n: number) => n + "px";
  if (!r) {
    // no target: single full dim, no hole
    holeEl.style.display = "none";
    const [top, left, right, bottom] = blockers;
    Object.assign(top.style, { left: "0", top: "0", width: px(W), height: px(H) });
    [left, right, bottom].forEach((b) => Object.assign(b.style, { width: "0", height: "0" }));
  } else {
    holeEl.style.display = "";
    Object.assign(holeEl.style, { left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height) });
    const [top, left, right, bottom] = blockers;
    Object.assign(top.style, { left: "0", top: "0", width: px(W), height: px(r.top) });
    Object.assign(bottom.style, { left: "0", top: px(r.bottom), width: px(W), height: px(Math.max(0, H - r.bottom)) });
    Object.assign(left.style, { left: "0", top: px(r.top), width: px(r.left), height: px(r.height) });
    Object.assign(right.style, { left: px(r.right), top: px(r.top), width: px(Math.max(0, W - r.right)), height: px(r.height) });
  }
  // card placement: opposite half from the spotlight (unless pinned)
  if (cardEl && !cardEl.classList.contains("tut-pin-top")) {
    cardEl.classList.remove("tut-top", "tut-bottom");
    const targetCenter = r ? r.top + r.height / 2 : H;
    cardEl.classList.add(targetCenter < H / 2 ? "tut-bottom" : "tut-top");
  }
}

function spot(targets: (() => Element | null)[], pad = 10) {
  currentTargets = targets;
  currentPad = pad;
  layout();
}

// ---------- overlay scaffolding ----------
function build() {
  root = document.createElement("div");
  root.className = "tut";
  blockers = ["t", "l", "r", "b"].map(() => {
    const d = document.createElement("div");
    d.className = "tut-block";
    root!.appendChild(d);
    return d;
  });
  holeEl = document.createElement("div");
  holeEl.className = "tut-hole";
  root.appendChild(holeEl);

  const skip = document.createElement("button");
  skip.className = "tut-skip";
  skip.textContent = "SKIP TUTORIAL ›";
  skip.onclick = () => { trk("tutorial_skipped"); end(true); };
  root.appendChild(skip);

  if (practice) {
    const badge = document.createElement("div");
    badge.className = "tut-badge";
    badge.textContent = "PRACTICE MODE";
    root.appendChild(badge);
  }

  cardEl = document.createElement("div");
  cardEl.className = "tut-card";
  root.appendChild(cardEl);

  document.body.appendChild(root);
  const onMove = () => layout();
  window.addEventListener("resize", onMove);
  window.addEventListener("scroll", onMove, true);
  repositionTimer = window.setInterval(layout, 600);
  cleanups.push(() => {
    window.removeEventListener("resize", onMove);
    window.removeEventListener("scroll", onMove, true);
    window.clearInterval(repositionTimer);
  });
}

function card(html: string, pinTop = false): HTMLDivElement {
  cardEl!.innerHTML = html;
  cardEl!.classList.remove("tut-pin-top", "tut-top", "tut-bottom");
  if (pinTop) cardEl!.classList.add("tut-pin-top", "tut-top");
  layout();
  return cardEl!;
}
function btn(label: string, cls = "tut-btn solid"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  return b;
}

// ---------- teardown / completion ----------
function cleanup() {
  cleanups.splice(0).forEach((f) => { try { f(); } catch { /* noop */ } });
  document.getElementById("rimFront")?.classList.remove("mnm-glow");
  document.getElementById("stage")?.classList.remove("lights-pulse");
  root?.remove();
  root = cardEl = holeEl = null;
  blockers = [];
  active = false;
}

function markDone() {
  localStorage.setItem(DONE_KEY, "1");
  localStorage.setItem(FLAG_ONBOARDED, "1");
  if (deps?.isSignedIn()) {
    deps.api("/account/profile", { method: "PATCH", body: JSON.stringify({ tutorialDone: true }) }).catch(() => {});
  }
}

function end(skipped: boolean) {
  const wasPractice = practice;
  cleanup();
  localStorage.removeItem(PRACTICE_SNAPSHOT_KEY);
  if (wasPractice && snapshot !== null) {
    // restore the official game untouched
    localStorage.setItem(KEY, snapshot);
    window.loadState?.();
    window.renderPower?.(0);
    window.render?.();
  } else {
    markDone();
    if (!skipped) trk("tutorial_completed");
    // don't stack the new-day intro right after the tutorial
    localStorage.setItem(INTRO_DAY_KEY, new Date().toISOString().slice(0, 10));
  }
  snapshot = null;
}

// ---------- tag application (dedupe, preserve existing) ----------
function applySelection(kind: "asset" | "liability", names: string[]) {
  const s = peek();
  if (!s) return;
  const fresh = (name: string): Tag =>
    kind === "asset" ? { name, done: false, scored: false } : { name, addressed: false, avoided: true };
  const existing = kind === "asset" ? s.assets : s.liabilities;
  const seen = new Set<string>();
  const next: Tag[] = [];
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    next.push(existing.find((e) => e.name.trim().toLowerCase() === k) ?? fresh(n.trim()));
  }
  if (kind === "asset") { s.assets = next; s.selected = null; }
  else s.liabilities = next;
  // building a team satisfies the 30-day gate the same way saveTag() does
  const gate = s.gate as { required?: boolean; asset?: boolean; liability?: boolean } | undefined;
  if (gate?.required) {
    if (kind === "asset") gate.asset = true; else gate.liability = true;
    if (gate.asset && gate.liability) gate.required = false;
  }
  write(s);
}

// ---------- chip selector step (assets / liabilities) ----------
function chipStep(opts: {
  kind: "asset" | "liability";
  title: string; text: string; cta: string; suggestions: string[];
  spotEl: string; onNext: () => void;
}) {
  spot([() => document.querySelector(opts.spotEl)], 8);
  const c = card(`<h3>${esc(opts.title)}</h3><p>${esc(opts.text)}</p>`);
  const wrap = document.createElement("div");
  wrap.className = "tut-chips";
  c.appendChild(wrap);

  const s = peek();
  const existingNames = ((opts.kind === "asset" ? s?.assets : s?.liabilities) ?? []).map((t) => t.name);
  // in a replay with real tags, pre-select them so nothing is lost
  const selected: string[] = [];
  // treat as a fresh slate if there are no existing tags
  const isDefaultSet = existingNames.length === 0;
  const custom: string[] = isDefaultSet ? [] : existingNames.filter((n) => !opts.suggestions.includes(n));
  if (!isDefaultSet) selected.push(...existingNames);

  const next = btn(opts.cta);
  next.disabled = true;

  const sync = () => {
    next.disabled = selected.length < 1;
    next.textContent = opts.cta;
    if (selected.length >= 1 || !isDefaultSet) applySelection(opts.kind, selected);
    renderChips();
  };
  const toggle = (name: string) => {
    const i = selected.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    if (i >= 0) selected.splice(i, 1); else selected.push(name);
    sync();
  };

  const renderChips = () => {
    wrap.innerHTML = "";
    for (const n of [...opts.suggestions, ...custom]) {
      const ch = document.createElement("button");
      const on = selected.some((x) => x.toLowerCase() === n.toLowerCase());
      ch.className = "tut-chip" + (on ? " on" : "");
      ch.textContent = (on ? "✓ " : "") + n;
      ch.onclick = () => toggle(n);
      wrap.appendChild(ch);
    }
    const own = document.createElement("button");
    own.className = "tut-chip own";
    own.textContent = "＋ Create My Own";
    own.onclick = () => {
      if (wrap.querySelector(".tut-own-row")) return;
      const row = document.createElement("div");
      row.className = "tut-own-row";
      const inp = document.createElement("input");
      inp.maxLength = 40;
      inp.placeholder = opts.kind === "asset" ? "e.g. Practice Guitar" : "e.g. Junk Food";
      const add = btn("ADD", "tut-btn");
      add.onclick = () => {
        const v = inp.value.trim();
        if (!v) return;
        if (![...opts.suggestions, ...custom].some((x) => x.toLowerCase() === v.toLowerCase())) custom.push(v);
        if (!selected.some((x) => x.toLowerCase() === v.toLowerCase())) selected.push(v);
        sync();
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") add.click(); };
      row.append(inp, add);
      wrap.appendChild(row);
      inp.focus();
    };
    wrap.appendChild(own);
  };

  renderChips();
  sync();
  next.onclick = () => {
    if (selected.length < 1) return;
    applySelection(opts.kind, selected);
    opts.onNext();
  };
  const r = document.createElement("div");
  r.className = "tut-row";
  r.appendChild(next);
  c.appendChild(r);
}

// ---------- the steps ----------
function stepWelcome() {
  spot([], 0);
  const c = card(
    `<h3>WELCOME TO ME NEXT LEVEL</h3><p>Every day is a game between the person you're becoming and the things holding you back.</p>`,
  );
  const go = btn("SHOW ME HOW");
  go.onclick = stepTeamMe;
  const r = document.createElement("div");
  r.className = "tut-row";
  r.appendChild(go);
  c.appendChild(r);
}

function stepTeamMe() {
  trk("tutorial_team_me_viewed");
  spot([() => document.querySelector(".scoreboard .team")], 8);
  const c = card(
    `<h3>TEAM ME NEXT LEVEL</h3><p>This is the version of you you're building.</p><p>Your Assets play for Team Me Next Level. Every positive action can score for your future self.</p>`,
  );
  const go = btn("NEXT");
  go.onclick = stepTeamNotMe;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

function stepTeamNotMe() {
  trk("tutorial_team_not_me_viewed");
  spot([() => document.querySelectorAll(".scoreboard .team")[1] ?? null], 8);
  const c = card(
    `<h3>TEAM HOLDING ME BACK</h3><p>These are the habits, choices and behaviours standing between you and your next level.</p><p>Your Liabilities play for Team Holding Me Back.</p>`,
  );
  const go = btn("NEXT");
  go.onclick = stepAssets;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

function stepAssets() {
  const s = peek();
  // replay with real teams already built → don't force re-creating tags
  if (practice && s && s.assets.length >= 1) return stepLiabilities();
  chipStep({
    kind: "asset",
    title: "BUILD YOUR TEAM ME NEXT LEVEL",
    text: "What will move you closer to your next level? Choose at least one Asset.",
    cta: "NEXT",
    suggestions: SUGGESTED_ASSETS,
    spotEl: ".panel.assets",
    onNext: () => { trk("tutorial_assets_selected"); stepLiabilities(); },
  });
}

function stepLiabilities() {
  const s = peek();
  if (practice && s && s.liabilities.length >= 1) return stepTapAsset();
  chipStep({
    kind: "liability",
    title: "WHAT'S HOLDING YOU BACK?",
    text: "Choose the habits and behaviours you want to beat.",
    cta: "START MY FIRST GAME",
    suggestions: SUGGESTED_LIABILITIES,
    spotEl: ".panel.liabilities",
    onNext: () => { trk("tutorial_liabilities_selected"); stepTapAsset(); },
  });
}

function stepTapAsset() {
  // practice replays can arrive with a finished/scored day — reopen the practice copy
  if (practice) {
    const s = peek();
    if (s) {
      let changed = false;
      if (s.ended) { s.ended = false; changed = true; }
      if (s.assets.length && s.assets.every((a) => a.scored)) { s.assets[0].scored = false; s.assets[0].done = false; changed = true; }
      if (changed) write(s);
    }
  }
  const s0 = peek();
  if (s0 && s0.selected !== null) return stepShot(); // paper already loaded
  spot([() => document.querySelector(".panel.assets")], 8);
  card(`<h3>DID YOU DO THIS TODAY?</h3><p>Tap a completed Asset.</p>`);
  const unhook = deps!.onGameSave(() => {
    const s = peek();
    if (!s || s.selected === null) return;
    unhook();
    document.getElementById("rimFront")?.classList.add("mnm-glow");
    stepShot();
  });
  cleanups.push(unhook);
}

function stepShot() {
  const baseMe = peek()?.me ?? 0;
  document.getElementById("rimFront")?.classList.add("mnm-glow");
  spot([() => document.getElementById("paper"), () => document.getElementById("rimFront")], 30);
  // pin the card to the top: the paper + hoop own the bottom/centre of the screen
  // and a bottom card would sit on top of the paper and eat the drag gesture
  card(`<h3>PULL BACK. FLICK. SCORE.</h3><p>Pull the paper back and release it toward the basket.</p>`, true);

  let attempted = false;
  const onAttempt = () => {
    if (attempted) return;
    attempted = true;
    trk("tutorial_first_shot_attempted");
  };
  const paper = document.getElementById("paper");
  paper?.addEventListener("pointerup", onAttempt);
  cleanups.push(() => paper?.removeEventListener("pointerup", onAttempt));

  // MISS — TRY AGAIN (wrap the global miss sfx; app.js top-level functions are window globals)
  const w = window as unknown as Record<string, unknown>;
  const origMiss = w.missSound;
  if (typeof origMiss === "function") {
    w.missSound = (...args: unknown[]) => {
      (origMiss as (...a: unknown[]) => void)(...args);
      trk("tutorial_first_shot_missed");
      const p = cardEl?.querySelector("p");
      if (p) p.innerHTML = `<b>MISS — TRY AGAIN.</b> Pull back and flick toward the basket.`;
    };
    cleanups.push(() => { w.missSound = origMiss; });
  }

  const unhook = deps!.onGameSave(() => {
    const s = peek();
    if (!s || s.me <= baseMe) return;
    unhook();
    if (typeof origMiss === "function") w.missSound = origMiss;
    trk("tutorial_first_shot_scored");
    document.getElementById("rimFront")?.classList.remove("mnm-glow");
    setTimeout(stepScored, 900);
  });
  cleanups.push(unhook);
}

function stepScored() {
  if (!root) return;
  spot([], 0);
  const c = card(`<h3>YOU JUST SCORED FOR TEAM ME</h3><p>Every decision changes the score.</p>`);
  const go = btn("KEEP GOING");
  go.onclick = stepLiabilityRules;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

function stepLiabilityRules() {
  spot([() => document.querySelector(".panel.liabilities")], 8);
  const c = card(
    `<h3>BEAT TEAM NOT ME</h3>
     <p>Avoid a Liability and Team Me can score at the Final Bell.</p>
     <div class="tut-states">
       <span class="tut-state"><b>AVOIDED</b>you stayed strong — a point for Team Me at the bell</span>
       <span class="tut-state"><b>HAPPENED</b>it happened — Team Not Me scores</span>
       <span class="tut-state"><b>IGNORED</b>ignore it completely and Team Not Me gets the point automatically</span>
     </div>`,
  );
  const go = btn("NEXT");
  go.onclick = stepFinalBell;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

function stepFinalBell() {
  trk("tutorial_final_bell_explained");
  spot([() => document.getElementById("finalBell")], 10);
  const c = card(
    `<h3>THE FINAL BELL DECIDES THE DAY</h3><p>At the end of the day, the final score determines who wins.</p><p>Win the day to build your Team Me streak.</p>`,
  );
  const go = btn("NEXT");
  go.onclick = stepStreak;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

function stepStreak() {
  spot([() => document.querySelector(".streak-chip")], 8);
  const c = card(
    `<h3>WIN THE DAY. BUILD THE STREAK.</h3><p>Team Me wins the day when it finishes with the higher score.</p><p>If Team Not Me wins the day, your streak returns to Day 1.</p>`,
  );
  const go = btn("LET'S PLAY");
  go.onclick = finale;
  const r = document.createElement("div"); r.className = "tut-row"; r.appendChild(go); c.appendChild(r);
}

// ---------- final sequence: commentator → rhythm → lights → play ----------
function finale() {
  if (!root) return;
  spot([], 0);
  cardEl!.innerHTML = "";
  cardEl!.style.display = "none";
  blockers.forEach((b) => (b.style.opacity = "0")); // arena takes the stage
  const skipBtn = root.querySelector(".tut-skip") as HTMLButtonElement | null;
  if (skipBtn) skipBtn.textContent = "SKIP INTRO ›";

  const stage = document.getElementById("stage");
  stage?.classList.add("lights-pulse");

  const w = window as unknown as {
    playCommentary?: (k: string[]) => Promise<void>;
    playIntroSound?: () => void;
    stopIntroAudio?: () => void;
    arenaReact?: (n: number) => void;
  };
  let finished = false;
  const timers: number[] = [];
  const finish = (fast: boolean) => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    if (fast) w.stopIntroAudio?.();
    end(false);
  };
  if (skipBtn) skipBtn.onclick = () => finish(true);

  let proceeded = false;
  const proceed = () => {
    if (proceeded || finished) return;
    proceeded = true;
    w.playIntroSound?.();
    timers.push(window.setTimeout(() => w.arenaReact?.(4), 1600));
    timers.push(window.setTimeout(() => finish(false), 3000));
  };
  const talking = w.playCommentary ? w.playCommentary(["comm_tutorial_1"]) : Promise.resolve();
  talking.then(proceed);
  timers.push(window.setTimeout(proceed, 4200)); // hard cap keeps the whole finale under ~7s
}

// ---------- public API ----------
export function startTutorial(opts: { practice: boolean }) {
  if (active || !deps) return;
  active = true;
  practice = opts.practice;
  snapshot = practice ? localStorage.getItem(KEY) : null;
  // persist the restore point so a reload mid-practice can't leave temp state as the real game
  if (practice && snapshot !== null) localStorage.setItem(PRACTICE_SNAPSHOT_KEY, snapshot);
  if (practice) deps.track("tutorial_replayed");
  else deps.track("tutorial_started", { once: true });
  build();
  stepWelcome();
}

export function initTutorial(d: Deps) {
  deps = d;
  // recover from a practice session interrupted by reload/crash: restore the
  // official state BEFORE any save/sync hook can persist the throwaway copy
  const orphan = localStorage.getItem(PRACTICE_SNAPSHOT_KEY);
  if (orphan !== null) {
    localStorage.setItem(KEY, orphan);
    localStorage.removeItem(PRACTICE_SNAPSHOT_KEY);
    window.loadState?.();
    window.render?.();
  }
  // Profile → How to Play (arena/profile modal) + main menu entry
  const replay = () => {
    document.getElementById("arenaModal")?.classList.remove("show");
    document.getElementById("menuModal")?.classList.remove("show");
    const firstRun = !localStorage.getItem(DONE_KEY) && !localStorage.getItem(FLAG_ONBOARDED);
    startTutorial({ practice: !firstRun });
  };
  ["howToPlay", "menuHowTo"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) (b as HTMLButtonElement).onclick = replay;
  });
}
