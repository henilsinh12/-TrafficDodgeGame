'use strict';

/* =====================================================================
 * Traffic Dodge: Highway Rush
 * Phaser 4 game for YouTube Playables.
 *
 * Coordinate system: the world is always UNIT_H (1280) units tall and as wide as the
 * screen's aspect ratio requires. A single camera zoom maps units to real pixels, so the
 * game fills ANY aspect ratio (9:32 ... 32:9) and stays sharp on high-DPI phones.
 * Lateral (left/right) gameplay maths is done in "design units" (road = 520 wide) and is
 * scaled by L.k only when drawing, so the difficulty is identical on every screen.
 * ===================================================================== */

const UNIT_H = 1280;
const LANES = 4;
const LANE_W = 130;
const ROAD_W = LANES * LANE_W;
const PLAYER_Y = 1000;
const FONT = '"Trebuchet MS", "Segoe UI", Verdana, Arial, sans-serif';
const PL = { halfW: 25, halfH: 50 };            // player hit box (generous / forgiving)

/** Shared layout, recomputed whenever the window size changes. */
const L = { cw: 360, ch: 640, pw: 360, ph: 640, Z: 0.5, Wu: 720, cx: 360, k: 1, roadL: 0, roadR: 0 };

/* ------------------------------------------------------------- utilities */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const laneOffset = (lane) => (lane - (LANES - 1) / 2) * LANE_W;   // design units from road centre
const laneX = (lane) => L.cx + laneOffset(lane) * L.k;
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function measure() {
  let cw = window.innerWidth;
  let ch = window.innerHeight;
  // Playables loads the game in a hidden WebView whose viewport is 0x0 at first.
  if (!(cw > 0 && ch > 0)) { cw = 360; ch = 640; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let pw = Math.round(cw * dpr);
  let ph = Math.round(ch * dpr);
  const maxPixels = 3.2e6;                       // keep fill-rate sane on huge screens
  const f = Math.sqrt(maxPixels / (pw * ph));
  if (f < 1) { pw = Math.round(pw * f); ph = Math.round(ph * f); }
  return { cw, ch, pw, ph };
}

function computeLayout(m) {
  L.cw = m.cw; L.ch = m.ch; L.pw = m.pw; L.ph = m.ph;
  L.Z = m.ph / UNIT_H;
  L.Wu = m.pw / L.Z;
  L.cx = L.Wu / 2;
  L.k = Math.min(1, (L.Wu * 0.96) / (ROAD_W + 40));
  L.roadL = L.cx - (ROAD_W * L.k) / 2;
  L.roadR = L.cx + (ROAD_W * L.k) / 2;
}

function applyCamera(scene) {
  const cam = scene.cameras.main;
  cam.setZoom(L.Z);
  cam.centerOn(L.Wu / 2, UNIT_H / 2);
}

/** Shrinks a text object so it never exceeds maxW (design units). */
function fitText(t, maxW) {
  t.setScale(1);
  t.setScale(Math.min(1, maxW / Math.max(1, t.width)));
}

/** Text helper: crisp on every zoom level, registered so it can be re-resolved on resize. */
function mkText(scene, x, y, str, size, color, o) {
  o = o || {};
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: size + 'px',
    fontStyle: 'bold',
    color: color || '#ffffff',
    align: o.align || 'center',
    stroke: o.stroke || '#0b141c',
    strokeThickness: o.noStroke ? 0 : Math.max(2, Math.round(size * 0.1))
  });
  t.setOrigin(o.ox !== undefined ? o.ox : 0.5, o.oy !== undefined ? o.oy : 0.5);
  t.setResolution(Math.max(1, L.Z));
  if (scene.texts) scene.texts.push(t);
  return t;
}

/* ===================================================================== */
/*  Button (all states: idle / hover / pressed / focused)                */
/* ===================================================================== */

class Button {
  constructor(scene, label, w, h, onClick, depth) {
    this.scene = scene;
    this.w = w;
    this.h = h;
    this.onClick = onClick;
    this.state = 'idle';
    this.focused = false;
    this.x = 0;
    this.y = 0;
    this.dw = w;
    this.g = scene.add.graphics().setDepth(depth);
    this.t = mkText(scene, 0, 0, label, Math.round(h * 0.4), '#06210f', { noStroke: true }).setDepth(depth + 1);
    this.hit = scene.add.rectangle(0, 0, w + 20, h + 20, 0xffffff, 0.001).setDepth(depth + 2);
    this.hit.setInteractive(new Phaser.Geom.Rectangle(0, 0, w + 20, h + 20), Phaser.Geom.Rectangle.Contains);
    this.hit.on('pointerover', () => { if (this.state !== 'pressed') this.state = 'hover'; });
    this.hit.on('pointerout', () => { this.state = 'idle'; });
    this.hit.on('pointerdown', () => { this.state = 'pressed'; });
    this.hit.on('pointerup', () => {
      if (this.state === 'pressed') { this.state = 'hover'; Sfx.click(); this.onClick(); }
    });
    this.setVisible(false);
  }

  place(x, y) {
    this.x = x;
    this.y = y;
    this.dw = Math.min(this.w, L.Wu * 0.86);        // never wider than the screen
    this.t.setPosition(x, y);
    this.t.setScale(Math.min(1, (this.dw - 40) / Math.max(1, this.t.width / this.t.scaleX * 1)));
    this.hit.setPosition(x, y);
    this.hit.setSize(this.dw + 20, this.h + 20);
    if (this.hit.input && this.hit.input.hitArea) {
      this.hit.input.hitArea.width = this.dw + 20;
      this.hit.input.hitArea.height = this.h + 20;
    }
  }

  setVisible(v) {
    this.visible = v;
    this.g.setVisible(v);
    this.t.setVisible(v);
    this.hit.setVisible(v);
    if (this.hit.input) this.hit.input.enabled = v;
    if (!v) this.state = 'idle';
  }

  draw(time) {
    const g = this.g;
    g.clear();
    if (!this.visible) return;
    const pressed = this.state === 'pressed';
    const hover = this.state === 'hover';
    const w = this.dw, h = this.h;
    const x = this.x - w / 2;
    const y = this.y - h / 2 + (pressed ? 5 : 0);
    g.fillStyle(0x0b1a12, 0.55);
    g.fillRoundedRect(x, y + 10 - (pressed ? 5 : 0), w, h, h / 2);        // drop shadow
    g.fillStyle(pressed ? 0x2fbf7c : hover ? 0x7bf2b6 : 0x4ee59a, 1);
    g.fillRoundedRect(x, y, w, h, h / 2);
    g.fillStyle(0xffffff, pressed ? 0.04 : 0.22);
    g.fillRoundedRect(x + 8, y + 6, w - 16, h * 0.42, h * 0.21);          // gloss
    if (this.focused) {
      const a = 0.55 + 0.45 * Math.sin(time / 180);
      g.lineStyle(6, 0xffffff, a);
      g.strokeRoundedRect(x - 7, y - 7, w + 14, h + 14, h / 2 + 7);
    }
    this.t.setPosition(this.x, this.y + (pressed ? 5 : 0));
  }
}

/* ===================================================================== */
/*  Boot / loading scene                                                 */
/* ===================================================================== */

class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  create() {
    // Inside Playables the host owns pause/resume (onPause/onResume). Remove Phaser's own
    // visibility/blur handlers so the game never relies on the Page Visibility API.
    ['HIDDEN', 'VISIBLE', 'BLUR', 'FOCUS'].forEach((n) => this.game.events.off(Phaser.Core.Events[n]));

    this.texts = [];
    applyCamera(this);
    this.bg = this.add.rectangle(0, 0, 10, 10, 0x1c3d2b).setOrigin(0, 0);
    this.title = mkText(this, 0, 0, 'TRAFFIC DODGE', 84, '#ffffff');
    this.sub = mkText(this, 0, 0, 'LOADING...', 40, '#7bf2b6');
    this.bar = this.add.graphics();
    this.frames = 0;
    this.started = false;
    this.layout();
    this.onLayout = () => this.layout();
    this.game.events.on('td-layout', this.onLayout);
    this.events.once('shutdown', () => this.game.events.off('td-layout', this.onLayout));
  }

  layout() {
    applyCamera(this);
    this.bg.setSize(L.Wu, UNIT_H);
    this.title.setPosition(L.cx, 560);
    this.sub.setPosition(L.cx, 660);
    this.texts.forEach((t) => t.setResolution(Math.max(1, L.Z)));
  }

  update(time) {
    this.frames++;
    // We are now rendering a loading screen that tells the player loading is under way.
    if (this.frames === 2) Platform.firstFrameReady();
    if (this.frames === 4 && !this.started) {
      this.started = true;
      const savePromise = Platform.loadSave();
      const timeout = new Promise((r) => setTimeout(() => r(Platform.defaults()), 4000));
      this.time.delayedCall(40, () => {
        Art.buildAll(this);
        Promise.race([savePromise, timeout]).then((save) => this.scene.start('play', { save }));
      });
    }
    const g = this.bar;
    g.clear();
    const w = 360, x = L.cx - w / 2, y = 740;
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(x, y, w, 16, 8);
    g.fillStyle(0x4ee59a, 1);
    const p = (time / 900) % 1;
    g.fillRoundedRect(x + p * (w - 120), y, 120, 16, 8);
  }
}

/* ===================================================================== */
/*  Main game scene                                                      */
/* ===================================================================== */

class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  init(data) { this.save = data.save || Platform.defaults(); }

  create() {
    this.texts = [];
    this.traffic = [];
    this.coinList = [];
    this.scenery = [];
    this.parts = [];
    this.streaks = [];
    this.state = 'menu';
    this.frames = 0;
    this.time_ = 0;
    this.scroll = 340;
    this.scrollPos = 0;
    this.dist = 0;
    this.level = 0;
    this.score = 0;
    this.dodges = 0;
    this.runCoins = 0;
    this.bonus = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.ux = laneOffset(2);
    this.vx = 0;
    this.rot = 0;
    this.darkness = 0;
    this.timeScale = 1;
    this.rowTimer = 1;
    this.prevOpen = null;
    this.overTimer = 0;
    this.overReady = false;
    this.newBest = false;
    this.graceTimer = 0;
    this.steerPointer = null;
    this.hostPaused = false;
    this.readyTimer = 0;
    this.lastScoreShown = -1;
    this.crashVx = 0;
    this.crashSpin = 0;
    this.botFn = null;

    applyCamera(this);

    this.gBg = this.add.graphics().setDepth(0);
    this.initScenery();
    this.beamL = this.add.image(0, 0, 'beam').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(5).setAlpha(0);
    this.beamR = this.add.image(0, 0, 'beam').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(5).setAlpha(0);
    this.player = this.add.image(0, PLAYER_Y, 'car_player').setDepth(10);
    this.gFx = this.add.graphics().setDepth(14);
    this.dusk = this.add.rectangle(0, 0, 10, 10, 0x070d24, 1).setOrigin(0, 0).setDepth(20).setAlpha(0);
    this.gHud = this.add.graphics().setDepth(30);

    this.buildHud();
    this.buildMenu();
    this.buildOver();
    this.buildInput();

    this.layout();
    this.onLayout = () => this.layout();
    this.game.events.on('td-layout', this.onLayout);
    this.events.once('shutdown', () => this.game.events.off('td-layout', this.onLayout));

    this.setState('menu');
    if (location.search.indexOf('debug') >= 0) window.__td = { scene: this, game: this.game };
  }

  /* -------------------------------------------------------------- layout */

  layout() {
    applyCamera(this);
    const W = L.Wu;
    this.dusk.setPosition(-80, -80).setSize(W + 160, UNIT_H + 160);
    // Keep the HUD close to the road on very wide screens instead of in the far corners.
    const hudL = Math.max(32, L.cx - 460);
    const hudR = Math.min(W - 32, L.cx + 460);
    this.hudL = hudL;
    this.scoreLabel.setPosition(hudL, 40);
    this.scoreText.setPosition(hudL, 66);
    this.levelText.setPosition(hudL, 160);
    this.coinIcon.setPosition(hudR - 26, 78);
    this.coinText.setPosition(hudR - 62, 78);
    this.bestText.setPosition(hudR, 126);
    this.speedText.setPosition(L.cx, UNIT_H - 78);

    this.menu.title1.setPosition(L.cx, 250);
    this.menu.title2.setPosition(L.cx, 366);
    this.menu.sub.setPosition(L.cx, 462);
    this.menu.best.setPosition(L.cx, 560);
    this.menu.help.setPosition(L.cx, 1150);
    this.menu.btn.place(L.cx, 740);
    this.menu.hint.setPosition(L.cx, 842);

    this.layoutOver();
    this.readyText.setPosition(L.cx, 500);
    this.tutorial.setPosition(L.cx, 840);
    this.texts.forEach((t) => t.setResolution(Math.max(1, L.Z)));
    this.fitAll();
  }

  /** Shrinks long texts so they never run off narrow screens. */
  fitAll() {
    const maxW = L.Wu * 0.94;
    [this.menu.title1, this.menu.title2, this.menu.sub, this.menu.best, this.menu.help, this.tutorial, this.readyText]
      .forEach((t) => fitText(t, maxW));
    const pw = Math.min(620, L.Wu * 0.94);
    fitText(this.over.title, pw * 0.88);
    fitText(this.over.badge, pw * 0.88);
    fitText(this.over.score, pw * 0.88);
    this.over.stats.forEach((st) => { fitText(st.value, pw * 0.44); fitText(st.label, pw * 0.44); });
  }

  /* ----------------------------------------------------------------- HUD */

  buildHud() {
    const T = (s, size, c, o) => mkText(this, 0, 0, s, size, c, o).setDepth(31);
    this.scoreLabel = T('SCORE', 26, '#bfe9d0', { ox: 0, oy: 0 });
    this.scoreText = T('0', 76, '#ffffff', { ox: 0, oy: 0 });
    this.levelText = T('LEVEL 1', 26, '#bfe9d0', { ox: 0, oy: 0 });
    this.coinIcon = this.add.image(0, 0, 'coin').setScale(0.62).setDepth(31);
    this.coinText = T('0', 54, '#ffe27a', { ox: 1 });
    this.bestText = T('BEST 0', 26, '#bfe9d0', { ox: 1 });
    this.speedText = T('0 KM/H', 34, '#ffffff');
    this.readyText = T('GET READY', 90, '#ffe27a').setDepth(45);
    this.tutorial = T('HOLD LEFT OR RIGHT TO STEER', 36, '#ffffff').setDepth(35);
    this.hudObjs = [this.scoreLabel, this.scoreText, this.levelText, this.coinIcon, this.coinText, this.bestText, this.speedText];
    this.readyText.setVisible(false);
    this.tutorial.setVisible(false);
  }

  setHudVisible(v) {
    this.hudObjs.forEach((o) => o.setVisible(v));
  }

  updateHud() {
    const s = Math.floor(this.score);
    if (s !== this.lastScoreShown) {
      this.lastScoreShown = s;
      this.scoreText.setText(fmt(s));
    }
    this.coinText.setText(String(this.runCoins));
    this.levelText.setText('LEVEL ' + (this.level + 1));
    this.bestText.setText('BEST ' + fmt(Math.max(this.save.best, s)));
    this.speedText.setText(Math.round(this.scroll * 0.19) + ' KM/H');
    fitText(this.scoreText, Math.min(L.Wu * 0.4, 330));
    fitText(this.bestText, Math.min(L.Wu * 0.32, 300));
    // level progress bar
    const g = this.gHud;
    g.clear();
    if (this.state !== 'menu') {
      const prog = (this.dist % 9000) / 9000;
      g.fillStyle(0xffffff, 0.2);
      g.fillRoundedRect(this.hudL, 198, 240, 10, 5);
      g.fillStyle(0x4ee59a, 1);
      g.fillRoundedRect(this.hudL, 198, Math.max(10, 240 * prog), 10, 5);
    }
  }

  /* ---------------------------------------------------------------- menu */

  buildMenu() {
    const T = (s, size, c, o) => mkText(this, 0, 0, s, size, c, o).setDepth(41);
    this.menu = {
      title1: T('TRAFFIC', 118, '#ffffff'),
      title2: T('DODGE', 150, '#ffe27a'),
      sub: T('HIGHWAY RUSH', 46, '#7bf2b6'),
      best: T('', 34, '#ffffff'),
      hint: T('or press SPACE', 28, '#bfe9d0', { noStroke: true }),
      help: T('STEER:  \u2190 \u2192   A D   or hold left / right', 28, '#ffffff'),
      btn: new Button(this, 'START', 420, 124, () => this.startRun(), 41)
    };
    this.menu.btn.focused = true;
    this.menuObjs = [this.menu.title1, this.menu.title2, this.menu.sub, this.menu.best, this.menu.hint, this.menu.help];
  }

  setMenuVisible(v) {
    this.menuObjs.forEach((o) => o.setVisible(v));
    this.menu.btn.setVisible(v);
    if (v) {
      this.menu.best.setText(this.save.best > 0 ? 'BEST  ' + fmt(this.save.best) : 'DODGE THE TRAFFIC. GRAB THE COINS.');
      this.fitAll();
    }
  }

  /* ------------------------------------------------------------ game over */

  buildOver() {
    const T = (s, size, c, o) => mkText(this, 0, 0, s, size, c, o).setDepth(51);
    this.over = {
      panel: this.add.graphics().setDepth(50),
      title: T('CRASH!', 104, '#ff6b5e'),
      scoreLabel: T('SCORE', 28, '#bfe9d0'),
      score: T('0', 120, '#ffffff'),
      badge: T('NEW BEST!', 44, '#ffe27a'),
      stats: [],
      btn: new Button(this, 'RACE AGAIN', 460, 124, () => this.restart(), 52),
      hint: T('or press SPACE', 28, '#bfe9d0', { noStroke: true })
    };
    ['BEST', 'COINS', 'DODGES', 'DISTANCE'].forEach((label) => {
      this.over.stats.push({ label: T(label, 24, '#9fc9b3'), value: T('0', 44, '#ffffff') });
    });
    this.overObjs = [this.over.title, this.over.scoreLabel, this.over.score, this.over.badge, this.over.hint]
      .concat(this.over.stats.map((s) => s.label), this.over.stats.map((s) => s.value));
    this.setOverVisible(false);
  }

  layoutOver() {
    const o = this.over;
    const pw = Math.min(620, L.Wu * 0.94);
    const ph = 900;
    const x = L.cx - pw / 2;
    const y = 640 - ph / 2;
    o.panelRect = { x, y, w: pw, h: ph };
    o.title.setPosition(L.cx, y + 92);
    o.scoreLabel.setPosition(L.cx, y + 190);
    o.score.setPosition(L.cx, y + 262);
    o.badge.setPosition(L.cx, y + 350);
    const colX = [L.cx - pw * 0.24, L.cx + pw * 0.24];
    o.stats.forEach((s, i) => {
      const cx = colX[i % 2];
      const cy = y + 440 + Math.floor(i / 2) * 106;
      s.label.setPosition(cx, cy);
      s.value.setPosition(cx, cy + 48);
    });
    o.btn.place(L.cx, y + ph - 150);
    o.hint.setPosition(L.cx, y + ph - 50);
  }

  drawOverPanel(a) {
    const g = this.over.panel;
    g.clear();
    if (!this.over.shown) return;
    const r = this.over.panelRect;
    g.fillStyle(0x04100a, 0.62 * a);
    g.fillRect(0, 0, L.Wu, UNIT_H);
    g.fillStyle(0x0b1a12, 0.5 * a);
    g.fillRoundedRect(r.x + 4, r.y + 14, r.w, r.h, 46);
    g.fillStyle(0x15281f, 0.97 * a);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 46);
    g.lineStyle(4, 0x2f5a45, a);
    g.strokeRoundedRect(r.x, r.y, r.w, r.h, 46);
  }

  setOverVisible(v) {
    this.over.shown = v;
    this.overObjs.forEach((o) => o.setVisible(v));
    this.over.btn.setVisible(v);
    this.over.panel.setVisible(v);
    if (!v) this.over.panel.clear();
    else this.over.badge.setVisible(this.newBest);
  }

  /* --------------------------------------------------------------- input */

  buildInput() {
    const kb = this.input.keyboard;
    this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D' });
    kb.addCapture('LEFT,RIGHT,UP,DOWN,SPACE');
    const action = (e) => { if (e && e.repeat) return; Sfx.unlock(); this.onAction(); };
    kb.on('keydown-SPACE', action);
    kb.on('keydown-ENTER', action);
    kb.on('keydown', (e) => { if (!e.repeat) Sfx.unlock(); });

    this.input.addPointer(2);
    this.input.on('pointerdown', (p) => {
      Sfx.unlock();
      if (this.state === 'menu') { this.startRun(); return; }
      if (this.state === 'playing') this.steerPointer = p;
    });
    this.input.on('pointerup', (p) => { if (this.steerPointer === p) this.steerPointer = null; });
  }

  onAction() {
    if (this.hostPaused) return;
    if (this.state === 'menu') this.startRun();
    else if (this.state === 'over') this.restart();
  }

  readSteer() {
    if (this.botFn) return clamp(this.botFn(this), -1, 1);
    let dir = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) dir -= 1;
    if (this.keys.right.isDown || this.keys.d.isDown) dir += 1;
    const p = this.steerPointer;
    if (p && p.isDown) {
      const target = (p.worldX - L.cx) / L.k;
      dir += clamp((target - this.ux) / 40, -1, 1);
    }
    return clamp(dir, -1, 1);
  }

  /* --------------------------------------------------------------- state */

  setState(s) {
    this.state = s;
    const menu = s === 'menu';
    this.setMenuVisible(menu);
    this.setHudVisible(!menu);
    this.player.setVisible(true);
    if (s !== 'over') this.setOverVisible(false);
    this.tutorial.setVisible(false);
    this.readyText.setVisible(false);
  }

  clearEntities() {
    this.traffic.forEach((c) => c.spr.destroy());
    this.coinList.forEach((c) => c.spr.destroy());
    this.traffic.length = 0;
    this.coinList.length = 0;
    this.parts.length = 0;
  }

  startRun() {
    if (this.state === 'playing' || this.hostPaused) return;
    Sfx.unlock();
    Sfx.start();
    this.clearEntities();
    this.dist = 0;
    this.level = 0;
    this.score = 0;
    this.dodges = 0;
    this.runCoins = 0;
    this.bonus = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.ux = laneOffset(2);
    this.vx = 0;
    this.rot = 0;
    this.player.setRotation(0);
    this.timeScale = 1;
    this.rowTimer = 1.1;
    this.newBest = false;
    this.lastScoreShown = -1;
    this.steerPointer = null;
    this.input.keyboard.resetKeys();
    this.cameras.main.resetFX();
    this.setState('playing');
    this.updateHud();
    Sfx.engineStart();
    if (this.save.runs < 3) {
      this.tutorial.setVisible(true);
      this.tutorial.setAlpha(1);
      this.tweens.add({ targets: this.tutorial, alpha: 0, delay: 3200, duration: 600, onComplete: () => this.tutorial.setVisible(false) });
    }
  }

  restart() {
    if (this.state !== 'over' || !this.overReady || this.hostPaused) return;
    this.startRun();
  }

  crash(car) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.overTimer = 0;
    this.overReady = false;
    this.timeScale = 0.3;
    this.steerPointer = null;
    Sfx.engineStop();
    Sfx.crash();
    this.cameras.main.shake(380, 0.014);
    this.cameras.main.flash(140, 255, 90, 70);

    const px = L.cx + this.ux * L.k;
    const cx = laneX(car.lane);
    const ix = (px + cx) / 2;
    const iy = (PLAYER_Y + car.y) / 2;
    for (let i = 0; i < 36; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(120, 620);
      this.parts.push({ x: ix, y: iy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0, max: rand(0.5, 1.1), size: rand(6, 15), color: pick([0xffb347, 0xff6b5e, 0xcfd6de, 0x59616b]), grav: 900, shape: 'rect', spin: rand(-8, 8), rot: 0 });
    }
    for (let i = 0; i < 20; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(200, 800);
      this.parts.push({ x: ix, y: iy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.25, 0.6), size: rand(3, 6), color: 0xfff1a8, grav: 0, shape: 'circle' });
    }
    for (let i = 0; i < 16; i++) {
      this.parts.push({ x: ix + rand(-30, 30), y: iy + rand(-30, 30), vx: rand(-90, 90), vy: rand(-220, -60), life: 0, max: rand(0.8, 1.6), size: rand(22, 46), color: 0x2b3138, grav: -40, shape: 'circle', soft: true, grow: 40 });
    }
    // knock the player away from the car it hit
    this.crashVx = (px < cx ? -1 : 1) * rand(260, 420);
    this.crashSpin = (px < cx ? -1 : 1) * rand(2.5, 4.5);
    car.spr.setTint(0xffb0a8);

    // results
    const sc = Math.floor(this.score);
    this.newBest = sc > this.save.best;
    this.save.runs += 1;
    this.save.coins += this.runCoins;
    if (this.newBest) this.save.best = sc;
    this.save.bestDist = Math.max(this.save.bestDist, Math.floor(this.dist / 10));
    Platform.sendScore(sc);
    Platform.saveProgress(this.save);
  }

  showOver() {
    const o = this.over;
    const sc = Math.floor(this.score);
    o.score.setText(fmt(sc));
    o.stats[0].value.setText(fmt(this.save.best));
    o.stats[1].value.setText(String(this.runCoins));
    o.stats[2].value.setText(String(this.dodges));
    o.stats[3].value.setText(fmt(this.dist / 10) + ' m');
    this.setOverVisible(true);
    this.over.btn.focused = true;
    this.overAnim = 0;
    if (this.newBest) {
      Sfx.newBest();
      this.tweens.add({ targets: o.badge, scale: { from: 0.6, to: 1 }, duration: 380, ease: 'Back.Out' });
    }
  }

  /* --------------------------------------------------------------- world */

  initScenery() {
    for (let i = 0; i < 14; i++) {
      const spr = this.add.image(0, 0, 'tree_a').setDepth(3);
      const o = { spr, y: i * 95 + rand(-30, 30), side: 1, dist: 0 };
      this.respawnScenery(o, false);
      this.scenery.push(o);
    }
  }

  respawnScenery(o, top) {
    const type = pick(['tree_a', 'tree_a', 'tree_b', 'tree_b', 'bush', 'rock']);
    o.spr.setTexture(type);
    o.size = type === 'tree_a' ? 96 : type === 'tree_b' ? 76 : type === 'bush' ? 48 : 36;
    o.side = Math.random() < 0.5 ? -1 : 1;
    o.dist = 34 + o.size / 2 + Math.pow(Math.random(), 1.6) * 360;
    if (top) o.y = -80 - rand(0, 60);
    o.spr.setScale(0.5 * (0.9 + Math.random() * 0.3));
    o.spr.setRotation(rand(0, Math.PI * 2));
  }

  updateScenery(dt) {
    for (const o of this.scenery) {
      o.y += this.scroll * dt;
      if (o.y > UNIT_H + 90) this.respawnScenery(o, true);
      const x = o.side < 0 ? L.roadL - 20 * L.k - o.dist : L.roadR + 20 * L.k + o.dist;
      const half = o.size / 2;
      o.spr.setPosition(x, o.y);
      o.spr.setVisible(x - half > 0 && x + half < L.Wu);
    }
  }

  drawBg() {
    const g = this.gBg;
    const W = L.Wu, k = L.k;
    const T = -80, H = UNIT_H + 160;          // overdraw so camera shake never shows an edge
    g.clear();
    g.fillStyle(0x2f7d46, 1);
    g.fillRect(-80, T, W + 160, H);
    const band = 140;
    const off = this.scrollPos % (band * 2);
    g.fillStyle(0x358a4e, 1);
    for (let y = -band * 2 + off; y < UNIT_H + 80; y += band * 2) g.fillRect(-80, y, W + 160, band);

    const rl = L.roadL, rr = L.roadR;
    g.fillStyle(0x9aa1a8, 1);
    g.fillRect(rl - 22 * k, T, rr - rl + 44 * k, H);
    const roff = this.scrollPos % 60;
    for (let y = -60 + roff; y < UNIT_H + 80; y += 60) {
      g.fillStyle(0xd94b4b, 1);
      g.fillRect(rl - 22 * k, y, 12 * k, 30);
      g.fillRect(rr + 10 * k, y, 12 * k, 30);
      g.fillStyle(0xf4f6f8, 1);
      g.fillRect(rl - 22 * k, y + 30, 12 * k, 30);
      g.fillRect(rr + 10 * k, y + 30, 12 * k, 30);
    }
    g.fillStyle(0x2d333b, 1);
    g.fillRect(rl, T, rr - rl, H);
    g.fillStyle(0x272c33, 1);
    for (let i = 0; i < LANES; i++) {
      const cx = laneX(i);
      g.fillRect(cx - 34 * k, T, 16 * k, H);
      g.fillRect(cx + 18 * k, T, 16 * k, H);
    }
    g.fillStyle(0xf4f6f8, 1);
    g.fillRect(rl + 6 * k, T, 6 * k, H);
    g.fillRect(rr - 12 * k, T, 6 * k, H);
    const doff = this.scrollPos % 150;
    g.fillStyle(0xdfe5ea, 1);
    for (let i = 1; i < LANES; i++) {
      const x = rl + i * LANE_W * k - 3 * k;
      for (let y = -150 + doff; y < UNIT_H + 80; y += 150) g.fillRect(x, y, 6 * k, 80);
    }
  }

  /* ------------------------------------------------------------- traffic */

  laneClear(lane) {
    for (const c of this.traffic) if (c.lane === lane && c.y - c.kind.h / 2 < 300) return false;
    for (const c of this.coinList) if (c.lane === lane && c.y < 650) return false;
    return true;
  }

  pickKind() {
    const lvl = this.level;
    const w = [['sedan', 0.4], ['suv', 0.28], ['sport', 0.17], ['van', lvl >= 1 ? 0.1 : 0], ['truck', lvl >= 2 ? 0.07 : 0]];
    const total = w.reduce((s, e) => s + e[1], 0);
    let r = Math.random() * total;
    for (const e of w) { r -= e[1]; if (r <= 0) return e[0]; }
    return 'sedan';
  }

  addCar(lane, kindName, demo) {
    const kind = Art.KINDS[kindName];
    const key = Art.trafficKey(kindName, randInt(0, 5));
    const spr = this.add.image(laneX(lane), -kind.h, key).setDepth(8).setScale(L.k * 0.5);
    this.traffic.push({ spr, lane, kind, kindName, y: -kind.h / 2 - 8, passed: false, minGap: 999, demo: !!demo });
  }

  /**
   * Fairness solver. Projects every vehicle (existing + the candidate row) forward in time and
   * checks that a player can always survive by changing at most one lane per 0.3 s, from ANY
   * lane that is currently free. Rows that would create an unavoidable "wall" are rejected.
   */
  rowIsFair(cands) {
    const STEP = 0.3, SUB = 0.1, HORIZON = 7.5;
    const cars = [];
    const pushCar = (lane, y, kind) =>
      cars.push({ lane, y, v: this.scroll * (1 - kind.f), hh: kind.h * 0.44 + PL.halfH + 80 });
    for (const c of this.traffic) if (!c.demo) pushCar(c.lane, c.y, c.kind);
    for (const c of cands) pushCar(c.lane, -c.kind.h / 2 - 8, c.kind);

    const occupied = (lane, t) => {
      for (const c of cars) {
        if (c.lane === lane && Math.abs(c.y + c.v * t - PLAYER_Y) < c.hh) return true;
      }
      return false;
    };

    // mask[l] = bit set of start lanes that can currently be standing in lane l
    let mask = [0, 0, 0, 0];
    let free0 = 0;
    for (let l = 0; l < LANES; l++) if (!occupied(l, 0)) { mask[l] = 1 << l; free0 |= 1 << l; }
    for (let t = 0; t < HORIZON; t += STEP) {
      const next = [0, 0, 0, 0];
      for (let l = 0; l < LANES; l++) {
        if (!mask[l]) continue;
        for (let d = -1; d <= 1; d++) {
          const n = l + d;
          if (n < 0 || n >= LANES) continue;
          let ok;
          if (d === 0) {
            ok = !occupied(l, t + SUB) && !occupied(l, t + 2 * SUB) && !occupied(l, t + STEP);
          } else {
            ok = !occupied(l, t + SUB) && !occupied(n, t + 2 * SUB) && !occupied(n, t + STEP);
          }
          if (ok) next[n] |= mask[l];
        }
      }
      mask = next;
      if (!mask.some((m) => m)) return false;
    }
    // Invariant: wherever the player is standing right now, a safe path must still exist.
    let alive = 0;
    for (const m of mask) alive |= m;
    return (alive & free0) === free0;
  }

  spawnRow(demo) {
    const lvl = this.level;
    const maxBlock = demo ? 2 : lvl >= 5 ? 3 : 2;
    const all = [0, 1, 2, 3];
    let chosen = null;
    for (let tries = 0; tries < 16 && !chosen; tries++) {
      const r = Math.random();
      let n = 1;
      if (maxBlock >= 3) n = r < 0.34 ? 1 : r < 0.82 ? 2 : 3;
      else n = r < (lvl === 0 ? 0.7 : 0.45) ? 1 : 2;
      const lanes = shuffle(all.slice()).slice(0, n).filter((l) => this.laneClear(l));
      if (lanes.length === 0) continue;
      const cands = lanes.map((l) => ({ lane: l, kindName: this.pickKind() }));
      cands.forEach((c) => { c.kind = Art.KINDS[c.kindName]; });
      if (!demo && !this.rowIsFair(cands)) continue;
      chosen = cands;
    }
    if (!chosen) return;
    chosen.forEach((c) => this.addCar(c.lane, c.kindName, demo));
    const open = all.filter((l) => !chosen.some((c) => c.lane === l));

    // coin line in an open lane
    if (!demo && Math.random() < 0.6) {
      const lanes = shuffle(open.slice()).filter((l) => !this.traffic.some((c) => c.lane === l && c.y < 220));
      if (lanes.length) {
        const lane = lanes[0];
        const n = randInt(3, 5);
        for (let i = 0; i < n; i++) {
          const spr = this.add.image(laneX(lane), -50 - i * 78, 'coin').setDepth(7).setScale(0.62);
          this.coinList.push({ spr, lane, y: -50 - i * 78, ph: i * 0.7 });
        }
      }
    }
  }

  updateTraffic(dt, playing) {
    const px = this.ux;
    const sorted = this.traffic.slice().sort((a, b) => b.y - a.y);
    for (const c of this.traffic) c.y += this.scroll * (1 - c.kind.f) * dt;
    // keep vehicles in the same lane from driving through each other
    const lastInLane = {};
    for (const c of sorted) {
      const ahead = lastInLane[c.lane];
      if (ahead) {
        const maxY = ahead.y - ahead.kind.h / 2 - 22 - c.kind.h / 2;
        if (c.y > maxY) c.y = maxY;
      }
      lastInLane[c.lane] = c;
    }
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const c = this.traffic[i];
      c.spr.setPosition(laneX(c.lane), c.y);
      c.spr.setScale(L.k * 0.5);
      if (c.y - c.kind.h / 2 > UNIT_H + 40) {
        c.spr.destroy();
        this.traffic.splice(i, 1);
        continue;
      }
      if (!playing || c.demo) continue;

      const hw = c.kind.w * 0.4 + PL.halfW;
      const hh = c.kind.h * 0.44 + PL.halfH;
      const dx = Math.abs(laneOffset(c.lane) - px);
      const dy = Math.abs(c.y - PLAYER_Y);
      if (dy < hh && dx < hw) { this.crash(c); return; }
      if (dy < hh + 36) c.minGap = Math.min(c.minGap, dx - hw);
      if (!c.passed && c.y - c.kind.h * 0.44 > PLAYER_Y + PL.halfH) {
        c.passed = true;
        this.dodges++;
        if (c.minGap < 20) this.closeCall(c);
      }
    }
  }

  closeCall(c) {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 3.2;
    const pts = 15 * Math.min(this.combo, 4);
    this.bonus += pts;
    Sfx.whoosh();
    const x = L.cx + this.ux * L.k;
    this.popText(this.combo > 1 ? `CLOSE CALL x${this.combo}  +${pts}` : `CLOSE CALL  +${pts}`, x, PLAYER_Y - 140, '#ffe27a');
    for (let i = 0; i < 10; i++) {
      this.parts.push({ x: x + rand(-36, 36), y: PLAYER_Y + rand(-60, 60), vx: rand(-60, 60), vy: rand(200, 420), life: 0, max: rand(0.25, 0.45), size: rand(3, 5), color: 0xffffff, grav: 0, shape: 'circle' });
    }
  }

  /* --------------------------------------------------------------- coins */

  updateCoins(dt, playing) {
    const spd = this.scroll * 0.45;         // never faster than any vehicle -> coins never clip cars
    const px = this.ux;
    for (let i = this.coinList.length - 1; i >= 0; i--) {
      const c = this.coinList[i];
      c.y += spd * dt;
      c.ph += dt * 5;
      c.spr.setPosition(laneX(c.lane), c.y);
      c.spr.setScale(0.62 * Math.max(0.12, Math.abs(Math.cos(c.ph))) , 0.62);
      if (c.y > UNIT_H + 60) { c.spr.destroy(); this.coinList.splice(i, 1); continue; }
      if (playing && Math.abs(c.y - PLAYER_Y) < PL.halfH + 26 && Math.abs(laneOffset(c.lane) - px) < PL.halfW + 28) {
        this.runCoins++;
        Sfx.coin();
        const x = c.spr.x;
        for (let n = 0; n < 8; n++) {
          const a = rand(0, Math.PI * 2);
          this.parts.push({ x, y: c.y, vx: Math.cos(a) * rand(80, 260), vy: Math.sin(a) * rand(80, 260), life: 0, max: rand(0.25, 0.5), size: rand(3, 6), color: 0xffd447, grav: 0, shape: 'circle' });
        }
        c.spr.destroy();
        this.coinList.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------- effects */

  popText(str, x, y, color) {
    const t = mkText(this, L.cx, y, str, 40, color).setDepth(36);
    fitText(t, L.Wu * 0.92);
    t.x = clamp(x, t.displayWidth / 2 + 12, L.Wu - t.displayWidth / 2 - 12);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900, ease: 'Cubic.Out', onComplete: () => { const i = this.texts.indexOf(t); if (i >= 0) this.texts.splice(i, 1); t.destroy(); } });
  }

  toast(str) {
    const t = mkText(this, L.cx, 330, str, 84, '#4ee59a').setDepth(36).setAlpha(0);
    const fit = Math.min(1, (L.Wu * 0.9) / Math.max(1, t.width));
    t.setScale(fit * 0.6);
    this.tweens.add({ targets: t, alpha: 1, scale: fit, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 400, onComplete: () => { const i = this.texts.indexOf(t); if (i >= 0) this.texts.splice(i, 1); t.destroy(); } });
  }

  updateFx(dt) {
    const g = this.gFx;
    g.clear();
    // speed streaks
    const speedT = clamp((this.scroll - 650) / 600, 0, 1);
    if (this.state !== 'menu' && speedT > 0 && this.streaks.length < 16 && Math.random() < speedT * 0.9) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.streaks.push({ x: L.cx + side * rand(ROAD_W * 0.18, ROAD_W * 0.62) * L.k, y: -120, len: rand(110, 260) });
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.y += this.scroll * 1.5 * dt;
      if (s.y - s.len > UNIT_H) { this.streaks.splice(i, 1); continue; }
      g.lineStyle(3 * L.k, 0xffffff, 0.16 * speedT + 0.04);
      g.beginPath(); g.moveTo(s.x, s.y - s.len); g.lineTo(s.x, s.y); g.strokePath();
    }
    // exhaust
    if (this.state === 'playing' && Math.random() < dt * 40) {
      const x = L.cx + this.ux * L.k + rand(-14, 14) * L.k;
      this.parts.push({ x, y: PLAYER_Y + 62, vx: rand(-14, 14), vy: rand(40, 110), life: 0, max: rand(0.3, 0.55), size: rand(7, 12), color: 0xcfd6de, grav: 0, shape: 'circle', soft: true, grow: 16 });
    }
    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      const s = p.size + (p.grow ? p.grow * p.life : 0);
      g.fillStyle(p.color, p.soft ? a * 0.4 : a);
      if (p.shape === 'rect') {
        p.rot += (p.spin || 0) * dt;
        const c = Math.cos(p.rot), sn = Math.sin(p.rot);
        g.beginPath();
        g.moveTo(p.x + (-s * c + s * 0.5 * sn), p.y + (-s * sn - s * 0.5 * c));
        g.lineTo(p.x + (s * c + s * 0.5 * sn), p.y + (s * sn - s * 0.5 * c));
        g.lineTo(p.x + (s * c - s * 0.5 * sn), p.y + (s * sn + s * 0.5 * c));
        g.lineTo(p.x + (-s * c - s * 0.5 * sn), p.y + (-s * sn + s * 0.5 * c));
        g.closePath();
        g.fillPath();
      } else {
        g.fillCircle(p.x, p.y, s);
      }
    }
  }

  /* -------------------------------------------------------------- update */

  speedTarget() {
    return 500 + 520 * (1 - Math.exp(-this.dist / 110000));
  }

  updatePlayer(dt, steer) {
    const accel = 4600;
    const maxV = 640;
    if (steer !== 0) {
      const turning = Math.sign(steer) !== Math.sign(this.vx) && this.vx !== 0;
      this.vx += steer * accel * (turning ? 1.8 : 1) * dt;
    } else {
      this.vx *= Math.exp(-10 * dt);
      if (Math.abs(this.vx) < 4) this.vx = 0;
    }
    this.vx = clamp(this.vx, -maxV, maxV);
    this.ux += this.vx * dt;
    const lim = ROAD_W / 2 - PL.halfW - 12;
    if (this.ux < -lim) { this.ux = -lim; this.vx = 0; }
    if (this.ux > lim) { this.ux = lim; this.vx = 0; }
    this.rot += (clamp(this.vx / 900, -0.2, 0.2) - this.rot) * Math.min(1, dt * 14);
  }

  placePlayer(bob) {
    const x = L.cx + this.ux * L.k;
    this.player.setPosition(x, PLAYER_Y + (bob || 0));
    this.player.setScale(L.k * 0.5);
    this.player.setRotation(this.rot);
    const a = this.darkness > 0.12 && this.state !== 'over' ? clamp(this.darkness * 1.3, 0, 0.7) : 0;
    this.beamL.setAlpha(a).setPosition(x - 18 * L.k, PLAYER_Y - 56).setScale(L.k * 1.1, 1.4);
    this.beamR.setAlpha(a).setPosition(x + 18 * L.k, PLAYER_Y - 56).setScale(L.k * 1.1, 1.4);
  }

  update(time, delta) {
    this.frames++;
    if (this.frames === 3) Platform.gameReady();       // the menu is on screen and interactive
    if (this.hostPaused) return;

    const real = Math.min(delta / 1000, 0.05);
    this.drawStep(real, time);
  }

  /** One simulation + render step (also callable directly by automated tests). */
  drawStep(realDt, time) {
    const dt = realDt * this.timeScale;
    this.time_ += realDt;
    if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + realDt * 0.8);

    if (this.state === 'menu') {
      this.scroll += (340 - this.scroll) * Math.min(1, dt * 3);
      this.advanceWorld(dt);
      this.rowTimer -= dt;
      if (this.rowTimer <= 0 && this.traffic.length < 6) { this.spawnRow(true); this.rowTimer = rand(1.3, 2.2); }
      this.updateTraffic(dt, false);
      this.updateCoins(dt, false);
      this.rot += (0 - this.rot) * Math.min(1, dt * 6);
      this.placePlayer(Math.sin(time / 420) * 2);
      const f = Math.sin(time / 700) * 6;
      this.menu.title1.y = 250 + f;
      this.menu.title2.y = 366 + f;
      this.menu.btn.draw(time);
    } else if (this.state === 'playing') {
      this.playStep(dt, time);
    } else if (this.state === 'over') {
      this.overStep(dt, realDt, time);
    }

    this.updateScenery(dt);
    this.drawBg();
    this.updateFx(dt);
    this.updateDusk();
    if (this.state !== 'menu') this.updateHud();
  }

  advanceWorld(dt) {
    this.scrollPos += this.scroll * dt;
  }

  updateDusk() {
    // slow day -> dusk -> night -> dawn cycle
    const phase = (this.dist % 190000) / 190000;
    const target = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    this.darkness += (target - this.darkness) * 0.02;
    this.dusk.setAlpha(this.darkness * 0.5);
  }

  playStep(dt, time) {
    // easing speed
    const target = this.speedTarget();
    this.scroll += (target - this.scroll) * Math.min(1, dt * 2.2);
    this.dist += this.scroll * dt;
    this.advanceWorld(dt);

    // level up
    const lvl = Math.floor(this.dist / 9000);
    if (lvl > this.level) {
      this.level = lvl;
      this.toast('SPEED UP!');
      Sfx.levelUp();
    }

    this.updatePlayer(dt, this.readSteer());

    // spawn
    this.rowTimer -= dt;
    if (this.rowTimer <= 0) {
      this.spawnRow(false);
      const base = Math.max(0.78, 1.25 - this.level * 0.06);
      this.rowTimer = base * rand(0.85, 1.25);
    }

    this.updateTraffic(dt, true);
    if (this.state !== 'playing') return;       // crashed during traffic update
    this.updateCoins(dt, true);

    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    this.score = this.dist / 55 + this.dodges * 10 + this.runCoins * 25 + this.bonus;
    Sfx.engineSet(clamp((this.scroll - 500) / 850, 0, 1));
    this.placePlayer(0);
  }

  overStep(dt, realDt, time) {
    this.overTimer += realDt;
    this.scroll *= Math.exp(-dt * 4.5);
    this.advanceWorld(dt);
    this.updateTraffic(dt, false);
    this.updateCoins(dt, false);
    this.ux += this.crashVx * dt;
    this.crashVx *= Math.exp(-dt * 4);
    this.rot += this.crashSpin * dt;
    this.crashSpin *= Math.exp(-dt * 3.2);
    const lim = ROAD_W / 2 - 20;
    this.ux = clamp(this.ux, -lim, lim);
    this.placePlayer(0);

    if (!this.over.shown && this.overTimer > 0.85) this.showOver();
    if (this.over.shown) {
      this.overAnim = Math.min(1, (this.overAnim || 0) + realDt * 4);
      this.drawOverPanel(this.overAnim);
      if (this.overTimer > 1.35) this.overReady = true;
      this.over.btn.draw(time);
    }
  }

  /* ----------------------------------------------------------- host hooks */

  hostPause() {
    if (this.hostPaused) return;
    this.hostPaused = true;
    this.steerPointer = null;
    Platform.saveProgress(this.save);
  }

  hostResume() {
    if (!this.hostPaused) return;
    this.hostPaused = false;
    this.steerPointer = null;
    this.input.keyboard.resetKeys();
    if (this.state === 'playing') {
      Sfx.engineStart();
      this.freezeReady(1.0);
    }
  }

  /** Short "get ready" freeze after the host resumes a run in progress. */
  freezeReady(sec) {
    this.readyText.setVisible(true);
    this.timeScale = 0;
    this.time.delayedCall(sec * 1000, () => {
      this.readyText.setVisible(false);
      if (this.state === 'playing') this.timeScale = 1;
    });
  }
}

/* ===================================================================== */
/*  Bootstrap                                                            */
/* ===================================================================== */

(function bootstrap() {
  const m = measure();
  computeLayout(m);

  Sfx.setEnabled(Platform.isAudioEnabled());
  Platform.onAudioEnabledChange((on) => Sfx.setEnabled(on));

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: m.pw,
    height: m.ph,
    backgroundColor: '#1c3d2b',
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true },                       // we use our own Web Audio synth
    scale: { mode: Phaser.Scale.NONE, zoom: m.cw / m.pw, autoCenter: Phaser.Scale.NO_CENTER },
    render: { antialias: true, powerPreference: 'high-performance' },
    input: { keyboard: true, mouse: true, touch: true, gamepad: false },
    fps: { target: 60 },
    scene: [BootScene, PlayScene]
  });

  // ---- Responsive resize (keeps game state; only layout is recomputed) ----
  let pending = false;
  function onWindowResize() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const n = measure();
      if (n.pw === L.pw && n.ph === L.ph && n.cw === L.cw) return;
      computeLayout(n);
      game.scale.resize(n.pw, n.ph);
      game.scale.setZoom(n.cw / n.pw);
      game.events.emit('td-layout');
    });
  }
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onWindowResize);

  // ---- Host pause / resume (SDK onPause/onResume; never the Page Visibility API in Playables) ----
  Platform.onPauseResume(
    () => {
      const s = game.scene.getScene('play');
      if (s && s.scene.isActive()) s.hostPause();
      Sfx.hostPause();
      game.loop.sleep();
    },
    () => {
      Sfx.hostResume();
      game.loop.wake();
      const s = game.scene.getScene('play');
      if (s && s.scene.isActive()) s.hostResume();
    }
  );

  if (location.search.indexOf('debug') >= 0) window.__game = game;
})();
