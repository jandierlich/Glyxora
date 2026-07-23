/* ============================================================
   GLYXORA – eigenständiges Drei-Gewinnt-Kristallpuzzle
   Komplett clientseitig, keine externen Abhängigkeiten,
   keine externen Schriften/Bilder/Sounds – alles selbst erzeugt.
   ============================================================ */

'use strict';

/* ---------- Echte sichtbare Höhe (behebt weiße Ränder in iOS Safari/PWA) ----------
   iOS liefert bei ein-/ausblendender Adressleiste bzw. im installierten Modus
   nicht immer eine korrekte 100%/100dvh-Höhe. Wir messen die tatsächliche
   sichtbare Höhe per JS und legen sie als CSS-Variable ab; --app-height ist in
   style.css die letzte (also gewinnende) Fallback-Stufe für html/body/#app. */
function updateAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', h + 'px');
}
updateAppHeight();
window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', () => setTimeout(updateAppHeight, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', updateAppHeight);

/* ---------- Grundkonstanten ---------- */
const GEM_TYPES = ['rubin', 'saphir', 'smaragd', 'amethyst', 'topas', 'bernstein'];
const GEM_COLORS = {
  rubin: '#ff4f6d', saphir: '#2f95ff', smaragd: '#26d47a',
  amethyst: '#b25bff', topas: '#ffd23f', bernstein: '#ff9a3c'
};
const PRAISE_COMBO = ['Kombo-Wahnsinn!', 'Kettenreaktion!', 'Mega-Kombo!', 'Wow!', 'Kristallregen!'];
const PRAISE_LINE = ['Kristallblitz!', 'Zack, weg!', 'Reihen-Rasur!'];
const PRAISE_BOMB = ['Kristallbombe!', 'Kaboom!', 'Volltreffer!'];
const PRAISE_RAINBOW = ['Kristallstern!', 'Regenbogen-Sturm!', 'Alles bunt weg!'];
const GRID_SIZE = 8;
const SAVE_KEY = 'glyxora-save-v1';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Sound (Web Audio, komplett synthetisch) ---------- */
const SoundManager = {
  ctx: null,
  enabled: true,
  reverbSend: null,
  ensureCtx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this._buildReverb();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  /* Kurzer, komplett prozedural erzeugter Hall (Rauschen mit exponentiellem
     Abklingen als Impulsantwort) — keine externe Audiodatei, daher
     lizenzrechtlich vollkommen unbedenklich. Gibt den Klängen etwas mehr
     Raum und Wärme statt trockener Einzeltöne. */
  _buildReverb() {
    try {
      const ctx = this.ctx;
      const dur = 1.4;
      const len = Math.floor(ctx.sampleRate * dur);
      const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        }
      }
      const convolver = ctx.createConvolver();
      convolver.buffer = impulse;
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.14;
      convolver.connect(wetGain).connect(ctx.destination);
      this.reverbSend = convolver;
    } catch (e) { this.reverbSend = null; }
  },
  tone(freq, dur, type = 'sine', gainVal = 0.08, delay = 0, detune = 0) {
    if (!this.enabled) return;
    try {
      const ctx = this.ensureCtx();
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4200;
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      if (detune) osc.detune.value = detune;
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(gainVal, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(filter).connect(gain);
      gain.connect(ctx.destination);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* Audio evtl. blockiert – kein Problem */ }
  },
  select() { this.tone(520, 0.08, 'triangle', 0.05); },
  swapInvalid() { this.tone(160, 0.18, 'sawtooth', 0.05); },
  match(comboLevel) {
    const base = 440 + Math.min(comboLevel, 8) * 40;
    this.tone(base, 0.18, 'sine', 0.07);
    this.tone(base * 1.5, 0.16, 'sine', 0.032, 0.02); // Quinte darüber = voller Klang statt Einzelton
  },
  special() {
    this.tone(300, 0.1, 'square', 0.05);
    this.tone(600, 0.2, 'sine', 0.06, 0.05);
    this.tone(900, 0.22, 'sine', 0.028, 0.09);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => {
      this.tone(f, 0.24, 'sine', 0.07, i * 0.1);
      this.tone(f, 0.24, 'sine', 0.024, i * 0.1, 7); // leicht verstimmte zweite Stimme = warmer Chorus-Effekt
    });
  },
  lose() {
    [400, 320, 240].forEach((f, i) => this.tone(f, 0.28, 'sawtooth', 0.05, i * 0.12));
  },
  button() { this.tone(700, 0.05, 'triangle', 0.04); }
};

/* ---------- Speicherstand ---------- */
function defaultSaveData() {
  return {
    unlocked: 1, stars: {}, zenBest: 0, soundOn: true, difficulty: 'mittel', darkMode: false,
    jokers: { undo: 3, auto: 3, color: 2, extra: 2 },
    stats: {
      levelsCompleted: 0, totalScore: 0, bestCombo: 1, bestScore: 0,
      bombs: 0, lines: 0, rainbows: 0, threeStarLevels: 0,
      typeCleared: { rubin: 0, saphir: 0, smaragd: 0, amethyst: 0, topas: 0, bernstein: 0 }
    },
    achievements: {},
    streak: { count: 0, lastDate: null },
    daily: { history: {} },
    scoreHistory: [],
    milestones: {},
    tutorialSeen: false
  };
}
const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return defaultSaveData();
  },
  save(data) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }
};
let saveData = Storage.load();
// Migration für ältere Spielstände ohne die neuen Felder
(function migrateSaveData() {
  const d = defaultSaveData();
  if (!saveData.difficulty) saveData.difficulty = d.difficulty;
  if (!saveData.jokers) saveData.jokers = d.jokers;
  if (saveData.jokers.color === undefined) saveData.jokers.color = d.jokers.color;
  if (saveData.jokers.extra === undefined) saveData.jokers.extra = d.jokers.extra;
  if (!saveData.stats) saveData.stats = d.stats;
  if (!saveData.stats.typeCleared) saveData.stats.typeCleared = d.stats.typeCleared;
  if (!saveData.achievements) saveData.achievements = {};
  if (!saveData.streak) saveData.streak = { count: 0, lastDate: null };
  if (!saveData.daily) saveData.daily = { history: {} };
  if (saveData.darkMode === undefined) saveData.darkMode = false;
  if (!saveData.scoreHistory) saveData.scoreHistory = [];
  if (saveData.stats.bestScore === undefined) saveData.stats.bestScore = 0;
  if (!saveData.milestones) saveData.milestones = {};
  if (saveData.tutorialSeen === undefined) saveData.tutorialSeen = true;
})();
SoundManager.enabled = saveData.soundOn !== false;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- Themen-Welten ----------
   Rein optisch: alle 15 Level wechselt die Farbwelt (zyklisch, damit auch
   bei unendlich vielen Leveln immer ein passendes Thema existiert). */
const WORLDS = [
  { name: 'Kristallhöhle', bg1: '#1a1436', bg2: '#2c1f57', blob1: '#ff2ea0', blob2: '#22e8ff', hue: 0 },
  { name: 'Wolkenreich', bg1: '#2c4470', bg2: '#5f8fc4', blob1: '#5df0ff', blob2: '#ffd23f', hue: 45 },
  { name: 'Vulkanfeld', bg1: '#3a1210', bg2: '#7a2b12', blob1: '#ff5f1f', blob2: '#ffea2f', hue: -35 },
  { name: 'Tiefsee', bg1: '#0a3244', bg2: '#146a7a', blob1: '#2fffd0', blob2: '#2f95ff', hue: 160 },
  { name: 'Sternenhimmel', bg1: '#0a0a2a', bg2: '#241a4e', blob1: '#ffd23f', blob2: '#c93bff', hue: 260 }
];
function worldForLevel(n) {
  return WORLDS[Math.floor((n - 1) / 15) % WORLDS.length];
}
/* Dunkler Modus: verwandelt nur die Spielfeld-Bühne in ein dunkles
   "Schmuckkästchen" (Samt-Optik mit Goldrahmen), lässt die Themen-Welten-
   Hintergrundfarben aber unangetastet, damit sie sich nicht gegenseitig
   überschreiben. */
function applyDarkMode() {
  document.body.classList.toggle('dark-mode', !!saveData.darkMode);
}
function applyWorldTheme(world) {
  const root = document.documentElement.style;
  root.setProperty('--bg-1', world.bg1);
  root.setProperty('--bg-2', world.bg2);
  root.setProperty('--blob-1', world.blob1);
  root.setProperty('--blob-2', world.blob2);
  root.setProperty('--world-hue', (world.hue || 0) + 'deg');
}

/* ---------- Meilenstein-Belohnungen ----------
   Ab bestimmten Leveln erhalten ALLE Kristalle dauerhaft eine edlere,
   funkelndere Optik als Fortschritts-Belohnung (rein visuell, per CSS-Klasse
   am <body>, kein Gameplay-Vorteil). */
const MILESTONE_TIERS = [
  { level: 25, id: 'glanz25', name: 'Kristall-Glanz', cssClass: 'milestone-25' },
  { level: 50, id: 'glanz50', name: 'Sternenglanz', cssClass: 'milestone-50' },
  { level: 100, id: 'glanz100', name: 'Kristallkönig', cssClass: 'milestone-100' },
  { level: 200, id: 'glanz200', name: 'Legendärer Glanz', cssClass: 'milestone-200' }
];
function applyMilestones() {
  MILESTONE_TIERS.forEach((m) => {
    document.body.classList.toggle(m.cssClass, !!saveData.milestones[m.id]);
  });
}
function checkNewMilestone(prevUnlocked, newUnlocked) {
  const tier = MILESTONE_TIERS.find((m) => prevUnlocked <= m.level && newUnlocked > m.level && !saveData.milestones[m.id]);
  if (!tier) return;
  saveData.milestones[tier.id] = true;
  applyMilestones();
  setTimeout(() => {
    const banner = document.getElementById('result-milestone');
    if (!banner) return;
    banner.textContent = '✨ Meilenstein: ' + tier.name + ' freigeschaltet!';
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }, 500);
}

/* ---------- Erfolge ---------- */
const ACHIEVEMENTS = [
  { id: 'first_level', name: 'Erster Sieg', desc: 'Schließe dein erstes Level ab.', check: (s) => s.levelsCompleted >= 1 },
  { id: 'ten_levels', name: 'Aufsteiger', desc: 'Schließe 10 Level ab.', check: (s) => s.levelsCompleted >= 10 },
  { id: 'fifty_levels', name: 'Kristall-Veteran', desc: 'Schließe 50 Level ab.', check: (s) => s.levelsCompleted >= 50 },
  { id: 'hundred_levels', name: 'Kristall-Legende', desc: 'Schließe 100 Level ab.', check: (s) => s.levelsCompleted >= 100 },
  { id: 'bomb_master', name: 'Bombenleger', desc: 'Löse 25 Kristallbomben aus.', check: (s) => s.bombs >= 25 },
  { id: 'line_master', name: 'Blitzschlag', desc: 'Löse 25 Kristallblitze aus.', check: (s) => s.lines >= 25 },
  { id: 'rainbow_master', name: 'Regenbogenjäger', desc: 'Löse 10 Kristallsterne aus.', check: (s) => s.rainbows >= 10 },
  { id: 'combo_master', name: 'Kombokönig', desc: 'Erreiche eine Kombo von x6 oder mehr.', check: (s) => s.bestCombo >= 6 },
  { id: 'perfectionist', name: 'Perfektionist', desc: 'Schließe 10 Level mit 3 Sternen ab.', check: (s) => s.threeStarLevels >= 10 },
  { id: 'daily_devotee', name: 'Treuer Kristallsammler', desc: 'Spiele 7 Tage in Folge.', check: (s, save) => save.streak.count >= 7 }
];
function checkAchievements() {
  const unlockedNow = [];
  ACHIEVEMENTS.forEach((a) => {
    if (!saveData.achievements[a.id] && a.check(saveData.stats, saveData)) {
      saveData.achievements[a.id] = true;
      unlockedNow.push(a);
    }
  });
  if (unlockedNow.length) Storage.save(saveData);
  return unlockedNow;
}

/* ---------- Level-Definitionen (unendlich viele, prozedural erzeugt) ----------
   Es gibt keine feste Obergrenze mehr: buildLevel(n, schwierigkeit) berechnet
   jedes Level bei Bedarf. Der Schwierigkeitsgrad verschiebt nur den
   Startpunkt der Kurve — der Anstieg von Level zu Level bleibt in jeder
   Stufe bewusst moderat, auch über sehr viele hundert Level hinweg. */
const DIFFICULTY_PRESETS = {
  leicht: { baseTarget: 350, maxTarget: 520, growthK: 60, baseMoves: 28, minMoves: 18, moveDecayK: 6 },
  mittel: { baseTarget: 450, maxTarget: 650, growthK: 60, baseMoves: 25, minMoves: 15, moveDecayK: 6 },
  schwer: { baseTarget: 560, maxTarget: 800, growthK: 55, baseMoves: 22, minMoves: 13, moveDecayK: 6 }
};
function buildLevel(n, difficulty) {
  const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.mittel;
  const progress = 1 - 1 / (1 + (n - 1) / preset.growthK);
  let target = Math.round(preset.baseTarget + (preset.maxTarget - preset.baseTarget) * progress);
  const moves = Math.max(preset.minMoves, preset.baseMoves - Math.floor((n - 1) / preset.moveDecayK));
  const iceCount = n >= 6 ? Math.min(12, 2 + Math.floor((n - 6) / 2)) : 0;
  const frostRatio = n >= 20 ? Math.min(0.5, (n - 20) / 60) : 0;
  const colorCount = n < 7 ? 5 : 6;
  const isBoss = n > 0 && n % 25 === 0;

  let objective = 'score';
  if (!isBoss && n >= 10 && n % 5 === 0) {
    const cycle = Math.floor(n / 5) % 3;
    objective = cycle === 0 ? 'keys' : (cycle === 1 ? 'ice' : 'cages');
  }
  const keysCount = objective === 'keys' ? Math.min(6, 2 + Math.floor((n - 10) / 10)) : 0;
  const cagesCount = objective === 'cages' ? Math.min(10, 3 + Math.floor((n - 15) / 10)) : (n >= 15 ? Math.min(4, Math.floor((n - 15) / 15)) : 0);

  if (isBoss) target = Math.round(target * 1.6);

  return {
    index: n,
    size: GRID_SIZE,
    target,
    moves,
    iceCount,
    frostRatio,
    objective,
    iceTarget: objective === 'ice' ? Math.max(6, iceCount) : 0,
    keysCount,
    keysTarget: keysCount,
    cagesCount,
    cagesTarget: objective === 'cages' ? Math.max(6, cagesCount) : 0,
    colorCount,
    isBoss,
    world: worldForLevel(n),
    starThresholds: [target, Math.round(target * 1.5), Math.round(target * 2)]
  };
}

/* ============================================================
   SPIEL-ENGINE
   ============================================================ */
class Game {
  constructor(boardEl, fxEl, config, mode) {
    this.boardEl = boardEl;
    this.fxEl = fxEl;
    this.config = config;
    this.mode = mode; // 'level' | 'zen'
    this.size = config.size;
    this.grid = [];
    this.gemEls = new Map();
    this.nextId = 1;
    this.score = 0;
    this.combo = 1;
    this.movesLeft = mode === 'level' ? config.moves : Infinity;
    this.iceCleared = 0;
    this.cagesCleared = 0;
    this.keysDelivered = 0;
    this.pendingJoker = null;
    this.runStats = { bombs: 0, lines: 0, rainbows: 0, maxCombo: 1, typeCleared: { rubin: 0, saphir: 0, smaragd: 0, amethyst: 0, topas: 0, bernstein: 0 } };
    this.busy = false;
    this.selected = null;
    this.dragStart = null;
    this.cellSize = 0;
    this.ended = false;
    this.lastSnapshot = null;

    this.onUpdate = null;
    this.onEnd = null;

    this._setupBoardSize();
    this._buildInitialGrid();
    this._renderAll(true);
    this._bindInput();
    window.addEventListener('resize', () => this._handleResize());
    this._sparkleTimer = setInterval(() => this._spawnSparkle(), 1300);
  }

  /* ---------- Board-Geometrie ---------- */
  _setupBoardSize() {
    const wrap = this.boardEl.parentElement;
    const maxW = Math.min(wrap.clientWidth * 0.98, window.innerHeight * 0.62, 480);
    this.cellSize = Math.floor(maxW / this.size);
    const total = this.cellSize * this.size;
    this.boardEl.style.width = total + 'px';
    this.boardEl.style.height = total + 'px';
    this.fxEl.style.width = total + 'px';
    this.fxEl.style.height = total + 'px';
  }

  _handleResize() {
    this._setupBoardSize();
    this.gemEls.forEach((el, id) => {
      el.classList.add('no-anim');
    });
    this._positionAll();
    requestAnimationFrame(() => {
      this.gemEls.forEach((el) => el.classList.remove('no-anim'));
    });
  }

  _positionAll() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cell = this.grid[r][c];
        if (cell) this._placeEl(this.gemEls.get(cell.id), r, c);
      }
    }
  }

  _placeEl(el, r, c) {
    el.style.left = (c * this.cellSize) + 'px';
    el.style.top = (r * this.cellSize) + 'px';
    el.style.width = this.cellSize + 'px';
    el.style.height = this.cellSize + 'px';
  }

  /* ---------- Grid-Aufbau ---------- */
  _randomType() {
    return GEM_TYPES[rnd(this.config.colorCount)];
  }

  _makeGem(type) {
    return { id: this.nextId++, type, special: null, iceLevel: 0, cageLevel: 0, key: false };
  }

  _buildInitialGrid() {
    const n = this.size;
    this.grid = Array.from({ length: n }, () => Array(n).fill(null));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let type;
        let tries = 0;
        do {
          type = this._randomType();
          tries++;
        } while (tries < 20 && this._wouldMatchAt(r, c, type));
        this.grid[r][c] = this._makeGem(type);
      }
    }
    // Eiskristalle verteilen (ein Teil davon als zweischichtiger "Frost")
    let placed = 0;
    let guard = 0;
    while (placed < this.config.iceCount && guard < 500) {
      guard++;
      const r = rnd(n), c = rnd(n);
      if (this.grid[r][c].iceLevel === 0) {
        const isFrost = Math.random() < (this.config.frostRatio || 0);
        this.grid[r][c].iceLevel = isFrost ? 2 : 1;
        placed++;
      }
    }
    // Schlüssel-Kristalle in den oberen Reihen platzieren (müssen nach unten transportiert werden)
    if (this.config.keysCount) {
      let keysPlaced = 0;
      guard = 0;
      const topRows = Math.min(3, n - 1);
      while (keysPlaced < this.config.keysCount && guard < 500) {
        guard++;
        const r = rnd(topRows), c = rnd(n);
        if (!this.grid[r][c].key && this.grid[r][c].iceLevel === 0) {
          this.grid[r][c].key = true;
          keysPlaced++;
        }
      }
    }
    // Käfig-Kristalle verteilen: müssen erst durch benachbarte Verschmelzungen
    // aufgebrochen werden, bevor der Kristall selbst normal weiterspielt
    if (this.config.cagesCount) {
      let cagesPlaced = 0;
      guard = 0;
      while (cagesPlaced < this.config.cagesCount && guard < 500) {
        guard++;
        const r = rnd(n), c = rnd(n);
        const cell = this.grid[r][c];
        if (cell.cageLevel === 0 && cell.iceLevel === 0 && !cell.key) {
          cell.cageLevel = 1;
          cagesPlaced++;
        }
      }
    }
    if (!this._hasAnyValidMove()) this._reshuffleBoard();
  }

  _wouldMatchAt(r, c, type) {
    if (c >= 2 && this.grid[r][c - 1] && this.grid[r][c - 1].type === type &&
        this.grid[r][c - 2] && this.grid[r][c - 2].type === type) return true;
    if (r >= 2 && this.grid[r - 1][c] && this.grid[r - 1][c].type === type &&
        this.grid[r - 2][c] && this.grid[r - 2][c].type === type) return true;
    return false;
  }

  /* ---------- Rendering ---------- */
  _renderAll(instant) {
    this.boardEl.innerHTML = '';
    this.gemEls.clear();
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cell = this.grid[r][c];
        if (cell) this._createEl(cell, r, c);
      }
    }
  }

  _createEl(cell, r, c) {
    const el = document.createElement('div');
    el.className = 'gem t-' + cell.type;
    el.dataset.id = cell.id;
    const shape = document.createElement('div');
    shape.className = 'gem-shape';
    const delay = (Math.random() * 2.4).toFixed(2) + 's';
    shape.style.setProperty('--delay', delay);
    const facets = document.createElement('div');
    facets.className = 'gem-facets';
    facets.style.setProperty('--delay', delay);
    shape.appendChild(facets);
    el.appendChild(shape);
    if (cell.iceLevel > 0) {
      const ice = document.createElement('div');
      ice.className = 'ice-overlay' + (cell.iceLevel >= 2 ? ' frost' : '');
      el.appendChild(ice);
    }
    if (cell.cageLevel > 0) {
      const cage = document.createElement('div');
      cage.className = 'cage-overlay';
      el.appendChild(cage);
    }
    if (cell.key) {
      const key = document.createElement('div');
      key.className = 'key-overlay';
      key.textContent = '🔑';
      el.appendChild(key);
    }
    this._applySpecialClass(el, cell.special);
    this._placeEl(el, r, c);
    this.boardEl.appendChild(el);
    this.gemEls.set(cell.id, el);
    return el;
  }

  _applySpecialClass(el, special) {
    el.classList.remove('special-line', 'special-bomb', 'special-rainbow', 'vert');
    if (special === 'lineH') el.classList.add('special-line');
    if (special === 'lineV') el.classList.add('special-line', 'vert');
    if (special === 'bomb') el.classList.add('special-bomb');
    if (special === 'rainbow') el.classList.add('special-rainbow');
  }

  _floatText(r, c, text, color) {
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    f.style.left = (c * this.cellSize + this.cellSize * 0.15) + 'px';
    f.style.top = (r * this.cellSize + this.cellSize * 0.25) + 'px';
    if (color) f.style.color = color;
    this.fxEl.appendChild(f);
    setTimeout(() => f.remove(), 950);
  }

  _showPraise(text) {
    const banner = document.getElementById('praise-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.classList.remove('show');
    void banner.offsetWidth; // Reflow, damit die Animation erneut startet
    banner.classList.add('show');
  }

  _screenShake() {
    const target = this.boardEl.parentElement;
    if (!target || !target.classList) return;
    target.classList.remove('screen-shake');
    void target.offsetWidth;
    target.classList.add('screen-shake');
  }

  _deliverKeys() {
    if (!this.config.keysCount) return;
    const bottomRow = this.size - 1;
    for (let c = 0; c < this.size; c++) {
      const cell = this.grid[bottomRow][c];
      if (cell && cell.key) {
        cell.key = false;
        this.keysDelivered++;
        const el = this.gemEls.get(cell.id);
        if (el) {
          const keyEl = el.querySelector('.key-overlay');
          if (keyEl) keyEl.remove();
        }
        this._floatText(bottomRow, c, '🔑', '#ffd23f');
        this.score += 40;
      }
    }
  }

  _burstParticles(r, c, type) {
    const color = GEM_COLORS[type] || '#ffffff';
    const cx = c * this.cellSize + this.cellSize / 2;
    const cy = r * this.cellSize + this.cellSize / 2;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = color;
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = this.cellSize * (0.6 + Math.random() * 0.5);
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      this.fxEl.appendChild(p);
      setTimeout(() => p.remove(), 650);
    }
  }

  /* ---------- Eingabe ---------- */
  _bindInput() {
    const boardEl = this.boardEl;
    boardEl.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    boardEl.addEventListener('pointermove', (e) => this._onPointerMove(e));
    boardEl.addEventListener('pointerup', (e) => this._onPointerUp(e));
    boardEl.addEventListener('pointercancel', () => { this.dragStart = null; });
  }

  _cellFromEvent(e) {
    const rect = this.boardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = clamp(Math.floor(x / this.cellSize), 0, this.size - 1);
    const r = clamp(Math.floor(y / this.cellSize), 0, this.size - 1);
    return { r, c };
  }

  _onPointerDown(e) {
    if (this.busy || this.ended) return;
    const { r, c } = this._cellFromEvent(e);
    if (!this.grid[r][c]) return;
    if (this.pendingJoker === 'color') {
      this.pendingJoker = null;
      this._clearSelection();
      this.applyColorJoker(r, c);
      return;
    }
    if (this.selected) {
      if (this._isAdjacent(this.selected, { r, c })) {
        const from = this.selected;
        this._clearSelection();
        this._attemptSwap(from, { r, c });
        this.dragStart = null;
        return;
      }
    }
    this._setSelection(r, c);
    this.dragStart = { r, c, x: e.clientX, y: e.clientY, moved: false };
    SoundManager.select();
  }

  _onPointerMove(e) {
    if (!this.dragStart || this.busy || this.ended) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    const threshold = this.cellSize * 0.32;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > threshold) {
      let target = { r: this.dragStart.r, c: this.dragStart.c };
      if (Math.abs(dx) > Math.abs(dy)) target.c += dx > 0 ? 1 : -1;
      else target.r += dy > 0 ? 1 : -1;
      if (target.r >= 0 && target.r < this.size && target.c >= 0 && target.c < this.size) {
        const from = { r: this.dragStart.r, c: this.dragStart.c };
        this._clearSelection();
        this.dragStart = null;
        this._attemptSwap(from, target);
      }
    }
  }

  _onPointerUp() { /* Tap-Auswahl bleibt bis zum nächsten Zug bestehen */ }

  _isAdjacent(a, b) {
    const dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
    return (dr + dc) === 1;
  }

  _setSelection(r, c) {
    this._clearSelection();
    this.selected = { r, c };
    const cell = this.grid[r][c];
    if (cell) this.gemEls.get(cell.id).classList.add('selected');
  }

  _clearSelection() {
    if (this.selected) {
      const cell = this.grid[this.selected.r][this.selected.c];
      if (cell) {
        const el = this.gemEls.get(cell.id);
        if (el) el.classList.remove('selected');
      }
    }
    this.selected = null;
  }

  /* ---------- Zug-Ausführung ---------- */
  async _attemptSwap(a, b) {
    if (this.busy || this.ended) return;
    this.busy = true;
    const snapshot = this._captureSnapshot();
    this._swapData(a, b);
    this._animateSwap(a, b);
    await wait(220);

    const aCell = this.grid[a.r][a.c];
    const bCell = this.grid[b.r][b.c];
    const specialTriggered = (aCell && aCell.special) || (bCell && bCell.special);
    let matches = this._findMatches();

    if (matches.groups.length === 0 && !specialTriggered) {
      // ungültiger Zug -> zurück tauschen
      SoundManager.swapInvalid();
      this._shake(a); this._shake(b);
      this._swapData(a, b);
      this._animateSwap(a, b);
      await wait(220);
      this.busy = false;
      return;
    }

    // gültiger Zug: Zug verbrauchen, Rücknahme-Punkt setzen
    this.lastSnapshot = snapshot;
    if (this.mode === 'level') this.movesLeft = Math.max(0, this.movesLeft - 1);
    this.combo = 1;

    if (specialTriggered) {
      await this._triggerSwapSpecials(a, b, aCell, bCell);
    }

    await this._resolveCascades(b);
    this.busy = false;
    this._checkEndConditions();
    this._notifyUpdate();
  }

  _shake(pos) {
    const cell = this.grid[pos.r][pos.c];
    if (!cell) return;
    const el = this.gemEls.get(cell.id);
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 320);
  }

  _swapData(a, b) {
    const tmp = this.grid[a.r][a.c];
    this.grid[a.r][a.c] = this.grid[b.r][b.c];
    this.grid[b.r][b.c] = tmp;
  }

  _animateSwap(a, b) {
    const ca = this.grid[a.r][a.c];
    const cb = this.grid[b.r][b.c];
    if (ca) this._placeEl(this.gemEls.get(ca.id), a.r, a.c);
    if (cb) this._placeEl(this.gemEls.get(cb.id), b.r, b.c);
  }

  /* Spezial-Effekte, die direkt durch einen Tausch ausgelöst werden */
  async _triggerSwapSpecials(a, b, aCell, bCell) {
    SoundManager.special();
    const toClear = new Set();
    const addLine = (r, c, vert) => {
      for (let i = 0; i < this.size; i++) {
        toClear.add(vert ? `${i},${c}` : `${r},${i}`);
      }
    };
    const addArea = (r, c) => {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) toClear.add(`${nr},${nc}`);
        }
    };
    const addColor = (type) => {
      for (let r = 0; r < this.size; r++)
        for (let c = 0; c < this.size; c++) {
          const cell = this.grid[r][c];
          if (cell && cell.type === type) toClear.add(`${r},${c}`);
        }
    };

    const handleOne = (pos, cell, otherCell) => {
      if (!cell || !cell.special) return;
      if (cell.special === 'lineH') { addLine(pos.r, pos.c, false); this.runStats.lines++; this._showPraise(PRAISE_LINE[rnd(PRAISE_LINE.length)]); }
      else if (cell.special === 'lineV') { addLine(pos.r, pos.c, true); this.runStats.lines++; this._showPraise(PRAISE_LINE[rnd(PRAISE_LINE.length)]); }
      else if (cell.special === 'bomb') { addArea(pos.r, pos.c); this.runStats.bombs++; this._showPraise(PRAISE_BOMB[rnd(PRAISE_BOMB.length)]); }
      else if (cell.special === 'rainbow') {
        const target = otherCell && !otherCell.special ? otherCell.type : this._randomType();
        addColor(target);
        this.runStats.rainbows++;
        this._showPraise(PRAISE_RAINBOW[rnd(PRAISE_RAINBOW.length)]);
      }
      this._screenShake();
      toClear.add(`${pos.r},${pos.c}`);
    };
    handleOne(a, aCell, bCell);
    handleOne(b, bCell, aCell);

    // doppelte Spezial-Kombination: beide Positionen zusätzlich löschen
    const cells = [...toClear].map((k) => k.split(',').map(Number));
    this._clearCells(cells, 1.4);
    await wait(120);
    await this._applyGravityAndRefill();
    this._deliverKeys();
    await wait(180);
  }

  /* ---------- Match-Erkennung ---------- */
  _findMatches() {
    const n = this.size;
    const horizontal = Array.from({ length: n }, () => Array(n).fill(false));
    const vertical = Array.from({ length: n }, () => Array(n).fill(false));

    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c <= n; c++) {
        const same = c < n && this.grid[r][c] && this.grid[r][c - 1] &&
          this.grid[r][c].type === this.grid[r][c - 1].type &&
          this.grid[r][c].special !== 'rainbow' && this.grid[r][c - 1].special !== 'rainbow' &&
          !this.grid[r][c].key && !this.grid[r][c - 1].key;
        if (same) run++;
        else {
          if (run >= 3) for (let k = c - run; k < c; k++) horizontal[r][k] = true;
          run = 1;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r <= n; r++) {
        const same = r < n && this.grid[r][c] && this.grid[r - 1][c] &&
          this.grid[r][c].type === this.grid[r - 1][c].type &&
          this.grid[r][c].special !== 'rainbow' && this.grid[r - 1][c].special !== 'rainbow' &&
          !this.grid[r][c].key && !this.grid[r - 1][c].key;
        if (same) run++;
        else {
          if (run >= 3) for (let k = r - run; k < r; k++) vertical[k][c] = true;
          run = 1;
        }
      }
    }

    const matched = [];
    const intersections = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (horizontal[r][c] || vertical[r][c]) matched.push([r, c]);
        if (horizontal[r][c] && vertical[r][c]) intersections.push([r, c]);
      }
    }
    return { groups: matched, horizontal, vertical, intersections };
  }

  _runLength(map, r, c, dr, dc) {
    let count = 0;
    let rr = r, cc = c;
    while (rr >= 0 && rr < this.size && cc >= 0 && cc < this.size && map[rr][cc]) {
      count++; rr += dr; cc += dc;
    }
    return count;
  }

  /* Bestimmt Spezial-Erzeugungen für die aktuelle Matchrunde */
  _computeSpecialSpawns(matchInfo, preferredPos) {
    const spawns = []; // {r,c,special,type}
    const { horizontal, vertical, intersections } = matchInfo;
    const usedIntersections = new Set(intersections.map(([r, c]) => `${r},${c}`));

    intersections.forEach(([r, c]) => {
      spawns.push({ r, c, special: 'bomb', type: this.grid[r][c].type });
    });

    // horizontale Läufe analysieren
    for (let r = 0; r < this.size; r++) {
      let c = 0;
      while (c < this.size) {
        if (!horizontal[r][c]) { c++; continue; }
        let start = c;
        while (c < this.size && horizontal[r][c] &&
          this.grid[r][c] && this.grid[r][start] &&
          this.grid[r][c].type === this.grid[r][start].type) c++;
        const len = c - start;
        if (len >= 4) {
          let spot = null;
          for (let k = start; k < c; k++) if (usedIntersections.has(`${r},${k}`)) spot = k;
          if (spot === null) {
            if (preferredPos && preferredPos.r === r && preferredPos.c >= start && preferredPos.c < c) spot = preferredPos.c;
            else spot = start + Math.floor(len / 2);
          }
          if (!usedIntersections.has(`${r},${spot}`)) {
            spawns.push({ r, c: spot, special: len >= 5 ? 'rainbow' : 'lineV', type: this.grid[r][spot].type });
          }
        }
        c = Math.max(c, start + 1);
      }
    }
    // vertikale Läufe analysieren
    for (let c = 0; c < this.size; c++) {
      let r = 0;
      while (r < this.size) {
        if (!vertical[r][c]) { r++; continue; }
        let start = r;
        while (r < this.size && vertical[r][c] &&
          this.grid[r][c] && this.grid[start][c] &&
          this.grid[r][c].type === this.grid[start][c].type) r++;
        const len = r - start;
        if (len >= 4) {
          let spot = null;
          for (let k = start; k < r; k++) if (usedIntersections.has(`${k},${c}`)) spot = k;
          if (spot === null) {
            if (preferredPos && preferredPos.c === c && preferredPos.r >= start && preferredPos.r < r) spot = preferredPos.r;
            else spot = start + Math.floor(len / 2);
          }
          if (!usedIntersections.has(`${spot},${c}`)) {
            spawns.push({ r: spot, c, special: len >= 5 ? 'rainbow' : 'lineH', type: this.grid[spot][c].type });
          }
        }
        r = Math.max(r, start + 1);
      }
    }
    return spawns;
  }

  /* Entfernt eine Liste von Zellen (Score, Eis-Logik, Spezial-Trigger einbezogen) */
  _clearCells(cellsArr, multiplier) {
    let count = 0;
    const toChainSpecials = [];
    for (let clearIdx = 0; clearIdx < cellsArr.length; clearIdx++) {
      const [r, c] = cellsArr[clearIdx];
      const cell = this.grid[r][c];
      if (!cell) continue;
      if (cell.key) continue; // Schlüssel-Kristalle sind immun — müssen zum unteren Rand transportiert werden
      if (cell.iceLevel > 0) {
        cell.iceLevel--;
        const el = this.gemEls.get(cell.id);
        if (cell.iceLevel === 0) {
          this.iceCleared++;
          if (el) {
            const ov = el.querySelector('.ice-overlay');
            if (ov) { ov.classList.add('cracked'); setTimeout(() => ov.remove(), 300); }
          }
        } else if (el) {
          const ov = el.querySelector('.ice-overlay');
          if (ov) ov.classList.remove('frost');
        }
        continue; // Kristall bleibt erhalten, nur eine Eisschicht bricht
      }
      if (cell.cageLevel > 0) {
        cell.cageLevel--;
        this.cagesCleared++;
        const el = this.gemEls.get(cell.id);
        if (el) {
          const ov = el.querySelector('.cage-overlay');
          if (ov) { ov.classList.add('breaking'); setTimeout(() => ov.remove(), 320); }
        }
        continue; // Kristall bleibt erhalten, der Käfig bricht auf
      }
      if (cell.special && cell.special !== 'rainbow') {
        toChainSpecials.push({ r, c, special: cell.special, cell });
        if (cell.special === 'lineH' || cell.special === 'lineV') this.runStats.lines++;
        if (cell.special === 'bomb') this.runStats.bombs++;
      }
      if (cell.special === 'rainbow') this.runStats.rainbows++;
      count++;
      if (this.runStats.typeCleared[cell.type] !== undefined) this.runStats.typeCleared[cell.type]++;
      // Nachvollziehbarkeit: jeder Kristall einer Verschmelzung verschwindet
      // leicht zeitversetzt (statt alle gleichzeitig), damit erkennbar bleibt,
      // welche einzelnen Steine gerade zusammengefallen sind.
      const el = this.gemEls.get(cell.id);
      const staggerDelay = Math.min(clearIdx * 45, 160);
      if (el) {
        setTimeout(() => el.classList.add('removing'), staggerDelay);
        setTimeout(() => el.remove(), staggerDelay + 420);
      }
      setTimeout(() => this._burstParticles(r, c, cell.type), staggerDelay);
      this.gemEls.delete(cell.id);
      this.grid[r][c] = null;
    }
    if (count > 0) {
      const gained = Math.round(count * 10 * multiplier);
      this.score += gained;
      const [fr, fc] = cellsArr[Math.floor(cellsArr.length / 2)];
      this._floatText(fr, fc, '+' + gained, multiplier > 1.5 ? '#ffb84f' : '#ffffff');
      SoundManager.match(multiplier);
    }
    // verkettete Spezial-Effekte (Kettenreaktion), einmalig ausführen
    toChainSpecials.forEach(({ r, c, special }) => {
      const extra = new Set();
      if (special === 'lineH') for (let i = 0; i < this.size; i++) extra.add(`${r},${i}`);
      if (special === 'lineV') for (let i = 0; i < this.size; i++) extra.add(`${i},${c}`);
      if (special === 'bomb') {
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) extra.add(`${nr},${nc}`);
          }
      }
      if (extra.size) {
        const arr = [...extra].map((k) => k.split(',').map(Number));
        this._clearCells(arr, multiplier * 1.2);
      }
    });
    return count;
  }

  async _resolveCascades(preferredPos) {
    let first = true;
    while (true) {
      const matchInfo = this._findMatches();
      if (matchInfo.groups.length === 0) break;
      const spawns = this._computeSpecialSpawns(matchInfo, first ? preferredPos : null);
      first = false;

      const spawnMap = new Map(spawns.map((s) => [`${s.r},${s.c}`, s]));
      const cellsToClear = matchInfo.groups.filter(([r, c]) => !spawnMap.has(`${r},${c}`));

      this._clearCells(cellsToClear, this.combo);

      // Spezial-Kristalle an berechneten Positionen einsetzen (ersetzen bestehenden Kristall)
      spawns.forEach(({ r, c, special, type }) => {
        const old = this.grid[r][c];
        if (old) {
          if (old.iceLevel > 0) {
            old.iceLevel--;
            if (old.iceLevel === 0) this.iceCleared++;
          }
          if (old.cageLevel > 0) {
            old.cageLevel--;
            this.cagesCleared++;
          }
          this.gemEls.get(old.id)?.remove();
          this.gemEls.delete(old.id);
        }
        const gem = this._makeGem(type);
        gem.special = special;
        this.grid[r][c] = gem;
        const el = this._createEl(gem, r, c);
        el.classList.add('selected');
        setTimeout(() => el.classList.remove('selected'), 260);
      });

      this.combo++;
      this.runStats.maxCombo = Math.max(this.runStats.maxCombo, this.combo);
      if (this.combo === 3) this._showPraise(PRAISE_COMBO[rnd(PRAISE_COMBO.length)]);
      else if (this.combo >= 4) { this._showPraise('x' + this.combo + ' Kombo!'); this._screenShake(); }
      await wait(320);
      await this._applyGravityAndRefill();
      this._deliverKeys();
      await wait(200);
    }
    if (!this._hasAnyValidMove()) {
      await wait(300);
      this._reshuffleBoard();
      this._renderAll();
      await wait(150);
    }
  }

  /* ---------- Schwerkraft & Nachfüllen ---------- */
  async _applyGravityAndRefill() {
    const n = this.size;
    for (let c = 0; c < n; c++) {
      const col = [];
      for (let r = n - 1; r >= 0; r--) if (this.grid[r][c]) col.push(this.grid[r][c]);
      let writeR = n - 1;
      for (const cell of col) {
        this.grid[writeR][c] = cell;
        writeR--;
      }
      for (let r = writeR; r >= 0; r--) {
        const gem = this._makeGem(this._randomType());
        this.grid[r][c] = gem;
      }
    }
    // Positionen aktualisieren + neue Elemente für neu erzeugte Gems erstellen
    for (let c = 0; c < n; c++) {
      for (let r = 0; r < n; r++) {
        const cell = this.grid[r][c];
        let el = this.gemEls.get(cell.id);
        if (!el) {
          el = this._createEl(cell, r, c);
          // Startposition oberhalb des Bretts für Fall-Animation
          const above = -this.cellSize * (2 + rnd(3));
          el.style.top = above + 'px';
          void el.offsetHeight; // Reflow erzwingen
        }
        this._placeEl(el, r, c);
      }
    }
    await wait(260);
  }

  /* ---------- Deadlock-Erkennung & Reshuffle ---------- */
  _hasAnyValidMove() {
    const n = this.size;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && this._testSwapCreatesMatch(r, c, r, c + 1)) return true;
        if (r < n - 1 && this._testSwapCreatesMatch(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  _testSwapCreatesMatch(r1, c1, r2, c2) {
    if (!this.grid[r1][c1] || !this.grid[r2][c2]) return false;
    if (this.grid[r1][c1].special === 'rainbow' || this.grid[r2][c2].special === 'rainbow') return true;
    const tmp = this.grid[r1][c1];
    this.grid[r1][c1] = this.grid[r2][c2];
    this.grid[r2][c2] = tmp;
    const info = this._findMatches();
    const ok = info.groups.length > 0;
    const tmp2 = this.grid[r1][c1];
    this.grid[r1][c1] = this.grid[r2][c2];
    this.grid[r2][c2] = tmp2;
    return ok;
  }

  _reshuffleBoard() {
    const types = [];
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.grid[r][c]) types.push(this.grid[r][c].type);
    for (let i = types.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [types[i], types[j]] = [types[j], types[i]];
    }
    let idx = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const old = this.grid[r][c];
        const gem = this._makeGem(types[idx++]);
        gem.iceLevel = old ? old.iceLevel : 0;
        gem.cageLevel = old ? old.cageLevel : 0;
        gem.key = old ? old.key : false;
        this.grid[r][c] = gem;
      }
    }
    if (!this._hasAnyValidMove()) this._buildInitialGrid();
  }

  /* ---------- Joker: Rückgängig & Auto-Zug ---------- */
  _captureSnapshot() {
    return {
      grid: this.grid.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
      score: this.score,
      movesLeft: this.movesLeft,
      iceCleared: this.iceCleared,
      cagesCleared: this.cagesCleared
    };
  }

  undoLastMove() {
    if (!this.lastSnapshot || this.busy) return false;
    const snap = this.lastSnapshot;
    this.grid = snap.grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
    this.score = snap.score;
    this.movesLeft = snap.movesLeft;
    this.iceCleared = snap.iceCleared;
    this.cagesCleared = snap.cagesCleared;
    this.combo = 1;
    this.ended = false;
    this.lastSnapshot = null;
    this._clearSelection();
    this._renderAll();
    this._notifyUpdate();
    return true;
  }

  _findAnyValidMove() {
    const n = this.size;
    const candidates = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && this._testSwapCreatesMatch(r, c, r, c + 1)) {
          candidates.push([{ r, c }, { r, c: c + 1 }]);
        }
        if (r < n - 1 && this._testSwapCreatesMatch(r, c, r + 1, c)) {
          candidates.push([{ r, c }, { r: r + 1, c }]);
        }
      }
    }
    if (!candidates.length) return null;
    return candidates[rnd(candidates.length)];
  }

  async playAutoMove() {
    if (this.busy || this.ended) return false;
    const move = this._findAnyValidMove();
    if (!move) return false;
    await this._attemptSwap(move[0], move[1]);
    return true;
  }

  /* Farbwechsler-Joker: verwandelt einen angetippten Kristall in die unter
     seinen Nachbarn häufigste Farbe (löst dadurch oft direkt ein Match aus). */
  async applyColorJoker(r, c) {
    if (this.busy || this.ended || !this.grid[r][c] || this.grid[r][c].key) return false;
    this.busy = true;
    const cell = this.grid[r][c];
    const neighborTypes = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([nr, nc]) => nr >= 0 && nr < this.size && nc >= 0 && nc < this.size && this.grid[nr][nc] && !this.grid[nr][nc].special)
      .map(([nr, nc]) => this.grid[nr][nc].type);
    let newType = this._randomType();
    if (neighborTypes.length) {
      const counts = {};
      neighborTypes.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
      newType = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
    cell.type = newType;
    cell.special = null;
    const el = this.gemEls.get(cell.id);
    if (el) {
      el.className = 'gem t-' + newType;
      this._applySpecialClass(el, null);
    }
    this._showPraise('Farbwechsel!');
    this.combo = 1;
    await this._resolveCascades({ r, c });
    this.busy = false;
    this._checkEndConditions();
    this._notifyUpdate();
    return true;
  }

  /* Extra-Zug-Joker: schenkt sofort zusätzliche Züge im Level-Modus. */
  useExtraMoveJoker() {
    if (this.mode !== 'level' || this.ended) return false;
    this.movesLeft += 3;
    this._showPraise('+3 Züge!');
    this._notifyUpdate();
    return true;
  }

  /* ---------- Ende-Bedingungen ---------- */
  _checkEndConditions() {
    if (this.ended || this.mode !== 'level') return;
    const cfg = this.config;
    let goalReached;
    if (cfg.objective === 'ice') goalReached = this.iceCleared >= cfg.iceTarget;
    else if (cfg.objective === 'keys') goalReached = this.keysDelivered >= cfg.keysTarget;
    else if (cfg.objective === 'cages') goalReached = this.cagesCleared >= cfg.cagesTarget;
    else goalReached = this.score >= cfg.target;
    // Absicherung gegen einen zu frühen Zufalls-Sieg: ein Punkte-Level gilt
    // erst als geschafft, nachdem mindestens 4 Züge gespielt wurden (oder
    // die Züge komplett aufgebraucht sind) — selbst eine sehr glückliche
    // Kettenreaktion in den ersten ein/zwei Zügen reicht dafür nicht.
    if (cfg.objective === 'score' && goalReached) {
      const usedMoves = cfg.moves - this.movesLeft;
      const minMoves = Math.min(4, cfg.moves);
      if (usedMoves < minMoves && this.movesLeft > 0) goalReached = false;
    }
    if (goalReached) {
      this.ended = true;
      SoundManager.win();
      this.onEnd && this.onEnd(true);
      return;
    }
    if (this.movesLeft <= 0) {
      this.ended = true;
      SoundManager.lose();
      this.onEnd && this.onEnd(false);
    }
  }

  _notifyUpdate() {
    this.onUpdate && this.onUpdate({
      score: this.score,
      movesLeft: this.movesLeft,
      iceCleared: this.iceCleared,
      cagesCleared: this.cagesCleared,
      combo: this.combo
    });
  }

  /* Ruhige Überraschungs-Effekte: unabhängig von Zügen/Matches passiert
     gelegentlich etwas auf dem Spielfeld — mal ein Funkeln, mal ein kurzes
     Wackeln, mal ein Aufblitzen eines zufälligen Kristalls. Rein dekorativ,
     ohne Einfluss auf das Spielgeschehen, hält das Feld aber lebendig. */
  _spawnSparkle() {
    if (this.ended || !this.boardEl.isConnected) return;
    const roll = Math.random();
    if (roll < 0.55) this._ambientTwinkle();
    else if (roll < 0.8) this._ambientWiggle();
    else this._ambientFlash();
  }
  _ambientTwinkle() {
    const r = rnd(this.size);
    const c = rnd(this.size);
    const cell = this.grid[r] && this.grid[r][c];
    if (!cell) return;
    const el = document.createElement('div');
    el.className = 'twinkle';
    const cx = c * this.cellSize + this.cellSize * (0.25 + Math.random() * 0.5);
    const cy = r * this.cellSize + this.cellSize * (0.25 + Math.random() * 0.5);
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    this.fxEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
  _ambientWiggle() {
    const r = rnd(this.size);
    const c = rnd(this.size);
    const cell = this.grid[r] && this.grid[r][c];
    if (!cell || this.busy) return;
    const el = this.gemEls.get(cell.id);
    if (!el) return;
    el.classList.add('ambient-wiggle');
    setTimeout(() => el.classList.remove('ambient-wiggle'), 520);
  }
  _ambientFlash() {
    const r = rnd(this.size);
    const c = rnd(this.size);
    const cell = this.grid[r] && this.grid[r][c];
    if (!cell) return;
    const el = this.gemEls.get(cell.id);
    const shape = el && el.querySelector('.gem-shape');
    if (!shape) return;
    shape.classList.add('ambient-flash');
    setTimeout(() => shape.classList.remove('ambient-flash'), 720);
  }

  destroy() {
    window.removeEventListener('resize', this._resizeHandler);
    clearInterval(this._sparkleTimer);
  }
}

/* ============================================================
   APP / UI-STEUERUNG
   ============================================================ */
const Screens = {
  els: {},
  init() {
    document.querySelectorAll('.screen').forEach((el) => (this.els[el.id] = el));
  },
  show(id) {
    Object.values(this.els).forEach((el) => el.classList.remove('active'));
    this.els[id].classList.add('active');
  }
};

const Overlays = {
  show(id) { document.getElementById(id).classList.add('active'); },
  hide(id) { document.getElementById(id).classList.remove('active'); }
};

let currentGame = null;
let currentLevelIndex = 1;
let currentMode = 'level';
let levelMapRangeStart = 1;

function updateHomeStats() {
  const el = document.getElementById('home-stats');
  const totalStars = Object.values(saveData.stars).reduce((a, b) => a + b, 0);
  const played = saveData.unlocked - 1;
  el.innerHTML = `
    <div>Level<b>${played}</b></div>
    <div>Sterne<b>${totalStars}</b></div>
    <div>Zen-Bestwert<b>${saveData.zenBest}</b></div>
  `;
  document.querySelectorAll('.diff-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.diff === saveData.difficulty);
  });
  applyWorldTheme(worldForLevel(saveData.unlocked));
}

const LEVEL_MAP_PAGE = 40;

function buildLevelMap() {
  levelMapRangeStart = Math.max(1, saveData.unlocked - LEVEL_MAP_PAGE + 1);
  renderLevelMap(true);
}

function renderLevelMap(scrollToCurrent) {
  const path = document.getElementById('level-path');
  path.innerHTML = '';

  if (levelMapRangeStart > 1) {
    const loadMore = document.createElement('button');
    loadMore.className = 'load-more-btn';
    loadMore.textContent = 'Frühere Level laden';
    loadMore.addEventListener('click', () => {
      SoundManager.button();
      levelMapRangeStart = Math.max(1, levelMapRangeStart - LEVEL_MAP_PAGE);
      renderLevelMap(false);
    });
    path.appendChild(loadMore);
  }

  for (let i = levelMapRangeStart; i <= saveData.unlocked; i++) {
    const node = document.createElement('div');
    const current = i === saveData.unlocked;
    node.className = 'level-node' + (current ? ' current' : '');
    node.textContent = i;
    const stars = saveData.stars[i] || 0;
    const starsEl = document.createElement('div');
    starsEl.className = 'lv-stars';
    starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    node.appendChild(starsEl);
    node.addEventListener('click', () => {
      SoundManager.button();
      startLevel(i);
    });
    path.appendChild(node);
  }
  if (scrollToCurrent) {
    requestAnimationFrame(() => {
      const scroller = document.getElementById('level-scroll');
      scroller.scrollTop = scroller.scrollHeight;
    });
  }
}

function objectiveLabel(cfg) {
  if (cfg.objective === 'ice') return 'Eiskristalle';
  if (cfg.objective === 'keys') return 'Schlüssel';
  if (cfg.objective === 'cages') return 'Käfige';
  return 'Punkte';
}

function updateJokerUI() {
  const undoBtn = document.getElementById('btn-joker-undo');
  const autoBtn = document.getElementById('btn-joker-auto');
  const colorBtn = document.getElementById('btn-joker-color');
  const extraBtn = document.getElementById('btn-joker-extra');
  document.getElementById('joker-undo-count').textContent = saveData.jokers.undo;
  document.getElementById('joker-auto-count').textContent = saveData.jokers.auto;
  document.getElementById('joker-color-count').textContent = saveData.jokers.color;
  document.getElementById('joker-extra-count').textContent = saveData.jokers.extra;
  const busy = !currentGame || currentGame.busy || currentGame.ended;
  undoBtn.disabled = busy || saveData.jokers.undo <= 0 || !currentGame || !currentGame.lastSnapshot;
  autoBtn.disabled = busy || saveData.jokers.auto <= 0;
  colorBtn.disabled = busy || saveData.jokers.color <= 0;
  extraBtn.disabled = busy || saveData.jokers.extra <= 0 || (currentGame && currentGame.mode !== 'level');
  colorBtn.classList.toggle('active', !!(currentGame && currentGame.pendingJoker === 'color'));
}

let scoreTweenState = { raf: null, shown: 0 };
function tweenScoreTo(el, target) {
  if (scoreTweenState.raf) cancelAnimationFrame(scoreTweenState.raf);
  const start = scoreTweenState.shown;
  const diff = target - start;
  if (diff === 0) { el.textContent = target; return; }
  const duration = clamp(Math.abs(diff) * 4, 120, 500);
  const t0 = performance.now();
  function step(now) {
    const p = clamp((now - t0) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - p, 2);
    const value = Math.round(start + diff * eased);
    el.textContent = value;
    scoreTweenState.shown = value;
    if (p < 1) scoreTweenState.raf = requestAnimationFrame(step);
  }
  scoreTweenState.raf = requestAnimationFrame(step);
}

function updateHud(cfg) {
  const goalVal = document.getElementById('hud-goal-value');
  const progFill = document.getElementById('hud-progress-fill');
  const movesVal = document.getElementById('hud-moves-value');
  const movesLabel = document.getElementById('hud-moves-label');
  const scoreVal = document.getElementById('hud-score');
  const comboBadge = document.getElementById('combo-badge');

  tweenScoreTo(scoreVal, currentGame.score);

  if (currentGame.mode === 'level') {
    document.getElementById('hud-goal-label').textContent = objectiveLabel(cfg);
    let current = currentGame.score, target = cfg.target;
    if (cfg.objective === 'ice') { current = currentGame.iceCleared; target = cfg.iceTarget; }
    else if (cfg.objective === 'keys') { current = currentGame.keysDelivered; target = cfg.keysTarget; }
    else if (cfg.objective === 'cages') { current = currentGame.cagesCleared; target = cfg.cagesTarget; }
    goalVal.textContent = `${Math.min(current, target)} / ${target}`;
    progFill.style.width = clamp((current / target) * 100, 0, 100) + '%';
    movesVal.textContent = currentGame.movesLeft;
    movesLabel.textContent = 'Züge';
  } else {
    document.getElementById('hud-goal-label').textContent = 'Rekord';
    goalVal.textContent = saveData.zenBest;
    progFill.style.width = clamp((currentGame.score / Math.max(saveData.zenBest, 1)) * 100, 0, 100) + '%';
    movesVal.textContent = '∞';
    movesLabel.textContent = 'Züge';
  }

  if (currentGame.combo > 1) {
    comboBadge.textContent = 'Kombo x' + currentGame.combo.toFixed(1).replace('.0', '');
    comboBadge.classList.add('show');
  } else {
    comboBadge.classList.remove('show');
  }
  updateJokerUI();
}

function buildObjectiveLegend(cfg) {
  const el = document.getElementById('objective-legend');
  el.innerHTML = '';
  const items = [];
  if (cfg.iceCount > 0 || cfg.objective === 'ice') {
    items.push('<span class="legend-swatch legend-ice"></span>Eis blockiert Felder');
  }
  if (cfg.frostRatio > 0) {
    items.push('<span class="legend-swatch legend-ice"></span>Frost braucht 2 Treffer');
  }
  if (cfg.objective === 'keys') {
    items.push('🔑 Schlüssel zum unteren Rand transportieren');
  }
  if (cfg.cagesCount > 0 || cfg.objective === 'cages') {
    items.push('<span class="legend-swatch legend-cage"></span>Käfige brauchen einen Treffer zum Aufbrechen');
  }
  items.push('<span class="legend-swatch legend-line"></span>4er = Blitz');
  items.push('<span class="legend-swatch legend-bomb"></span>L/T = Bombe');
  items.push('<span class="legend-swatch legend-rainbow"></span>5er = Stern');
  el.innerHTML = items.map((t) => `<span>${t}</span>`).join('');
}

function applyBossUI(cfg) {
  const board = document.getElementById('board');
  const banner = document.getElementById('boss-banner');
  board.classList.toggle('boss-board', !!cfg.isBoss);
  if (banner) banner.style.display = cfg.isBoss ? 'block' : 'none';
}

function startLevel(index) {
  scoreTweenState.shown = 0;
  currentLevelIndex = index;
  currentMode = 'level';
  const cfg = buildLevel(index, saveData.difficulty);
  applyWorldTheme(cfg.world);
  Screens.show('screen-game');
  const boardEl = document.getElementById('board');
  const fxEl = document.getElementById('board-fx');
  if (currentGame) currentGame.destroy();
  currentGame = new Game(boardEl, fxEl, cfg, 'level');
  applyBossUI(cfg);
  buildObjectiveLegend(cfg);
  currentGame.onUpdate = () => updateHud(cfg);
  currentGame.onEnd = (won) => onLevelEnd(cfg, won);
  updateHud(cfg);
}

function startZen() {
  scoreTweenState.shown = 0;
  currentMode = 'zen';
  const cfg = buildLevel(20, saveData.difficulty);
  cfg.objective = 'score';
  cfg.keysCount = 0;
  cfg.keysTarget = 0;
  applyWorldTheme(worldForLevel(saveData.unlocked));
  Screens.show('screen-game');
  const boardEl = document.getElementById('board');
  const fxEl = document.getElementById('board-fx');
  if (currentGame) currentGame.destroy();
  currentGame = new Game(boardEl, fxEl, cfg, 'zen');
  applyBossUI(cfg);
  buildObjectiveLegend(cfg);
  currentGame.onUpdate = () => {
    updateHud(cfg);
    if (currentGame.score > saveData.zenBest) {
      saveData.zenBest = currentGame.score;
      Storage.save(saveData);
    }
  };
  updateHud(cfg);
}

/* ---------- Tages-Herausforderung ----------
   Nutzt einen einfachen, deterministischen Zufallsgenerator, der aus dem
   heutigen Datum "gesät" wird — dadurch bekommt jeder, der an einem Tag
   spielt, exakt dasselbe Ausgangsfeld (fair vergleichbarer Highscore). */
function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function dateSeed(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return hash || 1;
}

function startDaily() {
  scoreTweenState.shown = 0;
  currentMode = 'daily';
  const today = todayStr();
  const cfg = buildLevel(15, saveData.difficulty);
  cfg.objective = 'score';
  cfg.keysCount = 0;
  cfg.keysTarget = 0;
  cfg.isDaily = true;
  applyWorldTheme(WORLDS[dateSeed(today) % WORLDS.length]);
  Screens.show('screen-game');
  const boardEl = document.getElementById('board');
  const fxEl = document.getElementById('board-fx');
  if (currentGame) currentGame.destroy();

  // Zufallsgenerator nur für den Spielfeld-Aufbau durch den Tages-Seed ersetzen
  const originalRandom = Math.random;
  Math.random = seededRng(dateSeed(today));
  currentGame = new Game(boardEl, fxEl, cfg, 'level');
  Math.random = originalRandom;

  applyBossUI(cfg);
  buildObjectiveLegend(cfg);
  currentGame.onUpdate = () => updateHud(cfg);
  currentGame.onEnd = (won) => onLevelEnd(cfg, won);
  updateHud(cfg);
}

function starsForScore(cfg, score) {
  if (score >= cfg.starThresholds[2]) return 3;
  if (score >= cfg.starThresholds[1]) return 2;
  if (score >= cfg.starThresholds[0]) return 1;
  return 0;
}

function mergeRunStats(game) {
  const s = saveData.stats;
  s.totalScore += game.score;
  s.bestCombo = Math.max(s.bestCombo, game.runStats.maxCombo);
  s.bombs += game.runStats.bombs;
  s.lines += game.runStats.lines;
  s.rainbows += game.runStats.rainbows;
  Object.keys(game.runStats.typeCleared).forEach((t) => {
    s.typeCleared[t] = (s.typeCleared[t] || 0) + game.runStats.typeCleared[t];
  });
}

function announceAchievements() {
  const unlockedNow = checkAchievements();
  if (unlockedNow.length && currentGame) {
    setTimeout(() => currentGame._showPraise('🏆 ' + unlockedNow[0].name), 900);
  }
}

/* Persönliche Bestenliste: merkt sich die letzten 5 Punktestände (jeder
   Modus zählt) und erkennt einen neuen persönlichen Bestwert für den
   größeren Highscore-Jubel. */
function recordScoreHistory(score) {
  if (!saveData.scoreHistory) saveData.scoreHistory = [];
  saveData.scoreHistory.unshift(score);
  saveData.scoreHistory = saveData.scoreHistory.slice(0, 5);
}

function celebrateNewHighscore() {
  const banner = document.getElementById('result-highscore');
  if (!banner) return;
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  const host = document.getElementById('overlay-result');
  const modal = host ? host.querySelector('.modal') : null;
  if (!modal) return;
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = Math.random() * 100 + '%';
    p.style.setProperty('--fall-delay', (Math.random() * 0.5) + 's');
    p.style.setProperty('--fall-dur', (1.4 + Math.random() * 1.1) + 's');
    p.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
    p.style.background = [ '#ffd23f', '#ff5da2', '#39d6ff', '#8f6bff', '#4fd6a0' ][i % 5];
    modal.appendChild(p);
    setTimeout(() => p.remove(), 2700);
  }
  SoundManager.win();
}

function onLevelEnd(cfg, won) {
  const title = document.getElementById('result-title');
  const starsWrap = document.getElementById('result-stars');
  const scoreP = document.getElementById('result-score');
  const bonusP = document.getElementById('result-bonus');
  const nextBtn = document.getElementById('btn-result-next');
  const highscoreBanner = document.getElementById('result-highscore');
  bonusP.textContent = '';
  if (highscoreBanner) highscoreBanner.classList.remove('show');
  const milestoneBanner = document.getElementById('result-milestone');
  if (milestoneBanner) { milestoneBanner.classList.remove('show'); milestoneBanner.textContent = ''; }

  if (won) {
    title.textContent = cfg.isDaily ? 'Tages-Challenge geschafft!' : (cfg.isBoss ? 'Boss-Level bezwungen!' : 'Level geschafft!');
    const movesBonus = currentGame.movesLeft * 25;
    const usedMoves = cfg.moves - currentGame.movesLeft;
    const perfectBonus = usedMoves <= Math.ceil(cfg.moves * 0.5) ? 300 : 0;
    const totalBonus = movesBonus + perfectBonus;
    currentGame.score += totalBonus;
    if (totalBonus > 0) {
      const parts = [];
      if (movesBonus > 0) parts.push(`+${movesBonus} für ${currentGame.movesLeft} übrige Züge`);
      if (perfectBonus > 0) parts.push(`+${perfectBonus} Perfekt-Bonus`);
      bonusP.textContent = parts.join(' · ');
    }
    const stars = starsForScore(cfg, currentGame.score);
    starsWrap.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < stars));

    mergeRunStats(currentGame);

    if (cfg.isDaily) {
      const today = todayStr();
      const prevBest = saveData.daily.history[today] || 0;
      saveData.daily.history[today] = Math.max(prevBest, currentGame.score);
      nextBtn.style.display = 'none';
    } else {
      const prevStars = saveData.stars[cfg.index] || 0;
      saveData.stars[cfg.index] = Math.max(prevStars, stars);
      if (stars === 3) saveData.stats.threeStarLevels++;
      saveData.stats.levelsCompleted++;
      const prevUnlocked = saveData.unlocked;
      if (cfg.index === saveData.unlocked) saveData.unlocked = cfg.index + 1;
      checkNewMilestone(prevUnlocked, saveData.unlocked);
      nextBtn.style.display = 'flex';
    }
    saveData.jokers.undo = Math.min(30, saveData.jokers.undo + 1);
    saveData.jokers.auto = Math.min(30, saveData.jokers.auto + 1);
    Storage.save(saveData);
    if (stars >= 3 && !cfg.isDaily) setTimeout(() => currentGame._showPraise('Perfekt!'), 150);
    announceAchievements();
  } else {
    title.textContent = 'Keine Züge mehr';
    starsWrap.querySelectorAll('.star').forEach((s) => s.classList.remove('filled'));
    nextBtn.style.display = 'none';
    mergeRunStats(currentGame);
    Storage.save(saveData);
    announceAchievements();
  }
  scoreP.textContent = 'Punkte: ' + currentGame.score;

  const isNewHighscore = currentGame.score > 0 && saveData.stats.bestScore > 0 && currentGame.score > saveData.stats.bestScore;
  saveData.stats.bestScore = Math.max(saveData.stats.bestScore, currentGame.score);
  recordScoreHistory(currentGame.score);
  Storage.save(saveData);

  setTimeout(() => {
    Overlays.show('overlay-result');
    if (isNewHighscore) setTimeout(celebrateNewHighscore, 300);
  }, 400);
}

/* ---------- Rechtliche Seiten ----------
   Der Kontaktblock steht bewusst genau EIN Mal hier und wird bei künftigen
   Weiterentwicklungen des Spiels nicht wieder angefasst. */
const IMPRESSUM_CONTACT = {
  name: '',      // z.B. "Jan Mustermann"
  street: '',    // z.B. "Musterstraße 1"
  city: '',      // z.B. "12345 Musterstadt"
  country: 'Deutschland',
  email: ''      // z.B. "kontakt@beispiel.de"
};

function renderAchievements() {
  const el = document.getElementById('achievements-list');
  el.innerHTML = ACHIEVEMENTS.map((a) => {
    const unlocked = !!saveData.achievements[a.id];
    return `
      <div class="achievement-item${unlocked ? ' unlocked' : ''}">
        <div class="achievement-badge">${unlocked ? '🏆' : '🔒'}</div>
        <div>
          <div class="achievement-name">${a.name}</div>
          <div class="achievement-desc">${a.desc}</div>
        </div>
      </div>`;
  }).join('');
}

function renderStats() {
  const el = document.getElementById('stats-content');
  const s = saveData.stats;
  const favoriteType = Object.entries(s.typeCleared).sort((a, b) => b[1] - a[1])[0];
  const favoriteName = favoriteType && favoriteType[1] > 0
    ? favoriteType[0].charAt(0).toUpperCase() + favoriteType[0].slice(1) : '–';
  const unlockedCount = Object.keys(saveData.achievements).length;
  const dailyBest = Math.max(0, ...Object.values(saveData.daily.history || {}));
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stats-card"><span class="stats-value">${s.levelsCompleted}</span><span class="stats-label">Level abgeschlossen</span></div>
      <div class="stats-card"><span class="stats-value">${s.threeStarLevels}</span><span class="stats-label">Level mit 3 Sternen</span></div>
      <div class="stats-card"><span class="stats-value">${s.totalScore.toLocaleString('de-DE')}</span><span class="stats-label">Punkte insgesamt</span></div>
      <div class="stats-card"><span class="stats-value">x${s.bestCombo}</span><span class="stats-label">Beste Kombo</span></div>
      <div class="stats-card"><span class="stats-value">${s.bombs}</span><span class="stats-label">Kristallbomben</span></div>
      <div class="stats-card"><span class="stats-value">${s.lines}</span><span class="stats-label">Kristallblitze</span></div>
      <div class="stats-card"><span class="stats-value">${s.rainbows}</span><span class="stats-label">Kristallsterne</span></div>
      <div class="stats-card"><span class="stats-value">${favoriteName}</span><span class="stats-label">Lieblingskristall</span></div>
      <div class="stats-card"><span class="stats-value">${saveData.streak.count}</span><span class="stats-label">Tage-Streak</span></div>
      <div class="stats-card"><span class="stats-value">${dailyBest.toLocaleString('de-DE')}</span><span class="stats-label">Tages-Challenge Bestwert</span></div>
      <div class="stats-card"><span class="stats-value">${unlockedCount}/${ACHIEVEMENTS.length}</span><span class="stats-label">Erfolge freigeschaltet</span></div>
      <div class="stats-card"><span class="stats-value">${saveData.zenBest.toLocaleString('de-DE')}</span><span class="stats-label">Zen-Bestwert</span></div>
      <div class="stats-card"><span class="stats-value">${(s.bestScore || 0).toLocaleString('de-DE')}</span><span class="stats-label">Persönlicher Bestwert</span></div>
    </div>
    <h3 class="stats-subheading">Bestenliste – letzte 5 Runden</h3>
    <div class="score-history">
      ${
        (saveData.scoreHistory && saveData.scoreHistory.length)
          ? saveData.scoreHistory.map((sc, i) => `
            <div class="score-history-row${sc === s.bestScore ? ' is-best' : ''}">
              <span class="score-history-rank">${i + 1}.</span>
              <span class="score-history-value">${sc.toLocaleString('de-DE')}</span>
              ${sc === s.bestScore ? '<span class="score-history-crown">🏆</span>' : ''}
            </div>`).join('')
          : '<p class="score-history-empty">Noch keine Runde gespielt.</p>'
      }
    </div>
  `;
}

function renderLegalPages() {
  const hasContact = IMPRESSUM_CONTACT.name && IMPRESSUM_CONTACT.email;
  const contactBlock = hasContact
    ? `<p>${IMPRESSUM_CONTACT.name}<br>${IMPRESSUM_CONTACT.street}<br>${IMPRESSUM_CONTACT.city}<br>${IMPRESSUM_CONTACT.country}</p><p>E-Mail: ${IMPRESSUM_CONTACT.email}</p>`
    : `<p><em>Kontaktangaben werden hier ergänzt.</em></p>`;

  document.getElementById('legal-impressum-content').innerHTML = `
    <h3>Angaben gemäß § 5 TMG</h3>
    ${contactBlock}
    <h3>Verantwortlich für den Inhalt</h3>
    ${hasContact ? `<p>${IMPRESSUM_CONTACT.name}</p>` : `<p><em>wird ergänzt</em></p>`}
    <h3>Haftungshinweis</h3>
    <p>Glyxora ist ein privates, nicht-kommerzielles Hobbyprojekt. Es werden keine
    Inhalte Dritter eingebunden, keine externen Bilder, Schriften oder Sounds
    nachgeladen und keine Daten an Server übertragen.</p>
  `;

  document.getElementById('legal-datenschutz-content').innerHTML = `
    <h3>Kurzfassung</h3>
    <p>Glyxora läuft vollständig lokal auf deinem Gerät. Es gibt keine Server-
    Kommunikation, keine Cookies, kein Tracking und keine Werbung. Es werden
    keinerlei personenbezogene Daten erhoben oder übertragen.</p>
    <h3>Lokaler Speicher (localStorage)</h3>
    <p>Dein Spielfortschritt (freigeschaltete Level, Sterne, Bestwert im
    Zen-Modus, Soundeinstellung) wird ausschließlich lokal im
    Local-Storage deines Browsers auf deinem eigenen Gerät gespeichert. Diese
    Daten verlassen dein Gerät nie und werden an niemanden übermittelt. Du
    kannst sie jederzeit über "Einstellungen → Fortschritt zurücksetzen"
    oder über die Browser-Einstellungen löschen.</p>
    <h3>Offline-Speicherung (Service Worker)</h3>
    <p>Damit das Spiel offline funktioniert, speichert dein Browser die
    Programmdateien (HTML, CSS, JavaScript, Icons) zwischen. Dabei werden
    keine personenbezogenen Daten verarbeitet.</p>
    <h3>Verantwortliche Stelle</h3>
    ${hasContact
      ? `<p>${IMPRESSUM_CONTACT.name}, ${IMPRESSUM_CONTACT.street}, ${IMPRESSUM_CONTACT.city}<br>E-Mail: ${IMPRESSUM_CONTACT.email}</p>`
      : `<p><em>Kontaktangaben werden hier ergänzt.</em></p>`}
  `;
}

/* ---------- Buttons & Navigation ---------- */
function bindUI() {
  Screens.init();

  document.querySelectorAll('.diff-btn').forEach((b) => {
    b.addEventListener('click', () => {
      SoundManager.button();
      saveData.difficulty = b.dataset.diff;
      Storage.save(saveData);
      updateHomeStats();
    });
  });

  document.getElementById('btn-joker-undo').addEventListener('click', () => {
    if (!currentGame || saveData.jokers.undo <= 0) return;
    if (currentGame.undoLastMove()) {
      saveData.jokers.undo--;
      Storage.save(saveData);
      updateJokerUI();
    }
  });
  document.getElementById('btn-joker-auto').addEventListener('click', async () => {
    if (!currentGame || saveData.jokers.auto <= 0 || currentGame.busy || currentGame.ended) return;
    saveData.jokers.auto--;
    Storage.save(saveData);
    updateJokerUI();
    await currentGame.playAutoMove();
    updateJokerUI();
  });
  document.getElementById('btn-joker-color').addEventListener('click', () => {
    if (!currentGame || saveData.jokers.color <= 0 || currentGame.busy || currentGame.ended) return;
    if (currentGame.pendingJoker === 'color') {
      currentGame.pendingJoker = null; // erneutes Tippen bricht die Auswahl ab
    } else {
      saveData.jokers.color--;
      Storage.save(saveData);
      currentGame.pendingJoker = 'color';
    }
    updateJokerUI();
  });
  document.getElementById('btn-joker-extra').addEventListener('click', () => {
    if (!currentGame || saveData.jokers.extra <= 0 || currentGame.busy || currentGame.ended) return;
    if (currentGame.useExtraMoveJoker()) {
      saveData.jokers.extra--;
      Storage.save(saveData);
      updateJokerUI();
    }
  });

  document.getElementById('btn-daily').addEventListener('click', () => {
    SoundManager.button();
    startDaily();
  });
  document.getElementById('btn-achievements').addEventListener('click', () => {
    SoundManager.button();
    renderAchievements();
    Screens.show('screen-achievements');
  });
  document.getElementById('btn-stats').addEventListener('click', () => {
    SoundManager.button();
    renderStats();
    Screens.show('screen-stats');
  });

  document.getElementById('btn-play-levels').addEventListener('click', () => {
    SoundManager.button();
    document.getElementById('screen-levels').dataset.world = worldForLevel(saveData.unlocked).name;
    buildLevelMap();
    Screens.show('screen-levels');
  });
  document.getElementById('btn-play-zen').addEventListener('click', () => {
    SoundManager.button();
    startZen();
  });
  document.getElementById('btn-howto').addEventListener('click', () => {
    SoundManager.button();
    Screens.show('screen-anleitung');
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    SoundManager.button();
    refreshSoundButtons();
    refreshDarkButton();
    Overlays.show('overlay-settings');
  });

  document.getElementById('btn-impressum').addEventListener('click', () => {
    SoundManager.button();
    Screens.show('screen-impressum');
  });
  document.getElementById('btn-datenschutz').addEventListener('click', () => {
    SoundManager.button();
    Screens.show('screen-datenschutz');
  });

  document.querySelectorAll('.back-btn').forEach((b) => {
    b.addEventListener('click', () => {
      SoundManager.button();
      Screens.show(b.dataset.back);
      updateHomeStats();
    });
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    SoundManager.button();
    refreshSoundButtons();
    Overlays.show('overlay-pause');
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    SoundManager.button();
    Overlays.hide('overlay-pause');
  });
  document.getElementById('btn-restart-level').addEventListener('click', () => {
    SoundManager.button();
    Overlays.hide('overlay-pause');
    if (currentMode === 'level') startLevel(currentLevelIndex);
    else if (currentMode === 'daily') startDaily();
    else startZen();
  });

  function refreshSoundButtons() {
    const label = '🔊 Sound: ' + (SoundManager.enabled ? 'An' : 'Aus');
    document.getElementById('btn-sound-toggle').textContent = label;
    document.getElementById('btn-sound-toggle-2').textContent = label;
  }
  function toggleSound() {
    SoundManager.enabled = !SoundManager.enabled;
    saveData.soundOn = SoundManager.enabled;
    Storage.save(saveData);
    refreshSoundButtons();
    SoundManager.button();
  }
  document.getElementById('btn-sound-toggle').addEventListener('click', toggleSound);
  document.getElementById('btn-sound-toggle-2').addEventListener('click', toggleSound);

  function refreshDarkButton() {
    const btn = document.getElementById('btn-dark-toggle');
    if (btn) btn.textContent = '🌙 Dunkler Modus: ' + (saveData.darkMode ? 'An' : 'Aus');
  }
  const darkBtn = document.getElementById('btn-dark-toggle');
  if (darkBtn) {
    darkBtn.addEventListener('click', () => {
      saveData.darkMode = !saveData.darkMode;
      applyDarkMode();
      refreshDarkButton();
      Storage.save(saveData);
      SoundManager.button();
    });
  }

  document.getElementById('btn-tutorial-next').addEventListener('click', () => {
    SoundManager.button();
    if (tutorialStepIdx < TUTORIAL_STEPS.length - 1) {
      tutorialStepIdx++;
      renderTutorialStep();
    } else {
      closeTutorial();
    }
  });
  document.getElementById('btn-tutorial-skip').addEventListener('click', () => {
    SoundManager.button();
    closeTutorial();
  });
  document.getElementById('btn-replay-tutorial').addEventListener('click', () => {
    SoundManager.button();
    Overlays.hide('overlay-settings');
    openTutorial();
  });

  document.getElementById('btn-reset-progress').addEventListener('click', () => {
    if (confirm('Wirklich den gesamten Fortschritt zurücksetzen?')) {
      const soundOn = SoundManager.enabled;
      saveData = defaultSaveData();
      saveData.soundOn = soundOn;
      Storage.save(saveData);
      applyMilestones();
      updateHomeStats();
      Overlays.hide('overlay-settings');
    }
  });

  document.querySelectorAll('[data-close-overlay]').forEach((b) => {
    b.addEventListener('click', () => {
      SoundManager.button();
      b.closest('.overlay').classList.remove('active');
      if (b.dataset.goto) {
        Screens.show(b.dataset.goto);
        updateHomeStats();
      }
    });
  });

  document.getElementById('btn-result-next').addEventListener('click', () => {
    SoundManager.button();
    Overlays.hide('overlay-result');
    startLevel(currentLevelIndex + 1);
  });
  document.getElementById('btn-result-retry').addEventListener('click', () => {
    SoundManager.button();
    Overlays.hide('overlay-result');
    if (currentMode === 'level') startLevel(currentLevelIndex);
    else if (currentMode === 'daily') startDaily();
    else startZen();
  });
}

/* ---------- Start ---------- */
/* ---------- Mini-Tutorial ----------
   Kurze, animierte Einführung für neue Spieler (3 Schritte). Erscheint
   automatisch beim allerersten Start und kann jederzeit über die
   Einstellungen erneut geöffnet werden. */
const TUTORIAL_STEPS = [
  { title: 'Tauschen', text: 'Tippe einen Kristall an, danach einen direkten Nachbarn — beide tauschen die Plätze.', demo: 'swap' },
  { title: 'Verschmelzen', text: '3 oder mehr gleiche Kristalle in einer Reihe oder Spalte lösen sich auf und bringen Punkte.', demo: 'match' },
  { title: 'Ziel & Züge', text: 'Erreiche das Ziel oben im Bildschirm, bevor deine Züge aufgebraucht sind. Eis, Schlüssel und Käfige brauchen dafür extra Aufmerksamkeit.', demo: 'goal' },
  { title: 'Joker', text: 'Kommst du nicht weiter? Deine Joker (↩ 🤖 🎨 ➕) helfen dir jederzeit aus der Patsche.', demo: 'joker' }
];
let tutorialStepIdx = 0;
function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStepIdx];
  document.getElementById('tutorial-title').textContent = step.title;
  document.getElementById('tutorial-text').textContent = step.text;
  const demo = document.getElementById('tutorial-demo');
  demo.className = 'tutorial-demo demo-' + step.demo;
  const dots = document.getElementById('tutorial-dots');
  dots.innerHTML = TUTORIAL_STEPS.map((_, i) => `<span class="tdot${i === tutorialStepIdx ? ' active' : ''}"></span>`).join('');
  const nextBtn = document.getElementById('btn-tutorial-next');
  nextBtn.textContent = tutorialStepIdx === TUTORIAL_STEPS.length - 1 ? "Los geht's!" : 'Weiter';
}
function openTutorial() {
  tutorialStepIdx = 0;
  renderTutorialStep();
  Overlays.show('overlay-tutorial');
}
function closeTutorial() {
  saveData.tutorialSeen = true;
  Storage.save(saveData);
  Overlays.hide('overlay-tutorial');
}

function applyLoginStreak() {
  const today = todayStr();
  if (saveData.streak.lastDate === today) return; // heute schon gezählt
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  saveData.streak.count = (saveData.streak.lastDate === yesterday) ? saveData.streak.count + 1 : 1;
  saveData.streak.lastDate = today;
  saveData.jokers.auto = Math.min(30, saveData.jokers.auto + 1);
  if (saveData.streak.count % 3 === 0) saveData.jokers.undo = Math.min(30, saveData.jokers.undo + 1);
  if (saveData.streak.count % 7 === 0) {
    saveData.jokers.color = Math.min(30, saveData.jokers.color + 1);
    saveData.jokers.extra = Math.min(30, saveData.jokers.extra + 1);
  }
  Storage.save(saveData);
}

function applySeasonalSkin() {
  const month = new Date().getMonth(); // 0 = Januar
  let particle = null;
  if (month === 9) particle = { emoji: '🍂', count: 10 }; // Oktober
  if (month === 11) particle = { emoji: '❄️', count: 14 }; // Dezember
  if (!particle) return;
  for (let i = 0; i < particle.count; i++) {
    const el = document.createElement('div');
    el.className = 'season-particle';
    el.textContent = particle.emoji;
    el.style.left = Math.random() * 100 + 'vw';
    el.style.fontSize = (14 + Math.random() * 10) + 'px';
    el.style.animationDuration = (8 + Math.random() * 8) + 's';
    el.style.animationDelay = (Math.random() * 10) + 's';
    document.body.appendChild(el);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  applyDarkMode();
  applyMilestones();
  updateHomeStats();
  renderLegalPages();
  applyLoginStreak();
  applySeasonalSkin();
  Screens.show('screen-home');

  const splash = document.getElementById('splash');
  if (splash) setTimeout(() => splash.remove(), 1700);
  if (!saveData.tutorialSeen) setTimeout(openTutorial, 1750);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});
