'use strict';

/**
 * Every visual in the game is drawn procedurally with the Canvas 2D API.
 * The vehicle designs are generic shapes created for this project - they do not copy any real
 * car model, brand, logo or trade dress.
 */
const Art = (() => {
  /** Vehicle classes. w/h are in design units (a lane is 130 units wide). */
  const KINDS = {
    sedan: { w: 68, h: 128, f: 0.42 },
    suv:   { w: 74, h: 138, f: 0.40 },
    sport: { w: 64, h: 120, f: 0.55 },
    van:   { w: 76, h: 178, f: 0.34 },
    truck: { w: 82, h: 252, f: 0.28 }
  };

  const PALETTE = ['#e5484d', '#f5a524', '#9b5de5', '#e8eef5', '#22b8a8', '#8a97a8'];
  const PAD = 16;     // transparent padding around a vehicle (for its shadow)
  const SS = 2;       // texture supersampling (textures are shown at scale 0.5 * k)

  /* ------------------------------------------------------------- helpers */

  function mix(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `rgb(${r},${g},${b})`;
  }

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function poly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return c;
  }

  /* ------------------------------------------------------------ vehicles */

  function drawVehicle(g, kindName, color, isPlayer) {
    const k = KINDS[kindName];
    const w = k.w, h = k.h;
    const glass = '#16222e';
    const glassHi = 'rgba(160,215,255,0.35)';

    // soft shadow
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(0,0,0,0.07)';
      rr(g, 3 - i * 1.3, 7 - i * 1.3, w + i * 2.6 - 2, h + i * 2.6 - 4, 14 + i);
      g.fill();
    }

    // wheels
    g.fillStyle = '#0d1116';
    const wheelYs = kindName === 'truck'
      ? [h * 0.06, h * 0.55, h * 0.8]
      : kindName === 'van'
        ? [h * 0.12, h * 0.76]
        : [h * 0.16, h * 0.72];
    wheelYs.forEach((y) => {
      rr(g, -3, y, 8, 24, 3); g.fill();
      rr(g, w - 5, y, 8, 24, 3); g.fill();
    });

    // body
    const body = g.createLinearGradient(0, 0, w, 0);
    body.addColorStop(0, mix(color, -0.32));
    body.addColorStop(0.28, mix(color, 0.1));
    body.addColorStop(0.72, mix(color, 0.0));
    body.addColorStop(1, mix(color, -0.34));

    if (kindName === 'truck') {
      // cab
      g.fillStyle = body;
      rr(g, 0, 0, w, h * 0.2, 12); g.fill();
      // trailer
      const trailer = g.createLinearGradient(0, 0, w, 0);
      trailer.addColorStop(0, '#aeb9c6');
      trailer.addColorStop(0.3, '#e9eff5');
      trailer.addColorStop(0.7, '#dfe6ee');
      trailer.addColorStop(1, '#9aa7b6');
      g.fillStyle = trailer;
      rr(g, 1, h * 0.215, w - 2, h * 0.785, 6); g.fill();
      g.strokeStyle = 'rgba(40,55,70,0.35)';
      g.lineWidth = 1.2;
      for (let i = 1; i < 8; i++) {
        const y = h * 0.215 + (h * 0.785) * (i / 8);
        g.beginPath(); g.moveTo(5, y); g.lineTo(w - 5, y); g.stroke();
      }
      g.fillStyle = glass;
      rr(g, 8, h * 0.045, w - 16, h * 0.06, 4); g.fill();
      g.fillStyle = '#ff3b30';
      rr(g, 5, h - 7, 14, 5, 2); g.fill();
      rr(g, w - 19, h - 7, 14, 5, 2); g.fill();
    } else if (kindName === 'van') {
      g.fillStyle = body;
      rr(g, 0, 0, w, h, 14); g.fill();
      g.fillStyle = glass;
      poly(g, [[9, h * 0.19], [w - 9, h * 0.19], [w - 6, h * 0.1], [6, h * 0.1]]); g.fill();
      g.fillStyle = mix(color, 0.16);
      rr(g, 7, h * 0.23, w - 14, h * 0.7, 6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1.5;
      for (let i = 1; i < 5; i++) {
        const y = h * 0.23 + (h * 0.7) * (i / 5);
        g.beginPath(); g.moveTo(10, y); g.lineTo(w - 10, y); g.stroke();
      }
    } else {
      // sedan / suv / sport share a passenger-car silhouette
      g.fillStyle = body;
      rr(g, 0, 0, w, h, kindName === 'sport' ? 20 : 16); g.fill();
      // hood highlight
      g.fillStyle = 'rgba(255,255,255,0.10)';
      rr(g, 9, h * 0.04, w - 18, h * 0.2, 8); g.fill();
      // windshield
      g.fillStyle = glass;
      poly(g, [[8, h * 0.4], [w - 8, h * 0.4], [w - 11, h * 0.26], [11, h * 0.26]]); g.fill();
      g.fillStyle = glassHi;
      poly(g, [[13, h * 0.37], [w * 0.5, h * 0.37], [w * 0.46, h * 0.29], [17, h * 0.29]]); g.fill();
      // roof
      g.fillStyle = mix(color, 0.2);
      rr(g, 8, h * 0.4, w - 16, h * (kindName === 'suv' ? 0.3 : 0.22), 5); g.fill();
      // rear window
      const ry = h * (kindName === 'suv' ? 0.7 : 0.62);
      g.fillStyle = glass;
      poly(g, [[10, ry], [w - 10, ry], [w - 13, ry + h * 0.1], [13, ry + h * 0.1]]); g.fill();
      // mirrors
      g.fillStyle = mix(color, -0.2);
      rr(g, -4, h * 0.32, 7, 9, 3); g.fill();
      rr(g, w - 3, h * 0.32, 7, 9, 3); g.fill();
      // sport extras: twin stripes + spoiler
      if (kindName === 'sport') {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(w * 0.5 - 7, 4, 4, h * 0.2);
        g.fillRect(w * 0.5 + 3, 4, 4, h * 0.2);
        g.fillRect(w * 0.5 - 7, h * 0.72, 4, h * 0.24);
        g.fillRect(w * 0.5 + 3, h * 0.72, 4, h * 0.24);
        g.fillStyle = '#10151b';
        rr(g, 3, h - 14, w - 6, 7, 3); g.fill();
      }
      if (isPlayer) {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.fillRect(w * 0.5 - 6, 3, 3.5, h * 0.2);
        g.fillRect(w * 0.5 + 2.5, 3, 3.5, h * 0.2);
        g.fillRect(w * 0.5 - 6, h * 0.72, 3.5, h * 0.25);
        g.fillRect(w * 0.5 + 2.5, h * 0.72, 3.5, h * 0.25);
      }
    }

    // outline
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.lineWidth = 1.6;
    rr(g, 0, 0, w, h, kindName === 'truck' ? 10 : 16);
    g.stroke();

    // headlights (front = top) and tail lights (rear = bottom)
    if (kindName !== 'truck') {
      const hl = g.createLinearGradient(0, 0, 0, 10);
      hl.addColorStop(0, '#fffbe0');
      hl.addColorStop(1, '#ffe27a');
      g.fillStyle = hl;
      rr(g, 5, 2, 15, 6, 3); g.fill();
      rr(g, w - 20, 2, 15, 6, 3); g.fill();
      g.fillStyle = '#ff3b30';
      rr(g, 5, h - 8, 15, 6, 2); g.fill();
      rr(g, w - 20, h - 8, 15, 6, 2); g.fill();
    } else {
      g.fillStyle = '#fffbe0';
      rr(g, 5, 2, 14, 5, 2); g.fill();
      rr(g, w - 19, 2, 14, 5, 2); g.fill();
    }
  }

  function makeVehicle(scene, key, kindName, color, isPlayer) {
    const k = KINDS[kindName];
    const c = canvas((k.w + PAD * 2) * SS, (k.h + PAD * 2) * SS);
    const g = c.getContext('2d');
    g.scale(SS, SS);
    g.translate(PAD, PAD);
    drawVehicle(g, kindName, color, isPlayer);
    scene.textures.addCanvas(key, c);
  }

  /* ---------------------------------------------------------------- misc */

  function makeCoin(scene) {
    const S = 80;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S * 0.48);
    rad.addColorStop(0, '#fff3a6');
    rad.addColorStop(0.55, '#ffcf3a');
    rad.addColorStop(1, '#d58a00');
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(S / 2 + 2, S / 2 + 5, S * 0.42, 0, Math.PI * 2); g.fill();
    g.fillStyle = rad;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#b87400';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.29, 0.2, Math.PI * 1.3); g.stroke();
    g.fillStyle = 'rgba(184,116,0,0.55)';
    rr(g, S / 2 - 4, S / 2 - 15, 8, 30, 3); g.fill();
    scene.textures.addCanvas('coin', c);
  }

  function makeTree(scene, key, size, shades, lumps) {
    const c = canvas(size * 2, size * 2);
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(size * 0.54, size * 0.6, size * 0.44, size * 0.4, 0, 0, Math.PI * 2); g.fill();
    let seed = size * 13;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let layer = 0; layer < shades.length; layer++) {
      g.fillStyle = shades[layer];
      const r = size * (0.42 - layer * 0.07);
      for (let i = 0; i < lumps; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * size * 0.14 * (1 + layer * 0.3);
        g.beginPath();
        g.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d - layer * 2, r * (0.7 + rnd() * 0.3), 0, Math.PI * 2);
        g.fill();
      }
    }
    scene.textures.addCanvas(key, c);
  }

  function makeRock(scene) {
    const S = 36;
    const c = canvas(S * 2, S * 2);
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.ellipse(S * 0.54, S * 0.6, S * 0.4, S * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7c8794';
    poly(g, [[6, 24], [10, 9], [22, 6], [31, 15], [28, 27], [14, 30]]); g.fill();
    g.fillStyle = '#a3afbb';
    poly(g, [[10, 9], [22, 6], [24, 14], [13, 17]]); g.fill();
    scene.textures.addCanvas('rock', c);
  }

  function makeBeam(scene) {
    const W = 260, H = 520;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(255,244,200,0.55)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    g.fillStyle = grad;
    poly(g, [[W * 0.4, H], [W * 0.6, H], [W, 0], [0, 0]]);
    g.fill();
    scene.textures.addCanvas('beam', c);
  }

  function makeSpark(scene) {
    const S = 32;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, S, S);
    scene.textures.addCanvas('spark', c);
  }

  /** Builds every texture once. Called from the loading screen. */
  function buildAll(scene) {
    PALETTE.forEach((col, i) => {
      ['sedan', 'suv', 'sport', 'van'].forEach((kind) => makeVehicle(scene, `car_${kind}_${i}`, kind, col, false));
    });
    ['#f0f3f7', '#c9d2dc', '#e0b34a'].forEach((col, i) => makeVehicle(scene, `car_truck_${i}`, 'truck', col, false));
    makeVehicle(scene, 'car_player', 'sedan', '#2f7bff', true);
    makeCoin(scene);
    makeTree(scene, 'tree_a', 96, ['#1f5a35', '#2b7a46', '#3b9a58'], 5);
    makeTree(scene, 'tree_b', 76, ['#1b4d36', '#25704a', '#33905f'], 4);
    makeTree(scene, 'bush', 48, ['#2a6e3c', '#3a8c4b'], 3);
    makeRock(scene);
    makeBeam(scene);
    makeSpark(scene);
  }

  /** Texture key for a traffic vehicle. */
  function trafficKey(kind, variant) {
    if (kind === 'truck') return `car_truck_${variant % 3}`;
    return `car_${kind}_${variant % PALETTE.length}`;
  }

  return { KINDS, PALETTE, buildAll, trafficKey };
})();
