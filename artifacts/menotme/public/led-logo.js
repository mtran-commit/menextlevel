/**
 * led-logo.js — Interactive LED dot-matrix logo for Me Next Level
 *
 * Renders "ME NEXT LEVEL" as a dot-matrix LED board on a <canvas> element.
 *   • ME    → white LEDs
 *   • NEXT  → red LEDs  (pulses + sweeps brighter)
 *   • LEVEL → white LEDs
 *
 * Behaviours:
 *   - Travelling light sweep (left → right, loops)
 *   - Red NEXT sinusoidal pulse
 *   - Subtle glow via canvas shadowBlur on bright dots
 *   - Click / touchstart ripple from tap point
 *   - Hover glow burst from centre
 *   - prefers-reduced-motion: static fully-lit state, no animation
 *
 * No reflection. No iframes. Fully accessible (aria-label, role=img).
 *
 * Usage:
 *   LEDLogo.init(canvasElement)   → returns destroy() function
 */
(function () {
  'use strict';

  /* ── Character bitmaps (5 wide × 7 tall) ─────────────────────────────── */
  // Each entry: 7 rows × 5 cols, 1 = lit pixel, 0 = dark pixel
  const CHARS = {
    M: [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    E: [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    N: [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    X: [[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[0,1,0,1,0],[1,0,0,0,1]],
    T: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
    L: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    V: [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0]],
  };

  /* ── Word definitions ─────────────────────────────────────────────────── */
  const WORDS = [
    { text: 'ME',    color: 'white' },
    { text: 'NEXT',  color: 'red'   },
    { text: 'LEVEL', color: 'white' },
  ];

  const CHAR_GAP = 1; // columns between chars within a word
  const WORD_GAP = 3; // columns between words

  /* ── Build flat column map ────────────────────────────────────────────── */
  // GRID[col] = string[7], each entry 'white' | 'red' | null
  function buildGrid() {
    const grid = [];
    for (let wi = 0; wi < WORDS.length; wi++) {
      if (wi > 0) {
        for (let g = 0; g < WORD_GAP; g++) grid.push(new Array(7).fill(null));
      }
      const { text, color } = WORDS[wi];
      for (let ci = 0; ci < text.length; ci++) {
        if (ci > 0) {
          for (let g = 0; g < CHAR_GAP; g++) grid.push(new Array(7).fill(null));
        }
        const bm = CHARS[text[ci]];
        for (let dc = 0; dc < 5; dc++) {
          const col = [];
          for (let r = 0; r < 7; r++) col.push(bm[r][dc] ? color : null);
          grid.push(col);
        }
      }
    }
    return grid;
  }

  const GRID  = buildGrid();
  const NCOLS = GRID.length; // 69
  const NROWS = 7;

  /* ── Core init ────────────────────────────────────────────────────────── */
  function init(canvas) {
    if (!canvas || !canvas.getContext) return function(){};
    const ctx = canvas.getContext('2d');

    // Respect prefers-reduced-motion
    const mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mqReduced.matches;
    mqReduced.addEventListener('change', function(e){ reduced = e.matches; if (reduced) renderStatic(); });

    let raf        = null;
    let sweepX     = -16;   // sweep band centre (in column units)
    let pulseT     = 0;     // time accumulator for NEXT pulse
    let tapCol     = -50;   // column of last tap (for ripple)
    let tapAmt     = 0;     // ripple amount 0→1, decays
    let lastT      = null;

    /* -- Sizing ---------------------------------------------------------- */
    function setSize() {
      const dpr  = window.devicePixelRatio || 1;
      const cssW = Math.round(canvas.getBoundingClientRect().width) || canvas.offsetWidth || 200;
      const cssH = Math.round(cssW * NROWS / NCOLS);
      canvas.width  = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.height = cssH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* -- Render ---------------------------------------------------------- */
    function render(t) {
      if (lastT === null) lastT = t;
      const dt = Math.min(t - lastT, 50);
      lastT = t;

      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;
      if (!cssW || !cssH) return;

      if (!reduced) {
        sweepX += dt * 0.030;                  // full pass in ~2.3 s
        if (sweepX > NCOLS + 18) sweepX = -18;
        pulseT += dt * 0.0020;
        tapAmt  = Math.max(0, tapAmt - dt * 0.0014);
      }

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cssW, cssH);

      const cellW = cssW / NCOLS;
      const cellH = cssH / NROWS;
      const dotR  = Math.min(cellW, cellH) * 0.41;

      for (let c = 0; c < NCOLS; c++) {
        for (let r = 0; r < NROWS; r++) {
          const color = GRID[c][r];  // 'white' | 'red' | null
          const cx = (c + 0.5) * cellW;
          const cy = (r + 0.5) * cellH;

          /* -- Brightness ------------------------------------------------ */
          let bright;
          if (reduced) {
            bright = color ? 1 : 0.10;
          } else {
            bright = color ? 0.55 : 0.07;

            // Travelling sweep band
            const sd = Math.abs(c - sweepX);
            if (sd < 14) {
              const boost = 1 - sd / 14;
              if (color)  bright += 0.45 * boost;
              else        bright += 0.08 * boost; // faint reflection on unlit dots
            }

            // NEXT word sinusoidal pulse
            if (color === 'red') {
              bright += 0.28 * (0.5 + 0.5 * Math.sin(pulseT));
            }

            // Tap/hover ripple
            if (tapAmt > 0) {
              const td = Math.abs(c - tapCol);
              if (td < 22) bright += tapAmt * 0.55 * (1 - td / 22);
            }

            bright = Math.min(1, Math.max(0, bright));
          }

          /* -- Draw dark socket (always visible) ------------------------- */
          ctx.beginPath();
          ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
          if      (color === 'red')   ctx.fillStyle = 'rgba(55,0,8,0.72)';
          else if (color === 'white') ctx.fillStyle = 'rgba(22,22,22,0.72)';
          else                        ctx.fillStyle = 'rgba(14,14,14,0.60)';
          ctx.fill();

          /* -- Draw lit dot --------------------------------------------- */
          if (bright > 0.05) {
            const litR = dotR * Math.sqrt(bright); // sqrt → softer falloff curve
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(litR, dotR * 0.12), 0, Math.PI * 2);

            if (color === 'red') {
              ctx.fillStyle = `rgba(255,${Math.round(bright*18)},${Math.round(bright*28)},${bright.toFixed(3)})`;
              if (bright > 0.50) {
                ctx.shadowColor = 'rgba(255,0,24,0.85)';
                ctx.shadowBlur  = dotR * 3.0;
              }
            } else if (color === 'white') {
              ctx.fillStyle = `rgba(255,255,255,${bright.toFixed(3)})`;
              if (bright > 0.50) {
                ctx.shadowColor = 'rgba(190,210,255,0.70)';
                ctx.shadowBlur  = dotR * 2.2;
              }
            } else {
              // Unlit dot faintly lit by sweep
              ctx.fillStyle = `rgba(70,70,70,${(bright * 0.35).toFixed(3)})`;
            }

            ctx.fill();
            // Always reset shadow after each draw to avoid bleed
            ctx.shadowBlur  = 0;
            ctx.shadowColor = 'transparent';
          }
        }
      }
    }

    function renderStatic() { render(lastT ?? 0); }

    function loop(t) {
      render(t);
      if (!reduced) raf = requestAnimationFrame(loop);
    }

    /* -- Interaction ----------------------------------------------------- */
    function handleTap(e) {
      if (reduced) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      tapCol = Math.round((clientX - rect.left) / (rect.width / NCOLS));
      tapAmt = 1;
    }

    canvas.addEventListener('click',      handleTap);
    canvas.addEventListener('touchstart', handleTap, { passive: true });
    canvas.addEventListener('mouseenter', function () {
      if (reduced) return;
      tapCol = Math.round(NCOLS / 2);
      tapAmt = 0.65;
    });
    canvas.style.cursor = 'pointer';

    /* -- ResizeObserver -------------------------------------------------- */
    let roTimeout = null;
    const ro = new ResizeObserver(function () {
      // Debounce to avoid thrash during layout reflows
      clearTimeout(roTimeout);
      roTimeout = setTimeout(function () {
        setSize();
        if (reduced) renderStatic();
      }, 16);
    });
    ro.observe(canvas);

    /* -- Boot ------------------------------------------------------------ */
    setSize();
    if (reduced) {
      renderStatic();
    } else {
      raf = requestAnimationFrame(loop);
    }

    /* -- Cleanup --------------------------------------------------------- */
    return function destroy() {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(roTimeout);
      ro.disconnect();
      canvas.removeEventListener('click',      handleTap);
      canvas.removeEventListener('touchstart', handleTap);
    };
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.LEDLogo = { init: init };
})();
