// Avatar que hace las señas con el movimiento grabado al entrenar (prototipo de cada seña).
import { T, F } from './ml.js';

const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const FRAME_MS = 95, GAP_MS = 260, EDGE_MS = 350;

export class Avatar {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.tl = null; this.t0 = 0; this.onSign = () => {}; this.onEnd = () => {};
    this.resize(); addEventListener('resize', () => this.resize());
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  resize() {
    const r = this.c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.c.width = Math.max(1, r.width * dpr); this.c.height = Math.max(1, r.height * dpr);
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.SW = Math.min(this.W * 0.34, this.H * 0.42);          // ancho de hombros
    this.nose = [this.W / 2, this.H * 0.3];
  }
  // Puntos de una mano en píxeles (en espejo, como la ve quien firma), o null.
  hand(proto, k, s) {
    const o = k * F + s * 66;
    if (proto[o + 65] < 0.5) return null;
    const SW = this.SW, HS = SW * 0.5, [nx, ny] = this.nose;
    const wx = nx - proto[o + 63] * SW, wy = ny + proto[o + 64] * SW;
    const pts = [];
    for (let j = 0; j < 21; j++) pts.push([wx - proto[o + j * 3] * HS, wy + proto[o + j * 3 + 1] * HS]);
    return pts;
  }
  // Si la seña se sale del cuadro (p. ej. no se vio el cuerpo al grabar), la mueve y achica sin cambiar su forma.
  encuadrar(fr) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of fr) for (const p of f) if (p) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!isFinite(x0)) return;
    const m = 0.06, L = this.W * m, R = this.W * (1 - m), U = this.H * 0.08, D = this.H * 0.92;
    if (x0 >= L && x1 <= R && y0 >= U && y1 <= D) return;
    const k = Math.min(1, (R - L) / (x1 - x0), (D - U) / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tx = Math.min(R - (x1 - cx) * k, Math.max(L + (cx - x0) * k, cx));
    const ty = Math.min(D - (y1 - cy) * k, Math.max(U + (cy - y0) * k, Math.min(cy, this.nose[1] + this.SW * 1.1)));
    for (const f of fr) for (let s = 0; s < 2; s++) if (f[s]) f[s] = f[s].map(([x, y]) => [tx + (x - cx) * k, ty + (y - cy) * k]);
  }
  // Recibe [{label, proto}] y arma la línea de tiempo.
  play(signs) {
    const keys = [];
    let t = 0;
    keys.push({ t, h: [null, null], label: null });
    t += EDGE_MS;
    let gapPrev = GAP_MS;
    for (const sg of signs) {
      const { label, proto } = sg;
      const paso = (sg.dur || T * FRAME_MS) / T, gap = sg.gap ?? GAP_MS;
      const fr = [];
      for (let k = 0; k < T; k++) fr.push([this.hand(proto, k, 0), this.hand(proto, k, 1)]);
      this.encuadrar(fr);
      for (const h of fr) { keys.push({ t, h, label, sg }); t += paso; }
      t += gap - paso; gapPrev = gap;
    }
    t += EDGE_MS - gapPrev + FRAME_MS;
    keys.push({ t, h: [null, null], label: null });
    // Donde falta una mano, se la lleva abajo (fuera de cuadro) desde su última posición.
    for (const s of [0, 1]) {
      let last = null;
      for (const kf of keys) { if (kf.h[s]) last = kf.h[s]; else kf['r' + s] = last; }
      last = null;
      for (let i = keys.length - 1; i >= 0; i--) { const kf = keys[i]; if (kf.h[s]) last = kf.h[s]; else if (!kf['r' + s]) kf['r' + s] = last; }
      for (const kf of keys) if (!kf.h[s]) { const r = kf['r' + s]; kf.h[s] = r ? r.map(([x, y]) => [x, y + this.H * 0.75]) : null; kf['a' + s] = 0; } else kf['a' + s] = 1;
    }
    this.tl = keys; this.t0 = performance.now(); this.lastSg = undefined;
  }
  // Mano: palma y dedos como una sola silueta (primero todo el contorno, luego todo el relleno,
  // así las articulaciones no quedan rayadas). El grosor sale del tamaño de la mano.
  mano(p, piel, borde, brillo) {
    const x = this.x, d = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
    const t = Math.max(4, Math.min(d(0, 9), d(5, 17) * 1.8) * 0.2);        // grosor de un dedo
    const dedos = [[1, 2, 3, 4, 1.15], [5, 6, 7, 8, 1], [9, 10, 11, 12, 1.03], [13, 14, 15, 16, 0.95], [17, 18, 19, 20, 0.82]];
    const palma = [0, 1, 5, 9, 13, 17];
    const capa = (color, extra) => {
      x.fillStyle = x.strokeStyle = color; x.lineCap = x.lineJoin = 'round';
      x.lineWidth = t * 0.9 + extra;
      x.beginPath(); palma.forEach((j, i) => i ? x.lineTo(...p[j]) : x.moveTo(...p[j])); x.closePath(); x.fill(); x.stroke();
      for (const f of dedos) {
        // dedo afinándose hacia la punta: un trazo por falange
        for (let i = 0; i < 3; i++) {
          x.lineWidth = t * f[4] * (1 - i * 0.1) + extra;
          x.beginPath(); x.moveTo(...p[f[i]]); x.lineTo(...p[f[i + 1]]); x.stroke();
        }
      }
    };
    capa(borde, 3);
    capa(piel, 0);
    // pliegues suaves de los nudillos y uñas luminosas
    x.strokeStyle = borde; x.globalAlpha *= 0.35; x.lineWidth = 1;
    for (const f of dedos) for (const j of [f[1], f[2]]) {
      const [ax, ay] = p[j], [bx, by] = p[j + 1], L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / L * t * 0.3, ny = (bx - ax) / L * t * 0.3;
      x.beginPath(); x.moveTo(ax - nx, ay - ny); x.lineTo(ax + nx, ay + ny); x.stroke();
    }
    x.globalAlpha /= 0.35;
    x.save(); x.shadowColor = brillo; x.shadowBlur = 8; x.fillStyle = brillo;
    for (const f of dedos) { const [px, py] = p[f[3]]; x.beginPath(); x.arc(px, py, t * 0.22, 0, Math.PI * 2); x.fill(); }
    x.restore();
  }
  draw() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;                 // pestaña oculta
    if (Math.abs(r.width - this.W) > 0.5 || Math.abs(r.height - this.H) > 0.5) this.resize();
    const { x, W, H, dpr } = this;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const css = getComputedStyle(this.c);
    const piel = css.getPropertyValue('--piel').trim() || '#e0a27a';
    const ropa = css.getPropertyValue('--ropa').trim() || '#d9480f';
    const borde = css.getPropertyValue('--borde').trim() || '#3b2a20';
    const [nx, ny] = this.nose, SW = this.SW;
    const hombros = [[nx - SW / 2, ny + SW * 0.62], [nx + SW / 2, ny + SW * 0.62]];

    // Estado actual
    let hands = [null, null], alpha = [0, 0];
    if (this.tl) {
      const t = performance.now() - this.t0, tl = this.tl;
      if (t >= tl[tl.length - 1].t) { this.tl = null; this.onSign(null); this.onEnd(); }
      else {
        let i = 0; while (i < tl.length - 2 && tl[i + 1].t <= t) i++;
        const A = tl[i], B = tl[i + 1], u = Math.min(1, (t - A.t) / Math.max(1, B.t - A.t));
        const e = u * u * (3 - 2 * u);
        for (const s of [0, 1]) {
          if (!A.h[s] || !B.h[s]) continue;
          hands[s] = A.h[s].map(([ax, ay], j) => [ax + (B.h[s][j][0] - ax) * e, ay + (B.h[s][j][1] - ay) * e]);
          alpha[s] = A['a' + s] + (B['a' + s] - A['a' + s]) * e;
        }
        const K = u < 0.5 ? A : B;
        if (K.sg !== this.lastSg) { this.lastSg = K.sg; if (K.label) this.onSign(K.label, K.sg); }
      }
    }

    const brillo = css.getPropertyValue('--ropa2').trim() || '#22d3ee';
    const resp = Math.sin(performance.now() / 900) * SW * 0.012;   // respiración
    const hy = (y) => y + resp;

    // Cuerpo: traje oscuro con borde luminoso
    x.lineJoin = x.lineCap = 'round';
    x.save();
    x.shadowColor = brillo; x.shadowBlur = 18;
    x.fillStyle = ropa; x.strokeStyle = brillo; x.lineWidth = 2;
    x.beginPath();
    x.moveTo(hombros[0][0] - SW * 0.08, H + 10);
    x.lineTo(hombros[0][0] - SW * 0.05, hy(hombros[0][1] + SW * 0.1));
    x.quadraticCurveTo(hombros[0][0], hy(hombros[0][1] - SW * 0.08), nx, hy(hombros[0][1] - SW * 0.1));
    x.quadraticCurveTo(hombros[1][0], hy(hombros[1][1] - SW * 0.08), hombros[1][0] + SW * 0.05, hy(hombros[1][1] + SW * 0.1));
    x.lineTo(hombros[1][0] + SW * 0.08, H + 10);
    x.closePath(); x.fill(); x.stroke();
    x.restore();
    // Líneas del traje
    x.strokeStyle = brillo; x.globalAlpha = 0.35; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(nx, hy(hombros[0][1] - SW * 0.02)); x.lineTo(nx, H); x.stroke();
    for (const d of [-1, 1]) { x.beginPath(); x.moveTo(nx + d * SW * 0.18, hy(hombros[0][1] + SW * 0.05)); x.lineTo(nx + d * SW * 0.26, H); x.stroke(); }
    x.globalAlpha = 1;
    // Cuello y cabeza
    x.fillStyle = piel; x.strokeStyle = borde; x.lineWidth = 2;
    x.fillRect(nx - SW * 0.09, hy(ny + SW * 0.2), SW * 0.18, SW * 0.3);
    x.beginPath(); x.ellipse(nx, hy(ny - SW * 0.05), SW * 0.27, SW * 0.33, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    // Cara amable (parpadea de vez en cuando)
    const parpadeo = (performance.now() % 4200) < 140;
    x.fillStyle = borde;
    for (const d of [-1, 1]) {
      x.beginPath();
      if (parpadeo) x.fillRect(nx + d * SW * 0.1 - SW * 0.03, hy(ny - SW * 0.08), SW * 0.06, SW * 0.008 + 1);
      else x.arc(nx + d * SW * 0.1, hy(ny - SW * 0.08), SW * 0.025, 0, Math.PI * 2);
      x.fill();
    }
    x.beginPath(); x.arc(nx, hy(ny + SW * 0.04), SW * 0.08, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    // Auricular con micrófono (toque tecnológico)
    x.strokeStyle = brillo; x.lineWidth = SW * 0.025;
    x.beginPath(); x.ellipse(nx, hy(ny - SW * 0.05), SW * 0.3, SW * 0.36, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
    x.beginPath(); x.moveTo(nx + SW * 0.28, hy(ny)); x.quadraticCurveTo(nx + SW * 0.26, hy(ny + SW * 0.2), nx + SW * 0.08, hy(ny + SW * 0.16)); x.stroke();
    x.fillStyle = brillo; x.beginPath(); x.arc(nx + SW * 0.28, hy(ny - SW * 0.02), SW * 0.045, 0, Math.PI * 2); x.fill();

    // Brazos y manos
    for (const s of [0, 1]) {
      const p = hands[s]; if (!p || alpha[s] <= 0.01) continue;
      x.globalAlpha = Math.max(0, Math.min(1, alpha[s]));
      const w = p[0], h = w[0] < nx ? hombros[0] : hombros[1];
      const codo = [(h[0] + w[0]) / 2 + (w[0] < nx ? -1 : 1) * SW * 0.12, Math.max(h[1], w[1]) + SW * 0.25];
      x.save(); x.shadowColor = brillo; x.shadowBlur = 12;
      x.strokeStyle = brillo; x.lineWidth = SW * 0.17;
      x.beginPath(); x.moveTo(h[0], hy(h[1])); x.quadraticCurveTo(codo[0], codo[1], w[0], w[1]); x.stroke();
      x.restore();
      x.strokeStyle = ropa; x.lineWidth = SW * 0.15;
      x.beginPath(); x.moveTo(h[0], hy(h[1])); x.quadraticCurveTo(codo[0], codo[1], w[0], w[1]); x.stroke();
      this.mano(p, piel, borde, brillo);
      x.globalAlpha = 1;
    }
  }
}
