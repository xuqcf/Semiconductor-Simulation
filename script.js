/* =====================================================================
   HOW SEMICONDUCTORS WORK — interactive simulation
   ---------------------------------------------------------------------
   Plain HTML + CSS + vanilla JS. No build step, no dependencies.
   Everything draws onto a single <canvas> via requestAnimationFrame.

   HOW THIS FILE IS ORGANIZED (read top-to-bottom):
     1. COLORS          – the shared color legend (matches style.css)
     2. GLOSSARY        – one-line definitions for hover tooltips
     3. STATE           – global sim state (voltage, temp, paused...)
     4. DRAW HELPERS    – reusable functions to draw each particle type
     5. ENGINE          – canvas setup + the single rAF animation loop
     6. SCENES          – an array of scene objects (one per tab).
                          Each scene = { title, what, why, controls,
                          setup, update, draw }. The engine just calls
                          the ACTIVE scene's update()/draw() each frame.
     7. UI WIRING        – tabs, controls, info panel, event log, tooltips
   ===================================================================== */


/* =====================================================================
   1. COLORS  (keep in sync with :root in style.css)
   ===================================================================== */
const COLORS = {
  free:    '#ffc233',  // free electron (conduction band) – amber/gold
  valence: '#2dd4bf',  // valence/bonded electron – teal
  hole:    '#ff6b6b',  // hole (an absence) – coral ring
  nucleus: '#6b82c9',  // atom core – slate-blue
  photon:  '#fff7d6',  // photon – white/yellow
  field:   'rgba(138,160,200,0.55)', // field arrows
  band:    '#202a3d',  // band region fill
  gap:     'rgba(120,60,60,0.30)',   // forbidden gap shading
  text:    '#e6edf3',
  dim:     '#9aa7b8',
  wire:    '#5f6b7e',
};


/* =====================================================================
   2. GLOSSARY  – first-appearance definitions (shown as tooltips and
   used to build any "term" spans in the info panel text).
   ===================================================================== */
const GLOSSARY = {
  'electron': 'A negatively charged particle (charge −1). Its charge NEVER changes — only its energy does.',
  'valence electron': 'An electron in the outermost shell of an atom. These are the ones that form bonds.',
  'covalent bond': 'A shared pair of electrons holding two atoms together.',
  'valence band': 'The range of LOW energies where bonded electrons live. Full = no conduction.',
  'conduction band': 'The range of HIGH energies where electrons are free to move and carry current.',
  'band gap': 'A forbidden range of energies between the valence and conduction bands. No electron can rest here.',
  'hole': 'The empty spot left when an electron leaves a bond. Behaves like a mobile +1 charge.',
  'doping': 'Deliberately adding impurity atoms to silicon to add free electrons (n-type) or holes (p-type).',
  'n-type': 'Silicon doped with donors (e.g. phosphorus). Majority carriers are free electrons (−).',
  'p-type': 'Silicon doped with acceptors (e.g. boron). Majority carriers are holes (+).',
  'majority carrier': 'The carrier type that dominates a doped region: electrons in n-type, holes in p-type.',
  'depletion region': 'A thin zone at a junction where carriers have cancelled out, leaving an insulating wall.',
  'forward bias': '+ to p-side, − to n-side. Shrinks the depletion wall → the diode CONDUCTS.',
  'reverse bias': '+ to n-side, − to p-side. Widens the depletion wall → the diode INSULATES.',
  'recombination': 'A free electron drops into a hole. Energy equal to the band gap is released (as a photon in an LED).',
  'photon': 'A particle of light. Its energy equals the band-gap energy the electron lost.',
  'drift': 'Slow, directional movement of carriers caused by an electric field (on top of random jitter).',
  'conventional current': 'The historical convention: current flows + → −. Electrons actually move the OPPOSITE way (− → +).',
  // --- terms introduced by the new features ---
  'breakdown voltage': 'The reverse voltage at which the depletion wall fails and carriers are ripped across, destroying an ordinary diode.',
  'current-limiting resistor': 'A resistor in series with an LED that fixes the current at a safe value: I = (V_supply − V_LED) / R.',
  'crystal defect': 'An imperfection in the lattice that traps an electron and releases its energy as HEAT instead of a photon.',
  'phosphor': 'A coating that absorbs high-energy (blue) photons and re-emits a broad spread of lower-energy light, making white.',
  'III–V compound': 'A crystal of a group-III atom (3 valence e⁻) alternating with a group-V atom (5 valence e⁻); they average to 4, mimicking silicon.',
  'band gap (eV)': 'The energy an electron must drop to recombine. A bigger gap = a higher-energy (bluer) photon.',
};


/* =====================================================================
   3. STATE  – shared, mutated by controls, read by scenes.
   ===================================================================== */
const STATE = {
  voltage: 0,        // −5 .. +5  (slider)  (diode reverse range extended to −12)
  polarity: 1,       // +1 normal, −1 flipped (polarity button)
  temperature: 30,   // 0 .. 100  (thermal generation)
  bandGap: 50,       // 0 .. 100  (LED photon color — driven by material)
  gateOn: false,     // transistor gate
  paused: false,
  stepRequested: false,
  reducedMotion: false,

  // --- FEATURE 1: predict-then-reveal (session only, NOT persisted) ---
  predictFirst: true,
  predictFreeze: false, // when a prediction card is up, freeze the sim

  // --- FEATURE 5/6: material + real-circuit additions (LED scene) ---
  material: 'GaAs',     // 'Si' | 'GaAs' | 'GaN' (key into MATERIALS)
  resistorOn: true,     // FEATURE 3b/6: series current-limiting resistor
  resistorVal: 330,     // ohms (0..1000)
  crystalQuality: 0,    // FEATURE 3c: 0 = perfect ... 1 = fully defective
};

// Effective forward voltage taking the polarity flip into account.
// (declared up here because reduced-motion speed() is referenced widely)

/* =====================================================================
   FEATURE 5 — MATERIAL FAMILY
   Each semiconductor maps a band-gap energy (eV) to a photon color and a
   lattice style. Si is a single-element (group IV) lattice; GaAs and GaN
   are III–V compounds drawn as an alternating two-atom checkerboard.
   gapFrac drives how TALL the forbidden gap is drawn in band diagrams.
   ===================================================================== */
const MATERIALS = {
  Si:   { name: 'Silicon (Si)',          gapEV: 1.1, color: '#7a1f1f',
          visible: false, colorName: 'infrared (INVISIBLE)',
          note: 'INVISIBLE (infrared) — this is your TV remote.',
          lattice: 'single', a: 'Si', b: 'Si', aVal: 4, bVal: 4, gapFrac: 0.18 },
  GaAs: { name: 'Gallium arsenide (GaAs)', gapEV: 1.4, color: '#ff5a5a',
          visible: true, colorName: 'red',
          note: 'III–V compound — classic red LED.',
          lattice: 'compound', a: 'Ga', b: 'As', aVal: 3, bVal: 5, gapFrac: 0.30 },
  GaN:  { name: 'Gallium nitride (GaN)',  gapEV: 3.4, color: '#5a7bff',
          visible: true, colorName: 'blue',
          note: 'III–V compound — the breakthrough blue LED.',
          lattice: 'compound', a: 'Ga', b: 'N', aVal: 3, bVal: 5, gapFrac: 0.52 },
};
function material() { return MATERIALS[STATE.material]; }

// Global speed multiplier. Reduced motion slows EVERYTHING for study.
function speed() { return STATE.reducedMotion ? 0.25 : 1; }

// Effective forward voltage taking the polarity flip into account.
function effVoltage() { return STATE.voltage * STATE.polarity; }


/* =====================================================================
   4. DRAW HELPERS  – every particle type drawn the SAME way everywhere.
   ===================================================================== */

// Free electron: bright amber filled circle with a "−".
function drawFreeElectron(c, x, y, r = 9) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = COLORS.free; c.fill();
  c.fillStyle = '#3a2a00'; c.font = `bold ${r}px Inter`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('−', x, y);
}

// Valence (bonded) electron: teal filled circle with a "−".
function drawValenceElectron(c, x, y, r = 7) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = COLORS.valence; c.fill();
  c.fillStyle = '#06302b'; c.font = `bold ${r}px Inter`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('−', x, y);
}

// Hole: a coral RING (hollow — it's an absence) with a "+".
function drawHole(c, x, y, r = 9) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.lineWidth = 2.5; c.strokeStyle = COLORS.hole; c.stroke();
  c.fillStyle = COLORS.hole; c.font = `bold ${r}px Inter`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('+', x, y);
}

// Nucleus / lattice core: slate-blue circle labeled with element symbol.
function drawNucleus(c, x, y, label, r = 18, sub = '') {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = COLORS.nucleus; c.fill();
  c.strokeStyle = '#8fa6e0'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = '#fff'; c.font = `bold ${r * 0.7}px Inter`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, x, y - (sub ? r * 0.18 : 0));
  if (sub) { c.font = `${r * 0.42}px Inter`; c.fillStyle = '#cfe'; c.fillText(sub, x, y + r * 0.5); }
}

// Photon: a small white/yellow starburst.
function drawPhoton(c, x, y, scale = 1, color = COLORS.photon) {
  c.save(); c.translate(x, y); c.strokeStyle = color; c.fillStyle = color;
  c.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.beginPath(); c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * 9 * scale, Math.sin(a) * 9 * scale); c.stroke();
  }
  c.beginPath(); c.arc(0, 0, 3 * scale, 0, Math.PI * 2); c.fill();
  c.restore();
}

// Faint directional field arrow (the "voltage push").
function drawFieldArrow(c, x, y, dir, len = 26) {
  // dir: +1 points right, −1 points left.
  c.save(); c.strokeStyle = COLORS.field; c.fillStyle = COLORS.field; c.lineWidth = 1.5;
  const x2 = x + dir * len;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y); c.stroke();
  c.beginPath();
  c.moveTo(x2, y); c.lineTo(x2 - dir * 6, y - 4); c.lineTo(x2 - dir * 6, y + 4);
  c.closePath(); c.fill();
  c.restore();
}

// A text label / callout on the canvas (so EVERY event is explained).
function label(c, x, y, text, opts = {}) {
  const { color = COLORS.text, size = 13, align = 'left', bg = null, weight = '500' } = opts;
  c.font = `${weight} ${size}px Inter`; c.textAlign = align; c.textBaseline = 'top';
  if (bg) {
    const w = c.measureText(text).width;
    const px = align === 'center' ? x - w / 2 : x;
    c.fillStyle = bg; c.fillRect(px - 6, y - 4, w + 12, size + 8);
  }
  c.fillStyle = color; c.fillText(text, x, y);
}

// A bordered callout box with a title + body (used for big captions).
function callout(c, x, y, w, title, body, accent = COLORS.accent || '#7c9cff') {
  c.fillStyle = 'rgba(20,26,38,0.92)'; c.strokeStyle = accent; c.lineWidth = 1.5;
  const lines = wrapText(c, body, w - 24, 12);
  const h = 28 + lines.length * 16 + 8;
  roundRect(c, x, y, w, h, 8); c.fill(); c.stroke();
  label(c, x + 12, y + 9, title, { color: accent, weight: '700', size: 13 });
  c.font = '12px Inter'; c.fillStyle = COLORS.text; c.textAlign = 'left'; c.textBaseline = 'top';
  lines.forEach((ln, i) => c.fillText(ln, x + 12, y + 30 + i * 16));
  return h;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
}

function wrapText(c, text, maxW, size) {
  c.font = `${size}px Inter`;
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Linear interpolation + small helpers.
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);


/* =====================================================================
   5. ENGINE  – canvas + single animation loop.
   The loop is scene-agnostic: it sizes the canvas, computes dt, and
   delegates to whatever scene is active.
   ===================================================================== */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;        // logical (CSS) pixel size of the canvas
let activeScene = null;
let lastT = performance.now();

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  if (activeScene && activeScene.setup) activeScene.setup(); // re-layout particles
}
window.addEventListener('resize', resize);

// THE loop. Runs forever; respects pause and single-step.
function loop(now) {
  let dt = Math.min((now - lastT) / 1000, 0.05); // seconds, clamped
  lastT = now;

  // Pause freezes updates but we still redraw (so labels stay visible).
  // A pending prediction card (FEATURE 1) also freezes the animation so the
  // user commits BEFORE seeing the determinate outcome.
  const stepping = STATE.paused && STATE.stepRequested;
  const doUpdate = (!STATE.paused && !STATE.predictFreeze) || stepping;

  ctx.clearRect(0, 0, W, H);
  if (activeScene) {
    if (doUpdate && activeScene.update) activeScene.update(dt * speed() * (stepping ? 1 : 1));
    if (activeScene.draw) activeScene.draw(ctx);
  }
  updateConductionPanel(); // FEATURE 2: keep the "Can it conduct?" panel live
  STATE.stepRequested = false; // consume the single step
  requestAnimationFrame(loop);
}


/* =====================================================================
   EVENT LOG  – timestamped lines in the sidebar.
   ===================================================================== */
const logEl = document.getElementById('log');
function logEvent(text, isEvent = true) {
  const line = document.createElement('div');
  line.className = 'log-line' + (isEvent ? ' evt' : '');
  const t = new Date();
  const ts = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  line.innerHTML = `<span class="ts">[${ts}]</span> ${text}`;
  logEl.prepend(line);
  // keep the log from growing unbounded
  while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
}


/* =====================================================================
   6. SCENES
   Each scene is an object. Shared layout helpers below are used by the
   band-diagram scenes so the conduction/valence regions look identical.
   ===================================================================== */

// Draw the band-diagram backdrop: conduction band (top), forbidden gap
// (shaded middle), valence band (bottom). Returns the y-coordinates.
function drawBandBackdrop(c, x, w, opts = {}) {
  const top = opts.top ?? 40;
  const bottom = opts.bottom ?? H - 40;
  // FEATURE 5: the forbidden-gap height can resize with the material.
  const span = bottom - top;
  const cbH = span * 0.30;                       // conduction band height
  const gapH = span * (opts.gapFrac ?? 0.29);    // forbidden gap height
  const vbTop = top + cbH + gapH;
  const cb = { x, y: top, w, h: cbH };
  const gap = { x, y: top + cbH, w, h: vbTop - (top + cbH) };
  const vb = { x, y: vbTop, w, h: bottom - vbTop };

  // Conduction band (upper region)
  c.fillStyle = COLORS.band; roundRect(c, cb.x, cb.y, cb.w, cb.h, 6); c.fill();
  // Valence band (lower region)
  roundRect(c, vb.x, vb.y, vb.w, vb.h, 6); c.fill();
  // Forbidden gap (clearly shaded, with hatching)
  c.fillStyle = COLORS.gap; c.fillRect(gap.x, gap.y, gap.w, gap.h);
  c.save();
  c.strokeStyle = 'rgba(200,90,90,0.25)'; c.lineWidth = 1;
  for (let gx = gap.x - gap.h; gx < gap.x + gap.w; gx += 10) {
    c.beginPath(); c.moveTo(gx, gap.y + gap.h); c.lineTo(gx + gap.h, gap.y); c.stroke();
  }
  c.restore();

  label(c, cb.x + 10, cb.y + 8, 'CONDUCTION BAND  (high energy — electrons are free here)', { color: COLORS.free, size: 12, weight: '700' });
  label(c, vb.x + 10, vb.y + vb.h - 22, 'VALENCE BAND  (low energy — electrons are bonded here)', { color: COLORS.valence, size: 12, weight: '700' });
  label(c, gap.x + gap.w - 8, gap.y + gap.h / 2 - 8, 'FORBIDDEN — no electron states here', { color: '#ff9a9a', size: 12, weight: '700', align: 'right' });

  // "Energy" axis arrow on the left
  c.strokeStyle = COLORS.dim; c.fillStyle = COLORS.dim; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - 18, bottom); c.lineTo(x - 18, top); c.stroke();
  c.beginPath(); c.moveTo(x - 18, top); c.lineTo(x - 22, top + 8); c.lineTo(x - 14, top + 8); c.closePath(); c.fill();
  c.save(); c.translate(x - 30, (top + bottom) / 2); c.rotate(-Math.PI / 2);
  label(c, 0, 0, 'ENERGY', { color: COLORS.dim, size: 11, align: 'center' }); c.restore();

  return { cb, gap, vb };
}

const SCENES = [];


/* ---------------------------------------------------------------------
   SCENE 1 — THE ATOM
   A single silicon atom: nucleus "Si (14p⁺)" + shells of 2, 8, 4.
   The 4 valence electrons (teal) do the bonding; inner 10 are inert.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '1. The Atom',
  sub: 'A single silicon atom and why it wants to bond.',
  what: 'A single <span class="term" data-t="electron">silicon</span> atom. Its nucleus holds 14 protons (+14). Around it, 14 electrons sit in shells holding 2, 8, and 4 electrons. The outermost 4 are highlighted in teal.',
  why: 'Only the outer-shell <span class="term" data-t="valence electron">valence electrons</span> interact with other atoms. Silicon has 4 valence electrons but a full shell "wants" 8 — so each Si atom shares electrons with neighbors to reach 8. That sharing is what builds a crystal.',
  controls: [],
  // FEATURE 2: a lone atom has room (empty slots) but no path between atoms.
  conduction() { return { road: false, roadWhy: 'single atom — no path', band: true, bandWhy: 'has empty slots' }; },
  setup() { this.t = 0; },
  update(dt) { this.t += dt; },
  draw(c) {
    const cx = W / 2, cy = H / 2;
    const shells = [
      { n: 2, r: 70,  inert: true },
      { n: 8, r: 130, inert: true },
      { n: 4, r: 200, inert: false }, // valence shell
    ];
    // shell rings
    shells.forEach(s => {
      c.beginPath(); c.arc(cx, cy, s.r, 0, Math.PI * 2);
      c.strokeStyle = s.inert ? '#2a3344' : 'rgba(45,212,191,0.35)';
      c.lineWidth = 1; c.stroke();
    });
    // orbiting electrons
    shells.forEach((s, si) => {
      const spin = this.t * (0.3 - si * 0.07) * speed();
      for (let i = 0; i < s.n; i++) {
        const a = spin + (i / s.n) * Math.PI * 2;
        const x = cx + Math.cos(a) * s.r, y = cy + Math.sin(a) * s.r;
        if (s.inert) {
          c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2);
          c.fillStyle = '#4a5568'; c.fill(); // grayed-out, inert
          c.fillStyle = '#1a2030'; c.font = 'bold 7px Inter';
          c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('−', x, y);
        } else {
          drawValenceElectron(c, x, y, 8);
        }
      }
    });
    drawNucleus(c, cx, cy, 'Si', 30, '14p⁺');

    // labels / callouts
    label(c, cx, cy - 245, 'Silicon atom — 14 electrons in shells of 2, 8, 4', { align: 'center', size: 14, weight: '600' });
    label(c, 30, 30, '⬤ Inner 10 electrons: inert, tightly bound (they never bond)', { color: '#8b97a8', size: 12 });
    label(c, 30, 50, '⬤ Outer 4 valence electrons (teal): these do ALL the bonding', { color: COLORS.valence, size: 12 });
    callout(c, W - 320, H - 110, 300,
      'Why silicon bonds',
      'Silicon has 4 valence electrons but a full outer shell wants 8. To get there, each Si shares electrons with 4 neighbors → a crystal forms (next scene).');
  },
});


/* ---------------------------------------------------------------------
   SCENE 2 — THE CRYSTAL
   4x4 grid of Si atoms sharing covalent bonds (pairs of teal electrons)
   with neighbors. Hovering an atom highlights its 4 bonds.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '2. The Crystal',
  sub: 'Atoms lock together with covalent bonds — and nothing can move.',
  what: 'A 2-D grid of silicon atoms. Each <span class="term" data-t="covalent bond">covalent bond</span> is a shared pair of teal electrons between two neighbors. Hover an atom to highlight its 4 bonds.',
  why: 'Every valence electron is now locked inside a bond — none are free to roam. With no free carriers, pure (intrinsic) silicon is a <strong>poor conductor</strong>. We need heat or doping to free electrons.',
  controls: [],
  // FEATURE 2: bonded lattice IS a road, but the valence band is full (no movers).
  conduction() { return { road: true, roadWhy: 'bonded lattice', band: false, bandWhy: 'valence band full' }; },
  setup() {
    this.cols = 4; this.rows = 4; this.hover = -1;
    this.recalc();
    if (!this._bound) {
      canvas.onmousemove = (e) => {
        if (activeScene !== this) return;
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        this.hover = -1;
        this.atoms.forEach((a, i) => {
          if (Math.hypot(mx - a.x, my - a.y) < 24) this.hover = i;
        });
      };
      this._bound = true;
    }
  },
  recalc() {
    this.atoms = [];
    const padX = 120, padY = 70;
    const gx = (W - padX * 2) / (this.cols - 1);
    const gy = (H - padY * 2) / (this.rows - 1);
    for (let r = 0; r < this.rows; r++)
      for (let col = 0; col < this.cols; col++)
        this.atoms.push({ x: padX + col * gx, y: padY + r * gy, r, col });
  },
  update() {},
  idx(r, col) { return r * this.cols + col; },
  draw(c) {
    const A = this.atoms;
    // highlighted neighbors of hovered atom
    const hl = new Set();
    if (this.hover >= 0) {
      const a = A[this.hover];
      [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc]) => {
        const nr = a.r + dr, nc = a.col + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) hl.add(this.idx(nr, nc));
      });
    }
    // draw bonds (between horizontal & vertical neighbors)
    const drawBond = (a, b, highlight) => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      c.strokeStyle = highlight ? 'rgba(45,212,191,0.7)' : 'rgba(45,212,191,0.25)';
      c.lineWidth = highlight ? 3 : 2;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      // the two shared electrons sit near the midpoint
      const dx = (b.x - a.x), dy = (b.y - a.y), L = Math.hypot(dx, dy);
      const ox = -dy / L * 6, oy = dx / L * 6;
      drawValenceElectron(c, mx + ox, my + oy, 6);
      drawValenceElectron(c, mx - ox, my - oy, 6);
    };
    for (let r = 0; r < this.rows; r++) for (let col = 0; col < this.cols; col++) {
      const a = A[this.idx(r, col)];
      if (col < this.cols - 1) { const b = A[this.idx(r, col + 1)]; drawBond(a, b, (this.hover === this.idx(r,col) || this.hover === this.idx(r,col+1))); }
      if (r < this.rows - 1) { const b = A[this.idx(r + 1, col)]; drawBond(a, b, (this.hover === this.idx(r,col) || this.hover === this.idx(r+1,col))); }
    }
    // draw atoms
    A.forEach((a, i) => {
      const isHover = i === this.hover;
      if (isHover) { c.beginPath(); c.arc(a.x, a.y, 30, 0, Math.PI*2); c.fillStyle = 'rgba(124,156,255,0.12)'; c.fill(); }
      drawNucleus(c, a.x, a.y, 'Si', isHover ? 20 : 17);
    });

    // label one specific bond
    const a0 = A[this.idx(0,0)], a1 = A[this.idx(0,1)];
    label(c, (a0.x+a1.x)/2 - 70, (a0.y+a1.y)/2 - 48, 'covalent bond = 2 shared electrons ↑', { color: COLORS.valence, size: 11, weight: '600' });

    if (this.hover >= 0) {
      const a = A[this.hover];
      label(c, a.x + 30, a.y - 8, 'This atom now effectively has 8 electrons (full shell)', { color: '#bcd0ff', size: 12, bg: 'rgba(10,16,28,0.85)' });
    }
    callout(c, 20, H - 96, 340,
      'Pure silicon is a poor conductor',
      'Every valence electron is trapped in a bond. With no free carriers, nothing can flow. Heat or doping is needed to create mobile electrons or holes.');
  },
});


/* ---------------------------------------------------------------------
   SCENE 3 — ENERGY BANDS & THE GAP
   Band diagram. Valence band starts full; temperature slider triggers
   instantaneous electron jumps across the gap, leaving holes.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '3. Energy Bands & The Gap',
  sub: 'Heat kicks electrons across the band gap, making electron–hole pairs.',
  what: 'A band diagram. The <span class="term" data-t="valence band">valence band</span> (bottom) starts full of teal electrons; the <span class="term" data-t="conduction band">conduction band</span> (top) is empty. Between them is the <span class="term" data-t="band gap">band gap</span>.',
  why: 'Raise the temperature: thermal energy occasionally kicks one electron straight UP across the gap (an instant jump — it never rests inside the gap) into the conduction band, leaving a <span class="term" data-t="hole">hole</span> behind. That electron–hole pair is intrinsic conduction. The gap is in ENERGY, not physical space.',
  controls: ['temperature', 'material', 'transport'],
  // FEATURE 2: a pure crystal IS a road; whether the (upper) band has movers
  // depends on temperature — cold = full valence band, hot = freed carriers.
  conduction() {
    const hot = this.cond && this.cond.length > 0;
    return {
      road: true, roadWhy: 'bonded lattice',
      band: hot, bandWhy: hot ? 'heat freed some carriers' : 'valence band full',
      weak: true,
    };
  },
  gapFrac() { return material().gapFrac; },
  setup() {
    const x = 90, w = W - 180;
    this.region = computeBands(this.gapFrac());
    this._mat = STATE.material;
    this._prevTemp = STATE.temperature;
    // populate valence band fully (a packed grid of electrons)
    this.valence = []; this.cond = []; this.holes = []; this.photons = [];
    const vb = this.region.vb;
    const cols = 16, rows = 3;
    const dx = vb.w / (cols + 1), dy = vb.h / (rows + 1);
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < cols; col++)
        this.valence.push({ x: vb.x + dx * (col + 1), y: vb.y + dy * (r + 1), filled: true });
    this.timer = 0;
  },
  update(dt) {
    // material change resizes the gap → rebuild the diagram
    if (this._mat !== STATE.material) { this.setup(); }
    // geometry can change on resize; recompute band rects cheaply
    this.region = computeBands(this.gapFrac());

    // FEATURE 1: predict-first when temperature first rises past a threshold.
    if (STATE.temperature > 50 && this._prevTemp <= 50 && PREDICT.once('temp-pure')) {
      PREDICT.ask({
        tag: 'Pure semiconductor + heat',
        question: 'As temperature rises in a PURE semiconductor, conductivity will…?',
        options: ['Go UP', 'Go DOWN', 'Stay the same'],
        correct: 0,
        explain: 'Heat frees more electron-hole pairs → more carriers → more conduction. (This is the opposite of a metal, where heating reduces conductivity.)',
      });
    }
    this._prevTemp = STATE.temperature;

    this.timer += dt;
    // thermal generation rate scales with temperature
    const rate = (STATE.temperature / 100) * 1.4; // pairs per second-ish
    if (this.timer > 0.4 && Math.random() < rate * dt * 6) {
      this.timer = 0;
      // pick a filled valence electron and jump it across the gap (INSTANT)
      const candidates = this.valence.filter(v => v.filled);
      if (candidates.length) {
        const v = candidates[Math.floor(Math.random() * candidates.length)];
        v.filled = false;
        this.holes.push({ x: v.x, y: v.y, life: 6 });
        const cb = this.region.cb;
        this.cond.push({ x: v.x, y: cb.y + rand(cb.h * 0.3, cb.h * 0.7), vx: rand(-30, 30), home: v });
        logEvent('🔥 Thermal energy freed one electron → created one electron–hole PAIR.');
      }
    }
    // free electrons drift/jitter in conduction band
    const cb = this.region.cb;
    this.cond.forEach(e => {
      e.x += e.vx * dt;
      if (e.x < cb.x + 10 || e.x > cb.x + cb.w - 10) e.vx *= -1;
      e.y += rand(-8, 8) * dt;
      e.y = clamp(e.y, cb.y + 10, cb.y + cb.h - 10);
    });
    // recombination: occasionally an electron falls back into a hole
    if (this.cond.length && this.holes.length && Math.random() < 0.4 * dt) {
      const e = this.cond.shift();
      const h = this.holes.shift();
      const v = this.valence.find(vv => vv === h._v) || this.valence.find(vv => !vv.filled);
      if (v) v.filled = true;
      this.photons.push({ x: h.x, y: h.y, life: 0.8 });
      logEvent('↩️ Recombination: a free electron dropped back into a hole (pair annihilated).');
    }
    this.holes.forEach(h => h.life -= dt);
    this.photons.forEach(p => p.life -= dt);
    this.photons = this.photons.filter(p => p.life > 0);
  },
  draw(c) {
    const reg = drawBandBackdrop(c, 90, W - 180, { gapFrac: this.gapFrac() });
    this.region = reg;
    // valence electrons (packed — full band can't conduct)
    this.valence.forEach(v => { if (v.filled) drawValenceElectron(c, v.x, v.y, 7); else drawHole(c, v.x, v.y, 7); });
    // free electrons in conduction band
    this.cond.forEach(e => drawFreeElectron(c, e.x, e.y, 8));
    // photons
    this.photons.forEach(p => drawPhoton(c, p.x, p.y, 1 + (0.8 - p.life)));

    // dashed jump arrow illustrating the instantaneous crossing
    c.save(); c.setLineDash([5,4]); c.strokeStyle = 'rgba(255,194,51,0.5)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(reg.vb.x + 40, reg.vb.y); c.lineTo(reg.vb.x + 40, reg.cb.y + reg.cb.h);
    c.stroke(); c.restore();
    label(c, reg.vb.x + 48, reg.gap.y + reg.gap.h/2 - 8, 'instant jump across the gap →', { color: COLORS.free, size: 11 });

    const m = material();
    label(c, 90, H - 28, `${m.name} — gap ${m.gapEV} eV • Temp ${STATE.temperature}/100 — free electrons: ${this.cond.length}, holes: ${this.holes.filter(h=>h.life>0).length}`, { color: COLORS.dim, size: 12 });
    callout(c, W - 330, 8, 310,
      'The gap is in ENERGY, not space',
      `No electron can exist between the bands. Crossing it costs a fixed jump of energy (the gap = ${m.gapEV} eV here). A bigger gap is harder to cross. At higher temperature, more pairs are made — intrinsic conduction rises.`);
  },
});


/* ---------------------------------------------------------------------
   SCENE 4 — DOPING (n-type & p-type), side by side.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '4. Doping (n-type & p-type)',
  sub: 'Swap one atom to inject a free electron (n) or a hole (p).',
  what: 'Left: <span class="term" data-t="n-type">n-type</span> silicon with one Si replaced by phosphorus (P, 5 valence electrons). Right: <span class="term" data-t="p-type">p-type</span> with one Si replaced by boron (B, 3 valence electrons).',
  why: 'P has 5 valence electrons: 4 form bonds, the 5th has no bond to join → it roams free (a <span class="term" data-t="majority carrier">majority carrier</span>). B has only 3: one bond can\'t form → a hole, which moves as neighboring electrons hop into it. The lattice stays at 8 per atom — the rule is never broken.',
  controls: ['dopant', 'transport'],
  // FEATURE 2: doping adds mobile carriers (free electrons in n, holes in p)
  // to an already-bonded lattice → both sides conduct.
  conduction() { return { road: true, roadWhy: 'bonded lattice', band: true, bandWhy: 'free electrons added' }; },
  setup() {
    this.t = 0;
    this.buildLattice();
  },
  buildLattice() {
    // two 3x3 lattices
    const make = (ox) => {
      const atoms = []; const pad = 70; const cell = (W/2 - pad*1.6) / 2;
      for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++)
        atoms.push({ x: ox + pad + col*cell, y: 110 + r*cell, r, col });
      return atoms;
    };
    this.nAtoms = make(0);
    this.pAtoms = make(W/2);
    // n-type: center atom = P, a free electron roams above
    this.freeE = { x: this.nAtoms[4].x, y: 70, vx: 40 };
    // p-type: center atom = B, hole + a hopping electron
    this.hole = { x: this.pAtoms[4].x, y: this.pAtoms[4].y - 28, target: null };
    this.hopTimer = 0;
  },
  update(dt) {
    this.t += dt;
    this.buildPositionsOnly();
    // n-type free electron wanders in the conduction region (top band)
    this.freeE.x += this.freeE.vx * dt;
    if (this.freeE.x < W*0.06 || this.freeE.x > W*0.44) this.freeE.vx *= -1;
    this.freeE.y = 70 + Math.sin(this.t*2) * 8;
    // p-type: hole hops between bond sites (electron hops opposite way)
    this.hopTimer += dt;
    if (this.hopTimer > 1.4) {
      this.hopTimer = 0;
      const sites = this.pAtoms.filter(a => Math.hypot(a.x-this.hole.x, a.y-this.hole.y) < 160 && (a.x!==this.hole.x||a.y!==this.hole.y));
      if (sites.length) {
        const dest = sites[Math.floor(Math.random()*sites.length)];
        this.lastHop = { from: { x: this.hole.x, y: this.hole.y }, to: { x: dest.x, y: dest.y - 28 } };
        this.hole.x = dest.x; this.hole.y = dest.y - 28;
        logEvent('↪️ Hole moved — actually a neighboring electron hopped the OTHER way.');
      }
    }
  },
  buildPositionsOnly() {
    // keep lattices responsive if width changed
    if (this._w !== W) { this._w = W; this.buildLattice(); }
  },
  draw(c) {
    // divider
    c.strokeStyle = COLORS.border || '#283040'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(W/2, 30); c.lineTo(W/2, H-30); c.stroke();
    label(c, W*0.25, 36, 'n-TYPE  (donor: Phosphorus)', { align:'center', color: COLORS.free, weight:'700' });
    label(c, W*0.75, 36, 'p-TYPE  (acceptor: Boron)', { align:'center', color: COLORS.hole, weight:'700' });

    // ---- helper to draw a lattice with bonds ----
    const drawLat = (atoms, dopantIdx, sym) => {
      // bonds to right & down neighbors
      for (let r=0;r<3;r++) for (let col=0;col<3;col++){
        const a = atoms[r*3+col];
        const right = col<2?atoms[r*3+col+1]:null;
        const down = r<2?atoms[(r+1)*3+col]:null;
        [right,down].forEach(b=>{ if(!b) return;
          c.strokeStyle='rgba(45,212,191,0.25)'; c.lineWidth=2;
          c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y); c.stroke();
          const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
          drawValenceElectron(c,mx,my,5);
        });
      }
      atoms.forEach((a,i)=>{
        if (i===dopantIdx) { c.beginPath(); c.arc(a.x,a.y,24,0,Math.PI*2); c.fillStyle = sym==='P'?'rgba(255,194,51,0.15)':'rgba(255,107,107,0.15)'; c.fill(); drawNucleus(c,a.x,a.y, sym, 18); }
        else drawNucleus(c,a.x,a.y,'Si',16);
      });
    };

    drawLat(this.nAtoms, 4, 'P');
    drawLat(this.pAtoms, 4, 'B');

    // n-type free electron + conduction strip hint
    c.strokeStyle='rgba(255,194,51,0.2)'; c.setLineDash([4,4]);
    c.beginPath(); c.moveTo(W*0.05,86); c.lineTo(W*0.45,86); c.stroke(); c.setLineDash([]);
    label(c, W*0.05, 60, 'conduction band — free electron roams here', { color: COLORS.free, size: 11 });
    drawFreeElectron(c, this.freeE.x, this.freeE.y, 9);
    // line from P's 5th electron
    c.strokeStyle='rgba(255,194,51,0.4)'; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(this.nAtoms[4].x, this.nAtoms[4].y-20); c.lineTo(this.freeE.x, this.freeE.y+9); c.stroke(); c.setLineDash([]);

    // p-type hole
    drawHole(c, this.hole.x, this.hole.y, 9);
    label(c, this.hole.x+12, this.hole.y-6, 'hole', { color: COLORS.hole, size: 11 });

    callout(c, W*0.04, H-110, W*0.42-W*0.04,
      'n-type: P donates the 5th electron',
      'Phosphorus has 5 valence electrons. 4 fill bonds; the 5th has nowhere to bond → it becomes a free electron (the majority carrier). The lattice still has 8 per atom.');
    callout(c, W*0.54, H-110, W*0.42-W*0.04,
      'p-type: B leaves a hole',
      'Boron has only 3 valence electrons → one bond cannot form → a hole. Holes are the majority carriers (effectively +). Hole motion = electrons hopping the other way.');
  },
});


/* ---------------------------------------------------------------------
   SCENE 5 — THE P-N JUNCTION (no voltage)
   p-side (holes) joined to n-side (free electrons). At the seam they
   recombine, forming an insulating depletion region. Bulk stays full.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '5. The P-N Junction',
  sub: 'Join p and n: carriers cancel only at the seam, making a wall.',
  what: 'p-type (left, full of holes) joined to n-type (right, full of free electrons). At the boundary, electrons and holes meet and <span class="term" data-t="recombination">recombine</span>, leaving a carrier-free <span class="term" data-t="depletion region">depletion region</span>.',
  why: 'Cancellation is LOCAL — only carriers near the seam recombine. Once a thin insulating wall forms, it blocks further crossing, so both bulk sides stay full. If everything cancelled, it would just be dead silicon.',
  controls: ['transport'],
  // FEATURE 2: bulk sides have carriers, but the junction itself is a
  // carrier-free wall → no current crosses with no voltage applied.
  conduction() { return { road: true, roadWhy: 'lattice connected', band: false, bandWhy: 'depletion region — no carriers' }; },
  setup() {
    this.holes = []; this.electrons = []; this.t = 0; this.depletion = 30;
    this.build();
  },
  build() {
    this.holes = []; this.electrons = [];
    const mid = W/2;
    for (let i=0;i<70;i++) this.holes.push({ x: rand(40, mid-this.depletion), y: rand(70, H-90), vx: rand(-10,10), vy: rand(-10,10) });
    for (let i=0;i<70;i++) this.electrons.push({ x: rand(mid+this.depletion, W-40), y: rand(70, H-90), vx: rand(-10,10), vy: rand(-10,10) });
  },
  update(dt) {
    if (this._w !== W) { this._w = W; this.build(); }
    this.t += dt;
    const mid = W/2;
    const jitter = (p) => {
      p.x += p.vx*dt*4; p.y += p.vy*dt*4;
      if (Math.random()<0.04){ p.vx=rand(-10,10); p.vy=rand(-10,10);}
      p.y = clamp(p.y,70,H-90);
    };
    // holes confined to left bulk, electrons to right bulk
    this.holes.forEach(p=>{ jitter(p); p.x = clamp(p.x, 40, mid-this.depletion); });
    this.electrons.forEach(p=>{ jitter(p); p.x = clamp(p.x, mid+this.depletion, W-40); });
    // initial recombination growing the depletion region up to a limit
    if (this.depletion < 46 && Math.random()<0.6*dt && this.holes.length>40) {
      this.holes.pop(); this.electrons.pop();
      this.depletion += 2;
      logEvent('⚡ Recombination at the seam: one electron + one hole cancelled → wall grows.');
    }
  },
  draw(c) {
    const mid = W/2;
    // region tints
    c.fillStyle='rgba(255,107,107,0.05)'; c.fillRect(20,40,mid-20-this.depletion,H-60);
    c.fillStyle='rgba(255,194,51,0.05)'; c.fillRect(mid+this.depletion,40,W-40-(mid+this.depletion),H-60);
    // depletion region shading
    c.fillStyle='rgba(124,156,255,0.10)';
    c.fillRect(mid-this.depletion,40,this.depletion*2,H-60);
    c.strokeStyle='rgba(124,156,255,0.4)'; c.setLineDash([5,4]);
    c.strokeRect(mid-this.depletion,40,this.depletion*2,H-60); c.setLineDash([]);

    label(c, 30, 46, 'p-side (holes = majority)', { color: COLORS.hole, weight:'700' });
    label(c, W-30, 46, 'n-side (free electrons = majority)', { color: COLORS.free, weight:'700', align:'right' });
    label(c, mid, 46, 'depletion region', { color:'#bcd0ff', align:'center', size:12, weight:'700' });
    label(c, mid, 64, 'carriers cancelled → insulating wall', { color:'#bcd0ff', align:'center', size:11 });

    this.holes.forEach(p=>drawHole(c,p.x,p.y,8));
    this.electrons.forEach(p=>drawFreeElectron(c,p.x,p.y,8));

    callout(c, mid-170, H-86, 340,
      'Cancellation is LOCAL, not total',
      'Only carriers right at the seam recombine. The resulting wall blocks the rest, so both bulk sides stay full. Voltage (next scene) controls how wide this wall is.');
  },
});


/* ---------------------------------------------------------------------
   SCENE 6 — THE DIODE (voltage + polarity). The centerpiece.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '6. The Diode (one-way valve)',
  sub: 'Voltage direction decides: conductor or insulator.',
  what: 'The same p-n junction, now wired to a battery. Use the voltage slider and the flip button. Field arrows show the push on carriers; the depletion wall and the current respond.',
  why: '<span class="term" data-t="forward bias">Forward bias</span> (+ to p) pushes carriers toward the junction → wall shrinks → current flows. <span class="term" data-t="reverse bias">Reverse bias</span> (+ to n) pulls them apart → wall widens → no current. Direction alone flips conductor ↔ insulator. Past the <span class="term" data-t="breakdown voltage">breakdown voltage</span> in reverse, the junction is destroyed.',
  controls: ['voltage', 'polarity', 'reset', 'transport'],
  breakdownV: -10,   // FEATURE 3a: reverse breakdown threshold (volts)
  setup() {
    this.t=0; this.flow=[]; this.build(); this.ivTrace=[];
    this.destroyed=false; this.burst=[]; this.destroyT=0; this._prevBias=0;
  },
  resetDevice() { this.setup(); },
  // FEATURE 2: forward = wall shrinks & carriers cross; reverse = wall widens.
  conduction() {
    if (this.destroyed) return { road: false, roadWhy: 'junction destroyed', band: false, bandWhy: 'no working device' };
    const v = effVoltage();
    if (v > 0.2) return { road: true, roadWhy: 'junction connected', band: true, bandWhy: 'wall shrunk, carriers cross' };
    if (v < -0.2) return { road: true, roadWhy: 'junction connected', band: false, bandWhy: 'wall widened, no carriers cross' };
    return { road: true, roadWhy: 'junction connected', band: false, bandWhy: 'equilibrium wall blocks' };
  },
  build(){
    const mid=W/2; this.holes=[]; this.electrons=[];
    for(let i=0;i<60;i++) this.holes.push({x:rand(40,mid-20),y:rand(70,H-160),vy:rand(-6,6)});
    for(let i=0;i<60;i++) this.electrons.push({x:rand(mid+20,W-40),y:rand(70,H-160),vy:rand(-6,6)});
  },
  update(dt){
    if(this._w!==W){this._w=W;this.build();}
    this.t+=dt;
    const v = effVoltage();              // + = forward, − = reverse
    const forward = v > 0.2;
    const reverse = v < -0.2;

    // ---- FEATURE 3a: REVERSE BREAKDOWN -------------------------------
    // Once destroyed, freeze in the smoking state until Reset.
    if(this.destroyed){
      this.destroyT += dt;
      this.burst.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt; });
      this.burst = this.burst.filter(b=>b.life>0);
      return;
    }
    if(reverse && v <= this.breakdownV){
      this.destroyed = true; this.destroyT = 0;
      // a sudden surge of carriers smashing across the junction
      for(let i=0;i<40;i++) this.burst.push({ x:W/2, y:rand(70,H-160), vx:rand(-260,260), vy:rand(-120,120), life:0.8 });
      logEvent(`💥 Reverse voltage hit ${this.breakdownV} V → breakdown! Carriers ripped across → diode DESTROYED.`);
    }

    // ---- FEATURE 1: predict-first when bias direction changes --------
    const biasSign = forward ? 1 : reverse ? -1 : 0;
    if(biasSign !== 0 && biasSign !== this._prevBias && this._prevBias !== undefined){
      const fwd = biasSign === 1;
      PREDICT.askSequence([
        {
          tag: 'Diode bias',
          question: fwd
            ? 'With the + terminal on the p-side, will the diode conduct or block?'
            : 'With the + terminal on the n-side (reverse), will the diode conduct or block?',
          options: ['Conduct (ON)', 'Block (OFF)'],
          correct: fwd ? 0 : 1,
          explain: fwd
            ? 'Forward bias pushes carriers toward the junction → depletion wall shrinks → current flows.'
            : 'Reverse bias pulls carriers away → wall widens → no current.',
        },
        {
          tag: 'Depletion wall',
          question: 'Which way will the depletion region move?',
          options: ['Shrink', 'Widen', 'Stay the same'],
          correct: fwd ? 0 : 1,
          explain: fwd
            ? 'Forward bias drives carriers INTO the junction, so the insulating wall shrinks.'
            : 'Reverse bias pulls carriers AWAY from the junction, so the wall widens.',
        },
      ]);
    }
    if(biasSign !== 0) this._prevBias = biasSign;

    // depletion width: narrow in forward, wide in reverse
    const baseW = 36;
    this.depW = clamp(baseW - v*7, 8, 90);
    const mid=W/2;
    // carriers drift toward (forward) or away (reverse) from junction
    const push = v * 24;
    this.holes.forEach(p=>{
      p.y += p.vy*dt*3; p.y=clamp(p.y,70,H-160);
      p.x += push*dt; // +v pushes holes right (toward junction)
      p.x = clamp(p.x, 40, mid-this.depW);
    });
    this.electrons.forEach(p=>{
      p.y += p.vy*dt*3; p.y=clamp(p.y,70,H-160);
      p.x -= push*dt; // +v pushes electrons left (toward junction)
      p.x = clamp(p.x, mid+this.depW, W-40);
    });
    // current flow stream (only in forward bias)
    if(forward && Math.random()< (v/5)*0.9){
      this.flow.push({ p: 0, lane: rand(80,H-170) });
      if(Math.random()<0.3) logEvent('🔌 Forward bias: carriers crossing the junction — current flows.');
    }
    if(reverse && Math.random()<0.01) logEvent('🚫 Reverse bias: wall widened, carriers pulled apart — no current.');
    this.flow.forEach(f=> f.p += dt*0.4*Math.abs(v));
    this.flow = this.flow.filter(f=>f.p<1);

    // record IV point
    const current = forward ? Math.max(0,(v-0.6))*1.8 : (v<-0.2? -0.02: 0);
    this.curCurrent = current;
  },
  draw(c){
    const mid=W/2; const v=effVoltage();
    const forward=v>0.2, reverse=v<-0.2;
    const devTop=60, devBot=H-150;
    // device body
    c.fillStyle='rgba(255,107,107,0.05)'; c.fillRect(40,devTop,mid-40-this.depW,devBot-devTop);
    c.fillStyle='rgba(255,194,51,0.05)'; c.fillRect(mid+this.depW,devTop,W-40-(mid+this.depW),devBot-devTop);
    c.fillStyle='rgba(124,156,255,0.10)'; c.fillRect(mid-this.depW,devTop,this.depW*2,devBot-devTop);
    c.strokeStyle='rgba(124,156,255,0.4)'; c.setLineDash([5,4]); c.strokeRect(mid-this.depW,devTop,this.depW*2,devBot-devTop); c.setLineDash([]);

    label(c,46,devTop+4,'p-side',{color:COLORS.hole,weight:'700'});
    label(c,W-46,devTop+4,'n-side',{color:COLORS.free,weight:'700',align:'right'});

    // field arrows across the material (faint)
    if(Math.abs(v)>0.2){
      const dir = forward? 1 : -1; // forward field pushes holes right
      for(let yy=devTop+30; yy<devBot; yy+=46)
        for(let xx=90; xx<W-90; xx+=90)
          drawFieldArrow(c, xx, yy, dir, 20);
      label(c, W/2, devBot+6, forward?'electric field pushes carriers TOWARD the junction':'electric field pulls carriers AWAY from the junction', {align:'center', color:COLORS.field, size:11});
    }

    this.holes.forEach(p=>drawHole(c,p.x,p.y,7));
    this.electrons.forEach(p=>drawFreeElectron(c,p.x,p.y,7));

    // flowing current particles (forward only)
    if(forward) this.flow.forEach(f=>{ const x=lerp(60,W-60,f.p); drawFreeElectron(c,x,f.lane,7); });

    // big state label
    const state = forward? 'FORWARD BIAS → wall shrinks → CONDUCTS (ON)'
                : reverse? 'REVERSE BIAS → wall widens → INSULATES (OFF)'
                : 'ZERO BIAS → equilibrium wall → no net current';
    label(c, W/2, devTop-26, state, {align:'center', size:15, weight:'700',
      color: forward? '#7bdf7b' : reverse? '#df7b7b' : COLORS.dim,
      bg:'rgba(10,16,28,0.7)'});

    // electron-flow vs conventional-current arrows
    drawDualCurrentArrows(c, 60, devBot+30, W-120, forward);

    // FEATURE 3a: warn as we approach reverse breakdown
    if(reverse && v <= this.breakdownV + 2 && !this.destroyed){
      label(c, W/2, devTop-48, `⚠ Approaching breakdown voltage (${this.breakdownV} V)`, {align:'center', size:12, weight:'700', color:'#ffb454'});
    }

    // ---- IV curve mini-graph ----
    this.drawIV(c);

    // FEATURE 3a: the breakdown surge + destroyed overlay (drawn on top)
    if(this.destroyed){
      c.save(); c.fillStyle=COLORS.free;
      this.burst.forEach(b=>{ c.globalAlpha=clamp(b.life,0,1); drawFreeElectron(c,b.x,b.y,7); });
      c.restore();
      drawDestroyed(c, this.destroyT, '💨 Smoke — diode destroyed');
    }
  },
  drawIV(c){
    const gx=W-250, gy=H-138, gw=220, gh=120;
    c.fillStyle='rgba(20,26,38,0.9)'; c.strokeStyle='#33405e'; roundRect(c,gx,gy,gw,gh,8); c.fill(); c.stroke();
    label(c,gx+10,gy+6,'Diode I–V curve',{size:12,weight:'700',color:'#bcd0ff'});
    // origin shifted right so the extended reverse range (to −12 V) fits
    const ox=gx+gw*0.66, oy=gy+gh*0.55;
    const vToX=(vv)=> ox + (vv>=0 ? (vv/5)*(gw*0.30) : (vv/12)*(gw*0.58));
    const iToY=(i)=> oy - i*((gh*0.4)/4);
    // axes
    c.strokeStyle='#46506a'; c.lineWidth=1;
    c.beginPath(); c.moveTo(gx+12,oy); c.lineTo(gx+gw-12,oy); c.stroke();
    c.beginPath(); c.moveTo(ox,gy+22); c.lineTo(ox,gy+gh-10); c.stroke();
    label(c,gx+gw-12,oy+2,'V',{size:10,color:COLORS.dim,align:'right'});
    label(c,ox+4,gy+22,'I',{size:10,color:COLORS.dim});
    // FEATURE 3a: mark the breakdown voltage with a dashed red line
    const bx=vToX(this.breakdownV);
    c.strokeStyle='rgba(223,123,123,0.7)'; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(bx,gy+22); c.lineTo(bx,gy+gh-10); c.stroke(); c.setLineDash([]);
    label(c,bx,gy+gh-12,'breakdown',{size:9,color:'#df8b8b',align:'center'});
    // diode curve: ~0 below 0.6 V, sharp rise forward; breakdown plunge in reverse
    const ivAt=(vv)=> vv>0.6? Math.min((vv-0.6)*1.6,4)
                     : vv<=this.breakdownV? -4
                     : vv<-0.2? -0.15:0;
    c.strokeStyle=COLORS.free; c.lineWidth=2; c.beginPath();
    for(let vv=-12; vv<=5; vv+=0.1){
      const x=vToX(vv), y=iToY(ivAt(vv));
      vv===-12? c.moveTo(x,y):c.lineTo(x,y);
    }
    c.stroke();
    // current operating point
    const v=effVoltage();
    c.fillStyle=this.destroyed?'#df6b6b':'#fff';
    c.beginPath(); c.arc(vToX(clamp(v,-12,5)),iToY(ivAt(v)),4,0,Math.PI*2); c.fill();
  },
});


/* ---------------------------------------------------------------------
   SCENE 7 — THE LED (the payoff). Full circuit loop + photon emission.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '7. The LED',
  sub: 'A forward-biased diode that turns the battery\'s energy into light.',
  what: 'A forward-biased diode wired in a full loop to a battery with a <span class="term" data-t="current-limiting resistor">resistor</span>. Follow one electron: it enters the n-side at high energy, drifts to the junction, drops into a hole, and emits a <span class="term" data-t="photon">photon</span> — light! Pick a <span class="term" data-t="III–V compound">material</span> to change the color.',
  why: 'At the junction each free electron drops from the conduction band into a hole (an instant jump) and releases its extra energy as a <span class="term" data-t="band gap (eV)">photon of energy = the band gap</span>. That energy came from the BATTERY. A bigger gap → bluer photon. Defects steal that energy as heat; no resistor lets the current run away and burn the LED out.',
  // FEATURE 5 material, FEATURE 6/3b resistor, FEATURE 3c crystal quality,
  // FEATURE 4 spotlight. (bandGap slider kept for fine color control.)
  controls: ['material', 'resistor', 'crystalQuality', 'spotlight', 'reset', 'transport'],

  // ---- circuit constants (FEATURE 6, Arduino-style numbers) ----
  V_SUPPLY: 5, V_LED: 2, MAX_SAFE: 20 /*mA*/, BURN_MA: 45 /*mA*/,

  setup(){
    this.couriers=[]; this.photons=[]; this.heats=[]; this.spawnTimer=0; this.t=0;
    this.current=0;          // animated displayed current (mA)
    this.burned=false; this.burnT=0;
    this.spotlightOn=false; this.stepMode=false; this.spotAdvance=0;
    this.buildDefects();
  },
  resetDevice(){
    // keep spotlight/step prefs but clear the destroyed state
    const spot=this.spotlightOn, step=this.stepMode;
    this.setup(); this.spotlightOn=spot; this.stepMode=step;
    logEvent('🔧 LED reset.');
  },

  // FEATURE 2: a powered, forward-biased LED conducts (unless burned out).
  conduction(){
    if(this.burned) return { road:false, roadWhy:'burned out', band:false, bandWhy:'device destroyed' };
    return { road:true, roadWhy:'full circuit loop', band:true, bandWhy:'forward bias, carriers cross' };
  },

  /* ---- FEATURE 6: real-circuit current model -----------------------
     I = (V_supply − V_LED) / R.  With R=330Ω → ~9 mA (safe). With no
     resistor (or R→0) the current runs away and the LED burns out. ---- */
  targetCurrent(){
    if(STATE.resistorOn && STATE.resistorVal > 0){
      return (this.V_SUPPLY - this.V_LED) / STATE.resistorVal * 1000; // mA
    }
    return 999; // no limit → runaway
  },
  runaway(){ return !STATE.resistorOn || STATE.resistorVal <= 0 || this.targetCurrent() > this.BURN_MA; },
  // brightness/spawn level normalised to the safe current (capped at burnout)
  currentLevel(){ return clamp(this.current / this.MAX_SAFE, 0, 1.4); },

  // FEATURE 5: photon color comes from the chosen material.
  photonColor(){ return material().color; },
  colorName(){ return material().colorName; },

  // FEATURE 3c: scatter defect "potholes" near the junction/p-side.
  buildDefects(){
    this.defects=[];
    const n = Math.round(STATE.crystalQuality * 10);
    for(let i=0;i<n;i++) this.defects.push({ x: lerp(W*0.5, W*0.68, Math.random()), y: 120 + rand(-10,26) });
  },

  update(dt){
    this.t+=dt;
    if(STATE.crystalQuality !== this._cq){ this._cq=STATE.crystalQuality; this.buildDefects(); }

    // ---- FEATURE 3b: animate current toward target; detect burnout ----
    if(!this.burned){
      const tgt=this.targetCurrent();
      this.current += (Math.min(tgt, 300) - this.current) * Math.min(1, dt*2.5);
      if(this.runaway()) this.current += dt*55;          // keeps climbing — runaway
      if(this.current > this.BURN_MA){
        this.burned=true; this.burnT=0;
        logEvent('💥 No current limit → current ran away past MAX SAFE → LED BURNED OUT.');
      }
    } else { this.burnT+=dt; }

    // photons & heat always fade out (even while burned)
    this.photons.forEach(p=>{p.life-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt;});
    this.photons=this.photons.filter(p=>p.life>0);
    this.heats.forEach(h=>h.life-=dt);
    this.heats=this.heats.filter(h=>h.life>0);
    if(this.burned){ this.couriers=[]; return; }

    // ---- spawn couriers at a rate set by the current ----
    const cur=this.currentLevel();
    this.spawnTimer += dt;
    const interval = lerp(1.1, 0.16, clamp(cur,0,1));
    if(cur>0.02 && this.spawnTimer > interval){
      this.spawnTimer = 0;
      this.couriers.push({ stageIndex:0, p:0, energy:'high', jitter:rand(-6,6) });
    }
    // FEATURE 4: ensure exactly one spotlight courier exists when ON
    if(this.spotlightOn && !this.couriers.some(e=>e.spot)){
      this.couriers.push({ stageIndex:0, p:0, energy:'high', jitter:0, spot:true });
    }

    for(const e of this.couriers) this.advance(e, dt);
    this.couriers = this.couriers.filter(e=>!e.done);
  },

  advance(e, dt){
    const yTop=120, yBot=H-70;
    // FEATURE 4: the spotlighted electron can be stepped one stage at a time.
    let step = lerp(0.12, 0.5, clamp(this.currentLevel(),0,1)) * dt;
    if(e.spot && this.stepMode){
      if(this.spotAdvance > 0){ step = 0.9 * dt * 4; }  // advancing one stage
      else step = 0;                                    // frozen between steps
    }
    const before = e.stageIndex;
    e.p += step;
    switch(e.stageIndex){
      case 0: // enter n-side from wire (high energy, amber)
        e.x = lerp(70, W*0.32, e.p); e.y=yTop + e.jitter*Math.sin(this.t*5);
        if(e.p>=1){ e.stageIndex=1; e.p=0; }
        break;
      case 1: // drift through n-side toward the junction
        e.x = lerp(W*0.32, W*0.5, e.p); e.y=yTop + Math.sin(this.t*6+e.jitter)*6;
        if(e.p>=1){ e.stageIndex=2; e.p=0;
          // THE KEY EVENT: recombination. Photon — or HEAT at a defect.
          this.recombine(e, W*0.5, yTop);
        }
        break;
      case 2: // low-energy valence electron, hop hole-to-hole in p-side
        e.energy='low';
        e.x = lerp(W*0.5, W*0.68, e.p);
        e.y = yTop + 30 + Math.abs(Math.sin(e.p*Math.PI*5))*-18;
        if(e.p>=1){ e.stageIndex=3; e.p=0;
          if(!e.spot) logEvent('🕳️ Electron exited p-side into the wire → left a fresh hole (device never clogs).'); }
        break;
      case 3: // travel through p-wire to the battery
        e.x = lerp(W*0.68, W-70, e.p); e.y=yTop;
        if(e.p>=1){ e.stageIndex=4; e.p=0; }
        break;
      case 4: // around through the battery, re-energized, back to start
        e.x = lerp(W-70, 70, e.p); e.y = lerp(yTop, yBot, Math.sin(e.p*Math.PI));
        if(e.p>=0.5 && !e.recharged){ e.recharged=true; e.energy='high';
          if(!e.spot) logEvent('🔋 Battery re-energized the electron — round trip complete.'); }
        if(e.p>=1){ if(e.spot){ e.stageIndex=0; e.p=0; e.recharged=false; } else e.done=true; }
        break;
    }
    // consume one "stage step" once a boundary is crossed
    if(e.spot && this.stepMode && this.spotAdvance>0 && e.stageIndex!==before) this.spotAdvance=0;
  },

  // FEATURE 3c: emit a photon, OR heat if this recombination hits a defect.
  recombine(e, x, y){
    // spotlight courier always shows the clean photon story
    const hitsDefect = !e.spot && Math.random() < STATE.crystalQuality;
    if(hitsDefect){
      this.heats.push({ x, y, life:0.9 });
      if(Math.random()<0.5) logEvent('🔥 Recombined at a DEFECT → energy released as HEAT, not light.');
    } else {
      const color=this.photonColor();
      const a=rand(-Math.PI*0.75,-Math.PI*0.25);
      this.photons.push({x,y,vx:Math.cos(a)*120,vy:Math.sin(a)*120,life:1.1,color,visible:material().visible});
      if(e.spot) logEvent(`✨ Spotlight electron dropped into a hole → photon emitted (energy = ${material().gapEV} eV = the band gap).`);
      else if(Math.random()<0.6) logEvent(`⚡ Recombination → ${this.colorName()} photon. Energy released = band gap (${material().gapEV} eV).`);
    }
  },

  // FEATURE 4: spotlight controls (wired from addSpotlightControls)
  toggleSpotlight(){
    this.spotlightOn=!this.spotlightOn;
    this.stepMode=this.spotlightOn;          // spotlight implies freeze-frame stepping
    if(!this.spotlightOn){ this.couriers.forEach(e=>e.spot=false); }
    logEvent(this.spotlightOn?'🔦 Spotlight ON — tracking one electron around the loop (use ⏭ Step).':'🔦 Spotlight OFF.');
    return this.spotlightOn;
  },
  spotlightStep(){ this.spotAdvance=1; },

  draw(c){
    const yTop=120, yBot=H-70;
    const dim = this.spotlightOn ? 0.2 : 1;   // FEATURE 4: dim everyone but the star

    // ---- circuit wire loop ----
    c.globalAlpha=dim;
    c.strokeStyle=COLORS.wire; c.lineWidth=3;
    c.beginPath();
    c.moveTo(70,yTop); c.lineTo(W-70,yTop);
    c.lineTo(W-70,yBot); c.lineTo(70,yBot);
    c.lineTo(70,yTop);
    c.stroke();
    c.globalAlpha=1;

    // ---- FEATURE 6: series resistor drawn on the bottom wire ----
    this.drawResistor(c, W*0.5, yBot);

    // ---- device region along the top ----
    c.globalAlpha=dim;
    c.lineWidth=14;
    c.strokeStyle='rgba(255,194,51,0.22)'; c.beginPath(); c.moveTo(W*0.32,yTop); c.lineTo(W*0.5,yTop); c.stroke();
    c.strokeStyle='rgba(255,107,107,0.22)'; c.beginPath(); c.moveTo(W*0.5,yTop); c.lineTo(W*0.68,yTop); c.stroke();
    label(c,W*0.41,yTop-44,'n-side',{align:'center',color:COLORS.free,weight:'700'});
    label(c,W*0.59,yTop-44,'p-side',{align:'center',color:COLORS.hole,weight:'700'});
    c.strokeStyle='#bcd0ff'; c.setLineDash([4,3]); c.beginPath(); c.moveTo(W*0.5,yTop-18); c.lineTo(W*0.5,yTop+18); c.stroke(); c.setLineDash([]);
    label(c,W*0.5,yTop-72,'⚡ junction: electrons drop into holes here → LIGHT',{align:'center',color:'#fff7d6',size:12,weight:'700'});
    for(let i=0;i<8;i++){ const x=lerp(W*0.5,W*0.68,(i+0.5)/8); drawHole(c,x,yTop+ (i%2?14:-2),6); }
    c.globalAlpha=1;

    // FEATURE 3c: defect "potholes"
    this.defects.forEach(d=>{
      c.fillStyle='rgba(120,70,40,0.85)'; c.strokeStyle='#a05a2c'; c.lineWidth=1.5;
      c.beginPath(); c.arc(d.x,d.y,5,0,Math.PI*2); c.fill(); c.stroke();
    });
    if(this.defects.length){ label(c, W*0.59, yTop+52, `⚠ ${this.defects.length} defects: some energy → heat`, {align:'center', color:'#c98a5a', size:10}); }

    // battery
    c.globalAlpha=dim; this.drawBattery(c, W-70, yBot); c.globalAlpha=1;

    // ---- couriers (spotlight star at full brightness, others dimmed) ----
    for(const e of this.couriers){
      if(this.spotlightOn && e.spot){
        // halo + short trailing path
        c.save(); const halo=c.createRadialGradient(e.x,e.y,2,e.x,e.y,22);
        halo.addColorStop(0,'rgba(255,255,255,0.5)'); halo.addColorStop(1,'rgba(255,255,255,0)');
        c.fillStyle=halo; c.beginPath(); c.arc(e.x,e.y,22,0,Math.PI*2); c.fill(); c.restore();
        if(e.energy==='high') drawFreeElectron(c,e.x,e.y,9); else drawValenceElectron(c,e.x,e.y,8);
      } else {
        c.globalAlpha=dim;
        if(e.energy==='high') drawFreeElectron(c,e.x,e.y,8); else drawValenceElectron(c,e.x,e.y,7);
        c.globalAlpha=1;
      }
    }

    // photons (faint/dark for invisible infrared materials) + heat glyphs
    this.photons.forEach(p=>{
      if(p.visible) drawPhoton(c,p.x,p.y, 1+(1.1-p.life), p.color);
      else drawPhoton(c,p.x,p.y, 0.8, 'rgba(120,90,90,0.5)');  // infrared = invisible
    });
    this.heats.forEach(h=>drawHeat(c,h.x,h.y, 1+(0.9-h.life), clamp(h.life,0,1)));

    // ---- brightness glow ∝ current, reduced by defects & invisibility ----
    const cur=this.currentLevel();
    const visK = material().visible ? 1 : 0.12;
    const defK = 1 - STATE.crystalQuality*0.85;
    const bright = clamp(cur,0,1.4) * visK * defK;
    const glowR = 50 + bright*130;
    const glow = c.createRadialGradient(W*0.5,yTop,4, W*0.5,yTop, glowR);
    glow.addColorStop(0,`rgba(255,247,214,${0.12+bright*0.5})`);
    glow.addColorStop(1,'rgba(255,247,214,0)');
    c.fillStyle=glow; c.beginPath(); c.arc(W*0.5,yTop,glowR,0,Math.PI*2); c.fill();

    // dual current arrows along bottom wire
    c.globalAlpha=dim; drawDualCurrentArrows(c, 90, yBot+24, W-180, !this.burned); c.globalAlpha=1;

    // ---- FEATURE 6: live current gauge + MAX SAFE line ----
    this.drawCurrentGauge(c);
    // ---- FEATURE 6: tiny schematic inset ----
    this.drawSchematic(c, 70, yBot+70);
    // ---- FEATURE 4: energy meter for the spotlighted electron ----
    if(this.spotlightOn) this.drawEnergyMeter(c);

    // captions
    const m=material();
    callout(c, W*0.30, yBot+60, 330,
      'The light\'s energy comes from the BATTERY',
      `The electron is a courier: the battery loads it, it carries the energy around the loop, and delivers it as a photon at the junction. More current = more photons = brighter. ${m.name}: gap ${m.gapEV} eV → ${m.colorName} light.`);

    // FEATURE 3b/3c failure overlays
    if(this.burned) drawDestroyed(c, this.burnT, '💨 Smoke — LED burned out');
  },

  /* FEATURE 6: a little zig-zag resistor symbol on the return wire. */
  drawResistor(c, x, y){
    const on=STATE.resistorOn, w=70;
    c.save(); c.lineWidth=3; c.strokeStyle = on? '#c9a86a' : '#5a4a3a';
    c.beginPath();
    c.moveTo(x-w/2, y);
    for(let i=0;i<=6;i++){ const px=x-w/2 + (i/6)*w; const py = y + (i%2?-8:8); i===0?c.lineTo(px,y):c.lineTo(px,py); }
    c.lineTo(x+w/2, y);
    c.stroke(); c.restore();
    label(c, x, y+12, on? `${STATE.resistorVal} Ω resistor` : 'NO resistor (danger!)', {align:'center', size:11, color: on?'#c9a86a':'#df6b6b', weight:'700'});
  },

  /* FEATURE 6/3b: horizontal current gauge with a red MAX SAFE marker. */
  drawCurrentGauge(c){
    const gx=W-250, gy=22, gw=220, gh=44;
    c.fillStyle='rgba(20,26,38,0.9)'; c.strokeStyle='#33405e'; roundRect(c,gx,gy,gw,gh,8); c.fill(); c.stroke();
    const full=this.BURN_MA, frac=clamp(this.current/full,0,1);
    const barX=gx+12, barW=gw-24, barY=gy+24, barH=10;
    c.fillStyle='#10151f'; roundRect(c,barX,barY,barW,barH,5); c.fill();
    const over=this.current>this.MAX_SAFE;
    c.fillStyle= this.burned? '#df3b3b' : over? '#df8b3b' : '#5fbf5f';
    roundRect(c,barX,barY,barW*frac,barH,5); c.fill();
    // MAX SAFE marker
    const safeX=barX+barW*(this.MAX_SAFE/full);
    c.strokeStyle='#df6b6b'; c.lineWidth=2; c.beginPath(); c.moveTo(safeX,barY-4); c.lineTo(safeX,barY+barH+4); c.stroke();
    label(c, safeX, gy+gh-12, 'MAX SAFE 20mA', {align:'center', size:9, color:'#df8b8b'});
    label(c, gx+10, gy+5, `Current: ${this.burned?'∞ (burned)':this.current.toFixed(1)+' mA'}`, {size:12, weight:'700', color: over?'#ffb454':'#bcd0ff'});
  },

  /* FEATURE 6: schematic inset (battery → resistor → LED → back). */
  drawSchematic(c, x, y){
    const w=190, h=78;
    c.fillStyle='rgba(20,26,38,0.9)'; c.strokeStyle='#33405e'; roundRect(c,x,y,w,h,8); c.fill(); c.stroke();
    label(c, x+10, y+6, 'Real circuit', {size:11, weight:'700', color:'#bcd0ff'});
    const lx=x+18, rx=x+w-18, ty=y+34, by=y+62;
    c.strokeStyle=COLORS.wire; c.lineWidth=2;
    c.strokeRect(lx, ty, rx-lx, by-ty);
    // battery (left side)
    label(c, lx, ty-2, '🔋', {size:13});
    // resistor (top) zig-zag
    c.strokeStyle=STATE.resistorOn?'#c9a86a':'#5a4a3a'; c.beginPath();
    const r0=lx+40, r1=lx+90;
    c.moveTo(r0,ty); for(let i=0;i<=5;i++){const px=r0+(i/5)*(r1-r0);c.lineTo(px, ty+(i%2?-5:5));} c.lineTo(r1,ty);
    c.stroke();
    label(c, (r0+r1)/2, ty-14, STATE.resistorOn?`${STATE.resistorVal}Ω`:'none', {align:'center', size:9, color:STATE.resistorOn?'#c9a86a':'#df6b6b'});
    // LED (right) triangle
    c.fillStyle=material().visible?material().color:'#7a1f1f';
    c.beginPath(); c.moveTo(rx-6,ty-6); c.lineTo(rx-6,ty+6); c.lineTo(rx+6,ty); c.closePath(); c.fill();
    label(c, rx, ty-14, 'LED', {align:'center', size:9, color:'#cfd'});
    // conventional current arrow (+ → −) clockwise along the top
    c.strokeStyle=COLORS.hole; c.fillStyle=COLORS.hole; c.lineWidth=1.5;
    const ax=lx+18; c.beginPath(); c.moveTo(ax,ty); c.lineTo(ax+10,ty); c.stroke();
    c.beginPath(); c.moveTo(ax+10,ty); c.lineTo(ax+5,ty-4); c.lineTo(ax+5,ty+4); c.closePath(); c.fill();
    label(c, x+10, y+h-14, '5V supply • ~2V LED drop • ~9 mA (safe)', {size:9, color:COLORS.dim});
  },

  /* FEATURE 4: vertical energy meter tracking the spotlighted electron.
     The DROP at the junction equals the band gap = the photon's energy. */
  drawEnergyMeter(c){
    const spot=this.couriers.find(e=>e.spot);
    const mx=W-46, my=80, mh=H-200, mw=20;
    // frame
    c.fillStyle='rgba(20,26,38,0.92)'; c.strokeStyle='#33405e';
    roundRect(c,mx-mw/2-2,my-2,mw+4,mh+4,5); c.fill(); c.stroke();
    // band markers: MAX (conduction) at top, LOW (valence) at bottom
    const gapFrac=material().gapFrac;
    const lowY = my + mh*gapFrac;     // valence level sits one gap below max
    // energy level of the spotlight electron
    let level = 1; // 0..1 from bottom... we map energy: high=top, low=lowY
    let stageMsg='—';
    if(spot){
      if(spot.energy==='high'){ level=1; }
      else level=0;  // low
      switch(spot.stageIndex){
        case 4: stageMsg = spot.recharged? 'battery re-energizes it — loop repeats' : 'returning to battery (empty)'; break;
        case 0: stageMsg = 'battery loaded it — energy IN'; break;
        case 1: stageMsg = 'drifting — high energy'; break;
        case 2: stageMsg = 'low energy — hopping hole-to-hole'; break;
        case 3: stageMsg = 'low energy — heading to the wire'; break;
      }
    }
    const fillTop = level>0.5 ? my : lowY;
    const fillBot = my+mh;
    c.fillStyle = level>0.5 ? COLORS.free : COLORS.valence;
    c.fillRect(mx-mw/2, fillTop, mw, fillBot-fillTop);
    // labels for MAX / LOW + the gap = photon energy
    label(c, mx+16, my-2, 'MAX (conduction)', {size:9, color:COLORS.free});
    label(c, mx+16, lowY-6, 'LOW (valence)', {size:9, color:COLORS.valence});
    // the gap span = photon energy
    c.strokeStyle='rgba(255,247,214,0.6)'; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(mx-mw/2-8,my); c.lineTo(mx-mw/2-8,lowY); c.stroke(); c.setLineDash([]);
    label(c, mx-mw/2-12, (my+lowY)/2-6, `gap = ${material().gapEV} eV = photon`, {size:9, color:'#fff7d6', align:'right'});
    label(c, mx, my+mh+14, 'ENERGY', {align:'center', size:10, color:COLORS.dim});
    // current stage caption
    label(c, W*0.5, H-44, `🔦 Spotlight: ${stageMsg}`, {align:'center', size:12, weight:'600', color:'#fff'});
    label(c, W*0.5, H-26, 'The photon\'s energy comes from the battery. The electron is a courier: loaded, delivers light, returns empty, reloads.', {align:'center', size:11, color:COLORS.dim});
  },

  drawBattery(c,x,y){
    c.fillStyle='#1c2230'; c.strokeStyle='#5fbf8f'; c.lineWidth=2;
    roundRect(c,x-26,y-22,52,44,6); c.fill(); c.stroke();
    label(c,x,y-12,'🔋',{align:'center',size:16});
    label(c,x,y+2,'5V',{align:'center',size:10,color:'#8fd0a8'});
    label(c,x-34,y-40,'−',{size:18,color:COLORS.free,weight:'700'});
    label(c,x+24,y-40,'+',{size:18,color:COLORS.hole,weight:'700'});
  },
});


/* ---------------------------------------------------------------------
   SCENE 8 — THE TRANSISTOR (MOSFET switch).
   --------------------------------------------------------------------- */
SCENES.push({
  title: '8. The Transistor',
  sub: 'A voltage-controlled switch — the heart of every chip.',
  what: 'A MOSFET: a silicon channel between Source and Drain, with a Gate electrode above it separated by a thin insulator. Toggle the gate voltage.',
  why: 'Gate ON: the gate\'s field pulls electrons into the channel → it conducts → a "1". Gate OFF: electrons drain away → channel empty → insulates → a "0". Billions of these switching on/off is how chips compute.',
  controls: ['gate', 'transport'],
  // FEATURE 2: gate ON pulls electrons into the channel (a road + movers);
  // gate OFF empties the channel so there is nothing to carry current.
  conduction(){
    return STATE.gateOn
      ? { road:true, roadWhy:'channel populated', band:true, bandWhy:'gate pulled electrons in' }
      : { road:false, roadWhy:'channel empty — no path', band:false, bandWhy:'no carriers in channel' };
  },
  setup(){ this.channel=[]; this.t=0; this.flow=[]; },
  update(dt){
    this.t+=dt;
    const want = STATE.gateOn ? 60 : 0;
    // fill or drain the channel toward target population
    if(this.channel.length < want && Math.random()<0.5){
      this.channel.push({x:rand(W*0.3,W*0.7),y:rand(H*0.5,H*0.62),vx:rand(-20,20)});
    } else if(this.channel.length > want && Math.random()<0.5){
      this.channel.pop();
    }
    this.channel.forEach(e=>{ e.x+=e.vx*dt; if(e.x<W*0.28||e.x>W*0.72)e.vx*=-1; e.y+=rand(-6,6)*dt; e.y=clamp(e.y,H*0.5,H*0.62);});
    // current flow when ON
    if(STATE.gateOn && Math.random()<0.2) this.flow.push({p:0,y:rand(H*0.5,H*0.62)});
    this.flow.forEach(f=>f.p+=dt*0.6); this.flow=this.flow.filter(f=>f.p<1);
    // log state changes
    if(this._last!==STATE.gateOn){ this._last=STATE.gateOn;
      logEvent(STATE.gateOn?'🟢 Gate ON → channel populated → CONDUCTS → represents a "1".'
                          :'🔴 Gate OFF → channel empty → INSULATES → represents a "0".'); }
  },
  draw(c){
    const chY=H*0.56, chH=46;
    // substrate
    c.fillStyle='rgba(124,156,255,0.06)'; c.fillRect(W*0.2,chY-30,W*0.6,160);
    // source & drain blocks
    c.fillStyle='#243352';
    roundRect(c,W*0.2,chY-chH/2,W*0.1,chH,4); c.fill();
    roundRect(c,W*0.7,chY-chH/2,W*0.1,chH,4); c.fill();
    label(c,W*0.25,chY-chH/2-20,'SOURCE',{align:'center',color:COLORS.dim,size:12,weight:'700'});
    label(c,W*0.75,chY-chH/2-20,'DRAIN',{align:'center',color:COLORS.dim,size:12,weight:'700'});
    // channel region
    c.fillStyle = STATE.gateOn? 'rgba(255,194,51,0.10)':'rgba(40,48,64,0.5)';
    c.fillRect(W*0.3,chY-chH/2,W*0.4,chH);
    c.strokeStyle='#46506a'; c.strokeRect(W*0.3,chY-chH/2,W*0.4,chH);
    label(c,W*0.5,chY+chH/2+8,'channel',{align:'center',color:COLORS.dim,size:11});

    // thin insulator + gate
    c.fillStyle='#3a2f1a'; c.fillRect(W*0.3,chY-chH/2-10,W*0.4,7);
    label(c,W*0.3-6,chY-chH/2-12,'insulator',{align:'right',color:'#c9a86a',size:10});
    c.fillStyle = STATE.gateOn? '#2c4a2c':'#4a2c2c';
    c.strokeStyle = STATE.gateOn? '#5fbf5f':'#bf5f5f'; c.lineWidth=2;
    roundRect(c,W*0.36,chY-chH/2-46,W*0.28,30,5); c.fill(); c.stroke();
    label(c,W*0.5,chY-chH/2-40,`GATE  ${STATE.gateOn?'(+V, ON)':'(0V, OFF)'}`,{align:'center',color:'#fff',size:12,weight:'700'});

    // gate field arrows pulling carriers in (when ON)
    if(STATE.gateOn){
      for(let xx=W*0.34; xx<W*0.66; xx+=40){
        c.strokeStyle=COLORS.field; c.fillStyle=COLORS.field; c.lineWidth=1.5;
        c.beginPath(); c.moveTo(xx,chY-chH/2-14); c.lineTo(xx,chY-chH/2-2); c.stroke();
        c.beginPath(); c.moveTo(xx,chY-chH/2-2); c.lineTo(xx-3,chY-chH/2-8); c.lineTo(xx+3,chY-chH/2-8); c.closePath(); c.fill();
      }
      label(c,W*0.5,chY-chH/2-66,'gate field pulls electrons INTO the channel',{align:'center',color:COLORS.field,size:11});
    }

    // channel electrons
    this.channel.forEach(e=>drawFreeElectron(c,e.x,e.y,7));
    // flowing current
    if(STATE.gateOn) this.flow.forEach(f=>drawFreeElectron(c,lerp(W*0.25,W*0.75,f.p),f.y,7));

    // big state
    label(c,W/2,90, STATE.gateOn?'CHANNEL POPULATED → ON → "1"':'CHANNEL EMPTY → OFF → "0"',
      {align:'center',size:18,weight:'700',color:STATE.gateOn?'#7bdf7b':'#df7b7b'});

    callout(c, 60, H-96, 420,
      'This is how chips make 1s and 0s',
      'A small voltage on the gate switches the channel between conducting (1) and insulating (0) — no moving parts. Billions of these transistors switch on and off to compute everything your computer does.');
  },
});


/* ---------------------------------------------------------------------
   FEATURE 7 — SCENE 9 — MAKING WHITE LIGHT (sandbox)
   ---------------------------------------------------------------------
   Two ways to build white light:
     A) RGB additive mixing — red + green + blue emitters overlap; balanced
        intensities read white in the overlap (uses 'lighter' compositing).
     B) Blue LED + yellow phosphor — a blue LED whose photons partly strike
        a phosphor that re-emits a broad spectrum → the sum looks white.
   No conduction() (panel hidden): this scene is about light, not current.
   --------------------------------------------------------------------- */
SCENES.push({
  title: '9. Making White Light',
  sub: 'Why blue was the missing piece — two ways to make white.',
  what: 'A sandbox for making <strong>white light</strong>. <em>Method A:</em> mix red, green and blue emitters additively. <em>Method B:</em> coat a single blue LED with yellow <span class="term" data-t="phosphor">phosphor</span>.',
  why: 'White isn\'t one color — it\'s a balanced mix. Red + Green + Blue light add to white, so blue was the LAST piece needed to unlock all lighting. Alternatively a blue LED + yellow phosphor makes white — and that\'s how most white LED bulbs work.',
  controls: ['whiteLight'],
  // sandbox state lives on the scene object
  method: 'rgb',
  r: 1, g: 1, b: 1, rOn: true, gOn: true, bOn: true, phosphor: true,
  setup(){ this.t = 0; this.photons = []; this.spawn = 0; },
  update(dt){
    this.t += dt;
    if(this.method === 'phosphor'){
      // emit blue photons from the LED; some convert at the phosphor
      this.spawn += dt;
      if(this.spawn > 0.06){ this.spawn = 0;
        this.photons.push({ x: W*0.32, y: H/2 + rand(-30,30), vx: rand(150,210), vy: rand(-30,30), life: 2.4, converted: false });
      }
      const phX = W*0.5;
      this.photons.forEach(p=>{
        p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt;
        // convert at the phosphor layer (if enabled)
        if(this.phosphor && !p.converted && p.x >= phX){ p.converted = true; p.vy += rand(-40,40); }
      });
      this.photons = this.photons.filter(p=>p.life>0 && p.x < W-40);
    }
  },
  draw(c){
    label(c, W/2, 18, this.method==='rgb' ? 'Method A — RGB additive mixing' : 'Method B — blue LED + yellow phosphor',
      {align:'center', size:16, weight:'700', color:'#fff'});
    if(this.method==='rgb') this.drawRGB(c); else this.drawPhosphor(c);
  },
  // ---- Method A ----
  drawRGB(c){
    const cy = H*0.46, R = Math.min(W,H)*0.26;
    // three emitter centers arranged in a triangle
    const pts = [
      { k:'r', col:[255,90,90],  x: W*0.5,        y: cy-R*0.5,  name:'RED'   },
      { k:'g', col:[90,255,120], x: W*0.5-R*0.62, y: cy+R*0.55, name:'GREEN' },
      { k:'b', col:[90,123,255], x: W*0.5+R*0.62, y: cy+R*0.55, name:'BLUE'  },
    ];
    c.save();
    c.globalCompositeOperation = 'lighter'; // ADDITIVE blending
    pts.forEach(p=>{
      if(!this[p.k+'On']) return;
      const a = this[p.k] * 0.9;
      const g = c.createRadialGradient(p.x,p.y,4, p.x,p.y,R);
      g.addColorStop(0,`rgba(${p.col[0]},${p.col[1]},${p.col[2]},${a})`);
      g.addColorStop(1,`rgba(${p.col[0]},${p.col[1]},${p.col[2]},0)`);
      c.fillStyle=g; c.beginPath(); c.arc(p.x,p.y,R,0,Math.PI*2); c.fill();
    });
    c.restore();
    // labels
    pts.forEach(p=> label(c, p.x, p.y - R - 14, `${p.name} ${this[p.k+'On']?(this[p.k]*100|0)+'%':'off'}`, {align:'center', size:11, color:`rgb(${p.col[0]},${p.col[1]},${p.col[2]})`, weight:'700'}));
    const allOn = this.rOn&&this.gOn&&this.bOn;
    const balanced = allOn && Math.abs(this.r-this.g)<0.15 && Math.abs(this.g-this.b)<0.15 && this.r>0.6;
    label(c, W/2, cy+2, balanced?'WHITE':'', {align:'center', size:18, weight:'800', color:'#0a0d12'});
    callout(c, 30, H-104, 380,
      'Red + Green + Blue → White',
      `Light adds, it doesn't subtract: overlapping R, G and B makes white. ${balanced?'Balanced now → the center reads WHITE.':'Turn all three ON near equal intensity to get white.'} Blue was the missing piece — that's why it unlocked all lighting.`);
  },
  // ---- Method B ----
  drawPhosphor(c){
    const cy=H/2;
    // blue LED on the left
    label(c, W*0.32, cy-60, 'blue LED', {align:'center', size:12, color:'#5a7bff', weight:'700'});
    c.fillStyle='#5a7bff'; c.beginPath(); c.arc(W*0.32, cy, 16, 0, Math.PI*2); c.fill();
    // phosphor layer
    if(this.phosphor){
      c.fillStyle='rgba(255,210,90,0.30)'; c.fillRect(W*0.5-10, cy-150, 20, 300);
      c.strokeStyle='rgba(255,210,90,0.8)'; c.strokeRect(W*0.5-10, cy-150, 20, 300);
      label(c, W*0.5, cy-165, 'yellow phosphor', {align:'center', size:11, color:'#ffd25a', weight:'700'});
    }
    // photons: blue before the phosphor, broadened/white after
    this.photons.forEach(p=>{
      const col = p.converted ? '#fff7e6' : '#7a9cff';
      drawPhoton(c, p.x, p.y, p.converted?1.2:0.9, col);
    });
    // output glow on the right
    const white = this.phosphor;
    const g=c.createRadialGradient(W*0.78,cy,6,W*0.78,cy,150);
    const oc = white ? '255,250,235' : '120,150,255';
    g.addColorStop(0,`rgba(${oc},0.5)`); g.addColorStop(1,`rgba(${oc},0)`);
    c.fillStyle=g; c.beginPath(); c.arc(W*0.78,cy,150,0,Math.PI*2); c.fill();
    label(c, W*0.78, cy, white?'WHITE':'BLUE', {align:'center', size:18, weight:'800', color: white?'#0a0d12':'#dbe6ff'});
    callout(c, 30, H-104, 400,
      'Blue LED + yellow phosphor = white',
      `${white?'Some blue photons pass straight through; the rest hit the phosphor and re-emit a broad (yellowish) spectrum. Blue + yellow ≈ white.':'With no phosphor the output is pure blue. Turn the phosphor ON to make white.'} This is how most white LED bulbs work.`);
  },
});


/* =====================================================================
   Shared utilities used by multiple scenes
   ===================================================================== */

// Compute current band geometry (scene 3 needs it outside draw).
function computeBands(gapFrac){
  const x=90, w=W-180, top=40, bottom=H-40;
  const span=bottom-top;
  const cbH=span*0.30, gapH=span*(gapFrac ?? 0.29), vbTop=top+cbH+gapH;
  return { cb:{x,y:top,w,h:cbH}, gap:{x,y:top+cbH,w,h:gapH}, vb:{x,y:vbTop,w,h:bottom-vbTop} };
}

// Draw BOTH the electron-flow arrow and the conventional-current arrow,
// pointing opposite ways, so the difference is unmistakable.
function drawDualCurrentArrows(c, x, y, w, active){
  const alpha = active? 1 : 0.35;
  c.save(); c.globalAlpha=alpha;
  // electron flow: electrons move − → + (here we draw left→right say)
  c.strokeStyle=COLORS.free; c.fillStyle=COLORS.free; c.lineWidth=2;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x+w*0.4, y); c.stroke();
  c.beginPath(); c.moveTo(x+w*0.4,y); c.lineTo(x+w*0.4-8,y-5); c.lineTo(x+w*0.4-8,y+5); c.closePath(); c.fill();
  label(c, x, y-20, 'electron flow  (− → +)', {color:COLORS.free, size:11, weight:'600'});
  // conventional current: + → − (opposite direction)
  c.strokeStyle=COLORS.hole; c.fillStyle=COLORS.hole;
  c.beginPath(); c.moveTo(x+w, y+18); c.lineTo(x+w*0.6, y+18); c.stroke();
  c.beginPath(); c.moveTo(x+w*0.6,y+18); c.lineTo(x+w*0.6+8,y+13); c.lineTo(x+w*0.6+8,y+23); c.closePath(); c.fill();
  label(c, x+w, y-2, 'conventional current  (+ → −)', {color:COLORS.hole, size:11, weight:'600', align:'right'});
  c.restore();
}


/* =====================================================================
   FEATURE 1 — PREDICT-THEN-REVEAL ENGINE
   ---------------------------------------------------------------------
   A small modal state-machine. Any "determinate" event (one whose
   outcome is fixed by physics) calls PREDICT.ask(spec) or
   PREDICT.askSequence([spec, ...]) BEFORE its animation is allowed to
   play. While a card is up the sim is frozen (STATE.predictFreeze). The
   user must click an answer; we then highlight it, unfreeze so the
   animation plays, and show a ✅/❌ banner + explanation with
   "Run again" / "Continue".

   spec = {
     tag:        small label, e.g. "Diode bias"
     question:   string
     options:    [ "Conduct (ON)", "Block (OFF)" ]
     correct:    index of the right option
     explain:    one-sentence reason shown on reveal
     onRunAgain: optional () => void  (replay the animation)
   }
   The scoreboard ("Predictions: x/y correct") is in-memory only and
   resets on reload (no localStorage), per spec.
   ===================================================================== */
const PREDICT = {
  enabled: true,
  score: { correct: 0, total: 0 },
  active: false,
  queue: [],
  spec: null,
  firedKeys: {},          // dedupe one-shot triggers (e.g. temp thresholds)

  overlay: () => document.getElementById('predictOverlay'),
  card:    () => document.getElementById('predictCard'),

  // Has this one-shot trigger already fired this session?
  once(key) {
    if (this.firedKeys[key]) return false;
    this.firedKeys[key] = true;
    return true;
  },

  ask(spec) { this.askSequence([spec]); },

  // Ask one or more predictions back-to-back (e.g. diode: conduct? + wall?).
  askSequence(specs) {
    // If predict-first is OFF, behave like the original sim (run immediately).
    if (!STATE.predictFirst) return;
    if (this.active) return;                // don't stack cards
    this.queue = specs.slice();
    this.active = true;
    STATE.predictFreeze = true;             // pause the animation
    document.body.classList.add('predicting'); // block the controls until done
    this._next();
  },

  _next() {
    if (this.queue.length === 0) { this._finish(); return; }
    this.spec = this.queue.shift();
    this._renderQuestion();
    this.overlay().classList.remove('hidden', 'revealed');
  },

  _renderQuestion() {
    const s = this.spec;
    const card = this.card();
    card.innerHTML = '';
    const tag = el('div', 'predict-tag', s.tag || 'Predict first');
    const q = el('div', 'predict-q', s.question);
    const opts = el('div', 'predict-opts');
    s.options.forEach((label, i) => {
      const b = el('button', 'predict-opt', label);
      b.onclick = () => this._choose(i);
      opts.appendChild(b);
    });
    card.appendChild(tag); card.appendChild(q); card.appendChild(opts);
  },

  _choose(i) {
    const s = this.spec;
    const correct = i === s.correct;
    this.score.total++;
    if (correct) this.score.correct++;
    updateScoreboard();
    logEvent(`🔮 Prediction: you chose "${s.options[i]}" — ${correct ? 'CORRECT ✅' : 'not quite ❌'}.`, false);

    // mark the option buttons
    const btns = this.card().querySelectorAll('.predict-opt');
    btns.forEach((b, j) => {
      b.disabled = true;
      if (j === i) b.classList.add('chosen', correct ? 'correct' : 'wrong');
      if (j === s.correct) b.classList.add('correct');
    });

    // unfreeze so the animation actually plays behind the (now faded) card
    STATE.predictFreeze = false;
    this.overlay().classList.add('revealed');

    // reveal banner + actions
    const banner = el('div', 'predict-banner ' + (correct ? 'ok' : 'bad'),
      correct ? '✅ Correct' : '❌ Not quite');
    const expl = el('div', 'predict-expl',
      (correct ? '' : `Correct answer: ${s.options[s.correct]}. `) + s.explain);
    const actions = el('div', 'predict-actions');
    const again = el('button', 'btn', '↻ Run again');
    again.onclick = () => { if (s.onRunAgain) s.onRunAgain(); };
    const cont = el('button', 'btn primary', 'Continue →');
    cont.onclick = () => this._next();
    actions.appendChild(again); actions.appendChild(cont);
    this.card().appendChild(banner);
    this.card().appendChild(expl);
    this.card().appendChild(actions);
  },

  _finish() {
    this.active = false; this.spec = null;
    STATE.predictFreeze = false;
    document.body.classList.remove('predicting');
    this.overlay().classList.add('hidden');
    this.overlay().classList.remove('revealed');
  },
};

// tiny DOM helper
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function updateScoreboard() {
  const s = PREDICT.score;
  document.getElementById('scoreboard').textContent =
    `Predictions: ${s.correct}/${s.total} correct`;
}


/* =====================================================================
   FEATURE 2 — LIVE "CAN IT CONDUCT?" PANEL
   ---------------------------------------------------------------------
   Reads the active scene's conduction() method each frame and renders the
   master rule: conduction needs BOTH a connected "road" AND a partly-full
   band. A scene returns null to hide the panel.

   conduction() => {
     road: bool,  roadWhy: '3-4 words',
     band: bool,  bandWhy: '3-4 words',
     weak: bool   (optional: appends a "weak" qualifier to CONDUCTS)
   }
   ===================================================================== */
let _condSig = '';
function updateConductionPanel() {
  const panel = document.getElementById('conductionPanel');
  const data = activeScene && activeScene.conduction ? activeScene.conduction() : null;
  if (!data) { panel.classList.add('hidden'); _condSig = ''; return; }
  panel.classList.remove('hidden');

  // only touch the DOM when something actually changed
  const sig = `${data.road}|${data.roadWhy}|${data.band}|${data.bandWhy}|${data.weak}`;
  if (sig === _condSig) return;
  _condSig = sig;

  const mark = (id, ok) => {
    const e = document.getElementById(id);
    e.textContent = ok ? '✓' : '✗';
    e.className = 'cond-mark ' + (ok ? 'yes' : 'no');
  };
  mark('condRoadMark', data.road);
  mark('condBandMark', data.band);
  document.getElementById('condRoadWhy').textContent = data.roadWhy || '';
  document.getElementById('condBandWhy').textContent = data.bandWhy || '';

  const conducts = data.road && data.band;
  const res = document.getElementById('condResult');
  res.className = 'cond-result ' + (conducts ? 'conducts' : 'no');
  res.innerHTML = conducts
    ? 'CONDUCTS' + (data.weak ? '<span class="weak">(weakly)</span>' : '')
    : 'NO CURRENT';
}


/* =====================================================================
   SHARED FAILURE-MODE GLYPHS (FEATURE 3)
   ---------------------------------------------------------------------
   Smoke + "destroyed" overlay (reverse breakdown / LED burnout) and the
   red HEAT glyph emitted at crystal defects instead of a photon.
   ===================================================================== */
// A red wavy "heat" squiggle (energy released as heat, not light).
function drawHeat(c, x, y, scale = 1, alpha = 1) {
  c.save(); c.globalAlpha = alpha;
  c.strokeStyle = '#ff6a4d'; c.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    c.beginPath();
    const ox = (k - 1) * 6 * scale;
    for (let i = 0; i <= 10; i++) {
      const yy = y - i * 2.4 * scale;
      const xx = x + ox + Math.sin(i * 0.9) * 3 * scale;
      i === 0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy);
    }
    c.stroke();
  }
  c.restore();
}

// Full-stage "destroyed" overlay with drifting smoke puffs. `t` animates it.
function drawDestroyed(c, t, msg) {
  c.save();
  c.fillStyle = 'rgba(8,8,10,0.55)'; c.fillRect(0, 0, W, H);
  // smoke puffs rising from the device center
  for (let i = 0; i < 9; i++) {
    const ph = (t * 0.4 + i * 0.37) % 1;
    const x = W / 2 + Math.sin(i * 2 + t) * 60 + (i - 4) * 10;
    const y = H / 2 - ph * 180;
    const r = 14 + ph * 40;
    c.globalAlpha = (1 - ph) * 0.5;
    c.fillStyle = '#6b7280';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  label(c, W / 2, H / 2 - 20, '💨', { align: 'center', size: 52 });
  label(c, W / 2, H / 2 + 44, msg || 'Smoke — device destroyed', { align: 'center', size: 18, weight: '700', color: '#ff9a9a' });
  label(c, W / 2, H / 2 + 72, 'Press Reset to rebuild it.', { align: 'center', size: 12, color: COLORS.dim });
  c.restore();
}


/* =====================================================================
   7. UI WIRING  – tabs, controls, info panel, tooltips.
   ===================================================================== */

// ---- Tabs ----
const tabsEl = document.getElementById('tabs');
let current = 0;
SCENES.forEach((s, i) => {
  const b = document.createElement('button');
  b.className = 'tab'; b.textContent = s.title;
  b.onclick = () => selectScene(i);
  tabsEl.appendChild(b);
});

function selectScene(i) {
  current = i;
  activeScene = SCENES[i];
  [...tabsEl.children].forEach((t, j) => t.classList.toggle('active', j === i));
  document.getElementById('sceneTitle').textContent = activeScene.title;
  document.getElementById('sceneSub').textContent = activeScene.sub || '';
  setInfo(activeScene.what, activeScene.why);
  buildControls(activeScene);
  canvas.onmousemove = null; // clear scene-2 hover unless that scene rebinds
  if (activeScene.setup) activeScene.setup();
  logEvent(`▶ Opened "${activeScene.title}".`, false);
}

// ---- Info panel (What / Why), with glossary terms wired for tooltips --
function setInfo(what, why) {
  document.getElementById('whatText').innerHTML = what;
  document.getElementById('whyText').innerHTML = why;
  wireTerms();
}

// ---- Controls factory ----
// Each scene lists control keys; we build the matching widgets here.
const controlsEl = document.getElementById('controls');
function buildControls(scene) {
  controlsEl.innerHTML = '';
  const keys = scene.controls || [];

  keys.forEach(key => {
    if (key === 'voltage') {
      // Diode uses an EXTENDED reverse range so reverse-breakdown (Feature 3a)
      // is reachable. Breakdown is marked on-canvas at ≈ −10 V.
      addSlider('Voltage  (reverse breakdown near −10 V)', -12, 5, STATE.voltage, 0.1, v => { STATE.voltage = v; }, v => `${v>0?'+':''}${v.toFixed(1)} V`);
    } else if (key === 'temperature') {
      addSlider('Temperature', 0, 100, STATE.temperature, 1, v => { STATE.temperature = v; }, v => `${v|0} / 100`);
    } else if (key === 'bandGap') {
      addSlider('Band-gap size (→ photon color)', 0, 100, STATE.bandGap, 1, v => { STATE.bandGap = v; }, v => {
        const g=v/100; return v + (g<0.33?'  (red)':g<0.66?'  (green)':'  (blue/violet)');
      });
    } else if (key === 'ledCurrent') {
      addSlider('Current (→ brightness)', -5, 5, STATE.voltage, 0.1, v => { STATE.voltage = v; }, v => `${(((v+5)/10)*100)|0}%`);
    } else if (key === 'polarity') {
      addButton('🔁 Flip polarity', 'btn', () => {
        STATE.polarity *= -1;
        logEvent(`🔁 Polarity flipped → now ${effVoltage()>0?'FORWARD':effVoltage()<0?'REVERSE':'zero'} bias.`);
      });
    } else if (key === 'gate') {
      const btn = addButton(STATE.gateOn?'Gate: ON (1)':'Gate: OFF (0)', 'btn toggle ' + (STATE.gateOn?'on':'off'), () => {
        STATE.gateOn = !STATE.gateOn;
        btn.textContent = STATE.gateOn?'Gate: ON (1)':'Gate: OFF (0)';
        btn.className = 'btn toggle ' + (STATE.gateOn?'on':'off');
      });
    } else if (key === 'dopant') {
      // FEATURE 1: adding a dopant is a determinate event → predict first.
      addButton('🧪 Add phosphorus (P)', 'btn', () => {
        PREDICT.ask({
          tag: 'Doping type',
          question: 'Adding phosphorus (5 valence electrons) to silicon creates…?',
          options: ['Extra free electrons (n-type)', 'Extra holes (p-type)'],
          correct: 0,
          explain: "Phosphorus's 5th electron has no bond to join → it becomes a free electron → n-type.",
        });
        logEvent('🧪 Doped with phosphorus (donor) → n-type: a free electron appears.');
      });
    } else if (key === 'material') {
      // FEATURE 5: material picker (Si / GaAs / GaN)
      addMaterialPicker();
    } else if (key === 'resistor') {
      // FEATURE 3b / 6: series resistor toggle + value slider (grayed when OFF)
      addResistorControls();
    } else if (key === 'crystalQuality') {
      // FEATURE 3c: crystal-quality slider (perfect → defective)
      addSlider('Crystal quality', 0, 100, (1 - STATE.crystalQuality) * 100, 1,
        v => { STATE.crystalQuality = clamp(1 - v / 100, 0, 1); },
        v => v >= 95 ? 'Perfect' : v <= 5 ? 'Very defective' : `${v|0}% perfect`);
    } else if (key === 'whiteLight') {
      // FEATURE 7: white-light sandbox controls (depend on the chosen method)
      addWhiteLightControls(scene);
    } else if (key === 'spotlight') {
      // FEATURE 4: spotlight-one-electron + step button
      addSpotlightControls();
    } else if (key === 'reset') {
      // Generic reset for destroyed devices (Feature 3a/3b)
      addButton('🔧 Reset device', 'btn', () => {
        if (activeScene && activeScene.resetDevice) activeScene.resetDevice();
        else if (activeScene && activeScene.setup) activeScene.setup();
        logEvent('🔧 Device reset.', false);
      });
    } else if (key === 'transport') {
      addTransport();
    }
  });
}

/* FEATURE 5 — material dropdown. Changing material updates the band gap,
   photon color, lattice rendering and labels everywhere, and (Feature 1)
   fires the "bigger gap = bluer" prediction. */
function addMaterialPicker() {
  const wrap = el('div', 'control');
  const lab = el('label', null, 'Material: ');
  const sel = document.createElement('select');
  sel.className = 'mat-select';
  Object.keys(MATERIALS).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = MATERIALS[k].name;
    if (k === STATE.material) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    const prev = STATE.material;
    const next = sel.value;
    if (next === prev) return;
    const biggerGap = MATERIALS[next].gapEV > MATERIALS[prev].gapEV;
    // Predict-first: ask the color question BEFORE applying the change.
    PREDICT.askSequence([{
      tag: 'Band gap → color',
      question: 'A BIGGER band gap produces a photon that is…?',
      options: ['Redder (lower energy)', 'Bluer (higher energy)', 'Same color'],
      correct: 1,
      explain: 'Bigger gap = bigger energy drop = higher-energy photon = bluer light.',
      onRunAgain: () => applyMaterial(next),
    }]);
    applyMaterial(next);
    logEvent(`🧪 Material → ${MATERIALS[next].name} (gap ${MATERIALS[next].gapEV} eV, ${MATERIALS[next].colorName}). ${biggerGap ? 'Bigger gap → bluer.' : 'Smaller gap → redder.'}`);
  };
  lab.appendChild(sel);
  wrap.appendChild(lab);
  controlsEl.appendChild(wrap);
}
function applyMaterial(key) {
  STATE.material = key;
  // keep the legacy 0..100 bandGap roughly in sync (used by some labels)
  STATE.bandGap = clamp(Math.round(MATERIALS[key].gapEV / 3.4 * 100), 0, 100);
}

/* FEATURE 3b / 6 — resistor toggle + value slider. The slider is disabled
   (grayed) when the resistor is OFF, exactly like a real breadboard choice. */
function addResistorControls() {
  const toggle = addButton(
    STATE.resistorOn ? 'Resistor: ON' : 'Resistor: OFF',
    'btn toggle ' + (STATE.resistorOn ? 'on' : 'off'), null);
  // value slider
  const wrap = el('div', 'control');
  const lab = el('label', null, 'Resistor value: ');
  const valSpan = el('span', 'value', `${STATE.resistorVal} Ω`);
  lab.appendChild(valSpan);
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = 0; inp.max = 1000; inp.step = 10; inp.value = STATE.resistorVal;
  inp.oninput = () => { STATE.resistorVal = parseFloat(inp.value); valSpan.textContent = `${STATE.resistorVal} Ω`; };
  inp.disabled = !STATE.resistorOn;
  wrap.style.opacity = STATE.resistorOn ? '1' : '0.4';
  wrap.appendChild(lab); wrap.appendChild(inp);

  toggle.onclick = () => {
    STATE.resistorOn = !STATE.resistorOn;
    toggle.textContent = STATE.resistorOn ? 'Resistor: ON' : 'Resistor: OFF';
    toggle.className = 'btn toggle ' + (STATE.resistorOn ? 'on' : 'off');
    inp.disabled = !STATE.resistorOn;
    wrap.style.opacity = STATE.resistorOn ? '1' : '0.4';
    if (activeScene && activeScene.resetDevice) activeScene.resetDevice(); // un-burn if needed
    logEvent(`🧰 Resistor ${STATE.resistorOn ? 'ON — current limited (safe).' : 'OFF — no current limit (danger!).'}`);
  };
  controlsEl.appendChild(wrap);
}

/* FEATURE 7 — white-light sandbox controls. Two methods; the control set
   rebuilds when the method toggles. */
function addWhiteLightControls(scene) {
  const methodBtn = addButton(
    scene.method === 'rgb' ? 'Method: RGB mixing' : 'Method: Blue + phosphor',
    'btn primary', () => {
      scene.method = scene.method === 'rgb' ? 'phosphor' : 'rgb';
      buildControls(scene); // rebuild to show the right widgets
      logEvent(`💡 White-light method → ${scene.method === 'rgb' ? 'RGB additive mixing' : 'blue LED + yellow phosphor'}.`);
    });
  methodBtn.title = 'Switch between the two ways to make white light';

  if (scene.method === 'rgb') {
    // three emitters: toggle + intensity each
    [['r', 'Red', '#ff5a5a'], ['g', 'Green', '#5aff7a'], ['b', 'Blue', '#5a7bff']].forEach(([k, name, col]) => {
      const onBtn = addButton(`${name}: ${scene[k + 'On'] ? 'ON' : 'OFF'}`,
        'btn toggle ' + (scene[k + 'On'] ? 'on' : 'off'), () => {
          scene[k + 'On'] = !scene[k + 'On'];
          onBtn.textContent = `${name}: ${scene[k + 'On'] ? 'ON' : 'OFF'}`;
          onBtn.className = 'btn toggle ' + (scene[k + 'On'] ? 'on' : 'off');
        });
      addSlider(`${name} intensity`, 0, 100, scene[k] * 100, 1,
        v => { scene[k] = v / 100; }, v => `${v | 0}%`);
    });
  } else {
    const ph = addButton(scene.phosphor ? 'Phosphor coating: ON' : 'Phosphor coating: OFF',
      'btn toggle ' + (scene.phosphor ? 'on' : 'off'), () => {
        scene.phosphor = !scene.phosphor;
        ph.textContent = scene.phosphor ? 'Phosphor coating: ON' : 'Phosphor coating: OFF';
        ph.className = 'btn toggle ' + (scene.phosphor ? 'on' : 'off');
        logEvent(`🟡 Yellow phosphor ${scene.phosphor ? 'ON → blue + yellow = white.' : 'OFF → pure blue.'}`);
      });
  }
}

/* FEATURE 4 — spotlight toggle + per-stage Step button. */
function addSpotlightControls() {
  const btn = addButton('🔦 Spotlight one electron', 'btn', () => {
    if (!activeScene || !activeScene.toggleSpotlight) return;
    const on = activeScene.toggleSpotlight();
    btn.textContent = on ? '🔦 Spotlight: ON' : '🔦 Spotlight one electron';
    btn.classList.toggle('primary', on);
    step.style.display = on ? '' : 'none';
  });
  const step = addButton('⏭ Step stage', 'btn', () => {
    if (activeScene && activeScene.spotlightStep) activeScene.spotlightStep();
  });
  step.style.display = 'none';
}

function addSlider(labelText, min, max, val, step, onInput, fmt) {
  const wrap = document.createElement('div'); wrap.className = 'control';
  const lab = document.createElement('label');
  const valSpan = document.createElement('span'); valSpan.className = 'value';
  valSpan.textContent = fmt ? fmt(val) : val;
  lab.textContent = labelText + ': '; lab.appendChild(valSpan);
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
  inp.oninput = () => { const v = parseFloat(inp.value); onInput(v); valSpan.textContent = fmt ? fmt(v) : v; };
  wrap.appendChild(lab); wrap.appendChild(inp); controlsEl.appendChild(wrap);
  return inp;
}

function addButton(text, cls, onClick) {
  const b = document.createElement('button'); b.className = cls; b.textContent = text;
  b.onclick = onClick; controlsEl.appendChild(b); return b;
}

// Play / Pause / Step transport controls.
function addTransport() {
  const row = document.createElement('div'); row.className = 'btn-row';
  const play = document.createElement('button');
  play.className = 'btn primary';
  const sync = () => play.textContent = STATE.paused ? '▶ Play' : '⏸ Pause';
  sync();
  play.onclick = () => { STATE.paused = !STATE.paused; sync(); };
  const step = document.createElement('button');
  step.className = 'btn'; step.textContent = '⏭ Step';
  step.onclick = () => { STATE.paused = true; sync(); STATE.stepRequested = true; };
  row.appendChild(play); row.appendChild(step);
  controlsEl.appendChild(row);
}

// ---- Reduced-motion toggle ----
document.getElementById('reducedMotion').onchange = (e) => {
  STATE.reducedMotion = e.target.checked;
  logEvent(`🐢 Reduced motion ${STATE.reducedMotion ? 'ON (slow)' : 'OFF'}.`, false);
};

// ---- FEATURE 1: Predict-first toggle (in-memory only) ----
document.getElementById('predictFirst').onchange = (e) => {
  STATE.predictFirst = e.target.checked;
  logEvent(`🔮 Predict-first mode ${STATE.predictFirst ? 'ON' : 'OFF'}.`, false);
  // closing the toggle mid-card shouldn't trap the user
  if (!STATE.predictFirst && PREDICT.active) PREDICT._finish();
};
updateScoreboard();

// ---- Glossary tooltips ----
const tooltip = document.getElementById('tooltip');
function wireTerms() {
  document.querySelectorAll('.term').forEach(el => {
    const key = el.dataset.t || el.textContent.toLowerCase();
    const def = GLOSSARY[key] || GLOSSARY[el.textContent.toLowerCase()];
    if (!def) return;
    el.onmouseenter = (e) => {
      tooltip.textContent = def; tooltip.classList.add('show');
      moveTip(e);
    };
    el.onmousemove = moveTip;
    el.onmouseleave = () => tooltip.classList.remove('show');
  });
}
function moveTip(e) {
  tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 280) + 'px';
  tooltip.style.top = (e.clientY + 16) + 'px';
}


/* =====================================================================
   BOOT
   ===================================================================== */
resize();
selectScene(0);
requestAnimationFrame(loop);
