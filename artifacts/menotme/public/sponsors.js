/* Arena Sponsors — stadium LED advertising boards.
   Purely additive layer: boards sit visually behind gameplay (z3, under signs z4,
   live elements z5+, paper z10) and never overlap hoop, panels, scoreboard or
   controls. No gameplay or design changes. Privacy: delivery/targeting only uses
   device type + guest/registered — never assets, liabilities, fans or doubters. */
(function () {
  "use strict";
  if (window.__mnmSponsorsInit) return; window.__mnmSponsorsInit = true;

  const ROOT = new URL(".", document.currentScript.src);
  const API = (p) => new URL(p, ROOT).toString();
  const MOBILE = matchMedia("(max-width:680px)").matches;
  const DEVICE = MOBILE ? "mobile" : "desktop";
  const AUDIENCE = document.cookie.indexOf("__session") >= 0 ? "registered" : "guest";
  const anonId = (function () {
    try {
      let a = localStorage.getItem("mnm_anon_id");
      if (!a) { a = "a" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("mnm_anon_id", a); }
      return a;
    } catch (e) { return "anon"; }
  })();

  /* ---------- shot-awareness: never rotate mid-shot ---------- */
  let busyUntil = 0;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (t && (t.id === "shoot" || t.id === "paper" || (t.closest && t.closest("#shoot,#paper")))) {
      busyUntil = Date.now() + 1900; // full shot animation window
    }
  }, true);
  const busy = () => Date.now() < busyUntil;

  /* ---------- analytics queue (no game data, ever) ---------- */
  let queue = [];
  const seenView = {};
  function track(campaignId, event, placement) {
    if (!campaignId) return; // house ads are not tracked
    queue.push({ campaignId, event, placement, device: DEVICE, audience: AUDIENCE });
    if (event === "sponsor_click") flush();
  }
  function flush() {
    if (!queue.length) return;
    const body = JSON.stringify({ anonId, events: queue.splice(0, 30) });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API("api/sponsors/events"), new Blob([body], { type: "application/json" }));
      else fetch(API("api/sponsors/events"), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    } catch (e) { /* never break the game for ads */ }
  }
  setInterval(flush, 20000);
  addEventListener("pagehide", flush);

  /* ---------- creatives ---------- */
  const HOUSE = [
    { id: 0, adType: "logo", sponsorName: "ME NEXT LEVEL", textContent: "OFFICIAL ARENA", durationSec: 10, frequency: 1 },
    { id: 0, adType: "text", sponsorName: "ME NEXT LEVEL", textContent: "LIVE YOUR FUTURE IN YOUR PRESENT", durationSec: 10, frequency: 1 },
    { id: 0, adType: "text", sponsorName: "TEAM ME NEXT LEVEL", textContent: "EVERY DAY IS GAME DAY", durationSec: 10, frequency: 1 },
  ];

  function creativeHTML(c) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
    let inner;
    if (c.adType === "banner" && c.bannerData) inner = '<img class="sp-img" alt="" src="' + c.bannerData + '">';
    else if (c.adType === "logo" && c.logoData) inner = '<img class="sp-img sp-logo" alt="" src="' + c.logoData + '">';
    else if (c.adType === "logo") inner = '<span class="sp-brand">' + esc(c.sponsorName) + "</span>" + (c.textContent ? '<span class="sp-sub">' + esc(c.textContent) + "</span>" : "");
    else inner = '<span class="sp-brand sp-small">' + esc(c.sponsorName) + "</span>" + (c.textContent ? '<span class="sp-text">' + esc(c.textContent) + "</span>" : "") + (c.ctaText ? '<span class="sp-cta">' + esc(c.ctaText) + "</span>" : "");
    const tag = c.destinationUrl ? '<span class="sp-adtag">AD</span>' : "";
    return '<div class="sp-face">' + inner + tag + "</div>";
  }

  /* ---------- board slots ---------- */
  function makeSlot(el, playlist, placement, offset) {
    if (!playlist.length) playlist = HOUSE;
    let i = offset % playlist.length;
    function show(first) {
      const c = playlist[i % playlist.length];
      const face = creativeHTML(c);
      if (first) el.innerHTML = face;
      else {
        el.insertAdjacentHTML("beforeend", face);
        const faces = el.querySelectorAll(".sp-face");
        if (faces.length > 1) {
          faces[faces.length - 1].classList.add("sp-in");
          faces[0].classList.add("sp-out");
          setTimeout(() => { if (faces[0].parentNode) faces[0].remove(); }, 950);
        }
      }
      el.__campaign = c;
      track(c.id, "sponsor_impression", placement);
      if (c.id && !seenView[c.id]) { seenView[c.id] = 1; track(c.id, "sponsor_campaign_view", placement); }
      i++;
      schedule((c.durationSec || 8) * 1000);
    }
    function schedule(ms) {
      setTimeout(function tick() {
        if (playlist.length < 2) return;      // nothing to rotate to
        if (busy()) return setTimeout(tick, 600); // pause during active shot
        show(false);
      }, ms);
    }
    show(true);

    // Deliberate-tap click handling: press + release on the same board,
    // minimal movement, not during a shot. Flicks/drags never trigger.
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    el.addEventListener("pointerup", (e) => {
      const c = el.__campaign, d = down; down = null;
      if (!c || !c.destinationUrl || !d || busy()) return;
      if (Date.now() - d.t > 700 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      track(c.id, "sponsor_click", placement);
      try { window.open(c.destinationUrl, "_blank", "noopener,noreferrer"); } catch (err) {}
    });
  }

  /* ---------- build the layer ---------- */
  function build(campaigns) {
    const stage = document.getElementById("stage");
    if (!stage) return;
    const layer = document.createElement("div");
    layer.id = "sponsorLayer";
    layer.innerHTML =
      '<div class="sp-strip sp-left"></div>' +
      '<div class="sp-strip sp-right"></div>' +
      '<div class="sp-board sp-bb sp-bb-l"></div>' +
      '<div class="sp-board sp-bb sp-bb-r"></div>' +
      '<div class="sp-ribbon"><div class="sp-ribbon-track"></div></div>';
    stage.appendChild(layer);

    const byPlace = (p) => {
      const list = [];
      campaigns
        .filter((c) => c.placement === p || c.placement === "any")
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .forEach((c) => { for (let k = 0; k < Math.max(1, Math.min(10, c.frequency || 1)); k++) list.push(c); });
      return list;
    };

    const slots = MOBILE ? 1 : 3;
    const L = layer.querySelector(".sp-left"), R = layer.querySelector(".sp-right");
    for (let s = 0; s < slots; s++) {
      const bl = document.createElement("div"); bl.className = "sp-board"; L.appendChild(bl);
      const br = document.createElement("div"); br.className = "sp-board"; R.appendChild(br);
      makeSlot(bl, byPlace("left"), "left", s);
      makeSlot(br, byPlace("right"), "right", s + 1);
    }
    makeSlot(layer.querySelector(".sp-bb-l"), byPlace("backboard"), "backboard", 0);
    makeSlot(layer.querySelector(".sp-bb-r"), byPlace("backboard"), "backboard", 1);

    // Upper ribbon: display-only marquee (never clickable — safest on mobile).
    const rib = byPlace("ribbon");
    const tr = layer.querySelector(".sp-ribbon-track");
    const seenRib = {};
    const items = (rib.length ? rib : HOUSE).slice(0, 6);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
    const one = items.map((c) => '<span class="sp-rib-item">' + esc(c.sponsorName) + (c.textContent ? " — " + esc(c.textContent) : "") + "</span>").join('<span class="sp-rib-dot">•</span>');
    tr.innerHTML = one + '<span class="sp-rib-dot">•</span>' + one; // doubled for seamless loop
    items.forEach((c) => { if (c.id && !seenRib[c.id]) { seenRib[c.id] = 1; track(c.id, "sponsor_impression", "ribbon"); } });
  }

  fetch(API("api/sponsors/active?device=" + DEVICE + "&audience=" + AUDIENCE))
    .then((r) => (r.ok ? r.json() : { campaigns: [] }))
    .then((d) => build((d && d.campaigns) || []))
    .catch(() => build([]));
})();
