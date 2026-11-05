/* ============================================================
   PDFConvert.net – Dokumentenscanner
   Erkennt das Blatt auf einem Foto, entzerrt es perspektivisch und
   bereitet es wie einen Flachbett-Scan auf (weißes Papier, klarer Text).
   Läuft vollständig lokal im Browser, ohne externe Bibliotheken.
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_SRC = 3200;     // Fotos werden höchstens mit dieser Kantenlänge verarbeitet
  const OUT_MAX = 2480;     // lange Seite der Scan-Ausgabe (ca. 210 dpi bei A4)
  const OUT_MIN = 1600;     // kleine Fotos werden für bessere Lesbarkeit/Texterkennung auf mindestens diese Größe gebracht
  const DET_SIZE = 420;     // Arbeitsgröße für die Randerkennung
  const REF_SIZE = 1100;    // Arbeitsgröße für die Feinanpassung der Ränder
  const MIN_SCORE = 0.52;   // darunter gilt „kein Dokument erkannt“
  const A4 = Math.SQRT2;

  /* ---------- Bild laden (EXIF-Ausrichtung übernimmt der Browser) ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const k = Math.min(1, MAX_SRC / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k));
          c.height = Math.max(1, Math.round(h * k));
          const x = c.getContext('2d');
          x.imageSmoothingQuality = 'high';
          x.drawImage(img, 0, 0, c.width, c.height);
          resolve(c);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden (Format evtl. nicht unterstützt, z. B. HEIC).')); };
      img.src = url;
    });
  }

  /* ---------- Bildhilfen ---------- */
  function scaled(canvas, maxSide) {
    const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, w, h);
    return { c, x, w, h, k: w / canvas.width };
  }
  function grayData(canvas, maxSide) {
    const s = scaled(canvas, maxSide);
    const d = s.x.getImageData(0, 0, s.w, s.h).data;
    const g = new Float32Array(s.w * s.h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { g, w: s.w, h: s.h, k: s.k };
  }
  // separierbarer Kastenfilter mit gleitender Summe
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / n;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / n;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function maxFilter(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let d = -r; d <= r; d++) { const v = src[y * w + Math.min(w - 1, Math.max(0, x + d))]; if (v > m) m = v; }
      tmp[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let d = -r; d <= r; d++) { const v = tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x]; if (v > m) m = v; }
      out[y * w + x] = m;
    }
    return out;
  }
  function sobel(g, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1], d = g[i - 1], f = g[i + 1], p = g[i + w - 1], q = g[i + w], r = g[i + w + 1];
      const sx = (c + 2 * f + r) - (a + 2 * d + p), sy = (p + 2 * q + r) - (a + 2 * b + c);
      gx[i] = sx; gy[i] = sy; mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
    return { gx, gy, mag };
  }
  function percentile(arr, p) {
    const step = Math.max(1, Math.floor(arr.length / 30000)), s = [];
    for (let i = 0; i < arr.length; i += step) s.push(arr[i]);
    s.sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] : 0;
  }
  // bilinear; außerhalb des Bildes NaN
  function sample(arr, w, h, x, y) {
    if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = arr[y0 * w + x0], b = arr[y0 * w + x1], c = arr[y1 * w + x0], d = arr[y1 * w + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  /* ---------- Geometrie ---------- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function polyArea(q) {
    let s = 0;
    for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  // Ecken sortieren: oben links, oben rechts, unten rechts, unten links
  function orderCorners(pts) {
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4, cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    const s = pts.map(p => ({ x: p.x, y: p.y })).sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let k = 0;
    for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
    return [0, 1, 2, 3].map(i => s[(k + i) % 4]);
  }
  function isGoodQuad(q, w, h, minAreaFrac) {
    for (const p of q) if (!isFinite(p.x) || !isFinite(p.y) || p.x < -0.1 * w || p.x > 1.1 * w || p.y < -0.1 * h || p.y > 1.1 * h) return false;
    if (polyArea(q) < minAreaFrac * w * h) return false;
    for (let i = 0; i < 4; i++) {
      const p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
      const e1x = c.x - p.x, e1y = c.y - p.y, e2x = n.x - c.x, e2y = n.y - c.y;
      if (e1x * e2y - e1y * e2x <= 0) return false;                       // nicht konvex
      const v1x = p.x - c.x, v1y = p.y - c.y;
      const cos = (v1x * e2x + v1y * e2y) / (Math.hypot(v1x, v1y) * Math.hypot(e2x, e2y) || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (ang < 35 || ang > 145) return false;
    }
    return true;
  }
  function lineInter(a, b) {
    const c1 = Math.cos(a.t), s1 = Math.sin(a.t), c2 = Math.cos(b.t), s2 = Math.sin(b.t);
    const det = c1 * s2 - s1 * c2;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (a.rho * s2 - s1 * b.rho) / det, y: (c1 * b.rho - a.rho * c2) / det };
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  const triArea = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  // größtes Viereck mit Ecken auf der konvexen Hülle
  function maxAreaQuad(hull) {
    let P = hull;
    if (P.length > 64) { const step = P.length / 64; P = Array.from({ length: 64 }, (_, i) => hull[Math.floor(i * step)]); }
    const n = P.length;
    if (n < 4) return null;
    let bestA = 0, best = null;
    for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
      let ba = -1, bj = -1, bb = -1, bl = -1;
      for (let j = i + 1; j < k; j++) { const a = triArea(P[i], P[j], P[k]); if (a > ba) { ba = a; bj = j; } }
      for (let l = k + 1; l < i + n; l++) { const a = triArea(P[k], P[l % n], P[i]); if (a > bb) { bb = a; bl = l % n; } }
      if (bj >= 0 && bl >= 0 && ba + bb > bestA) { bestA = ba + bb; best = [P[i], P[bj], P[k], P[bl]]; }
    }
    return best;
  }

  /* ---------- Kandidaten 1: gerade Kanten (Hough-Transformation) ---------- */
  function houghLines(G, thr) {
    const { w, h, gx, gy, mag } = G;
    const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1;
    const acc = new Float32Array(NT * NR);
    const cs = new Float32Array(NT), sn = new Float32Array(NT);
    for (let t = 0; t < NT; t++) { cs[t] = Math.cos(t * Math.PI / NT); sn[t] = Math.sin(t * Math.PI / NT); }
    const cap = thr * 4;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, m = mag[i];
      if (m < thr) continue;
      const ux = gx[i] / m, uy = gy[i] / m;
      const dx = Math.round(ux), dy = Math.round(uy);
      if (m < mag[i + dy * w + dx] || m < mag[i - dy * w - dx]) continue;     // dünne Kanten: nur das Maximum quer zur Kante
      const t0 = Math.round(Math.atan2(uy, ux) * NT / Math.PI);
      const wgt = Math.min(m, cap);
      for (let dt = -3; dt <= 3; dt++) {
        const t = ((t0 + dt) % NT + NT) % NT;
        acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + diag] += wgt;
      }
    }
    let maxV = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i] > maxV) maxV = acc[i];
    const minV = maxV * 0.06, peaks = [];
    for (let t = 0; t < NT; t++) for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v < minV) continue;
      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) {
        let tt = t + dt, flip = false;
        if (tt < 0) { tt += NT; flip = true; } else if (tt >= NT) { tt -= NT; flip = true; }
        for (let dr = -7; dr <= 7; dr++) {
          if (dt === 0 && dr === 0) continue;
          let rr = r + dr;
          if (flip) rr = 2 * diag - rr;
          if (rr < 0 || rr >= NR) continue;
          const u = acc[tt * NR + rr];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ t: t * Math.PI / NT, rho: r - diag, v });
    }
    peaks.sort((a, b) => b.v - a.v);
    return peaks.slice(0, 40);
  }

  /* ---------- Kandidaten 2: helle Fläche (Segmentierung) ---------- */
  function segmentQuad(G) {
    const { w, h, b: blur } = G, N = w * h;
    const hist = new Float64Array(256);
    for (let i = 0; i < N; i++) hist[Math.max(0, Math.min(255, blur[i] | 0))]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, T = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = N - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; T = t; }
    }
    let m = new Float32Array(N);
    for (let i = 0; i < N; i++) m[i] = blur[i] > T ? 1 : 0;
    // Text-Löcher schließen, Fransen entfernen
    m = maxFilter(m, w, h, 2);
    const inv = new Float32Array(N); for (let i = 0; i < N; i++) inv[i] = 1 - m[i];
    const er = maxFilter(inv, w, h, 2); for (let i = 0; i < N; i++) m[i] = 1 - er[i];
    // zusammenhängende Flächen
    const lab = new Int32Array(N).fill(-1), stack = new Int32Array(N);
    let bestScore = 0, bestLab = -1, nl = 0;
    const cx0 = w / 2, cy0 = h / 2, diag = Math.hypot(w, h);
    for (let s = 0; s < N; s++) {
      if (!m[s] || lab[s] >= 0) continue;
      let sp = 0, area = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
      stack[sp++] = s; lab[s] = nl;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0;
        area++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && m[i - 1] && lab[i - 1] < 0) { lab[i - 1] = nl; stack[sp++] = i - 1; }
        if (x < w - 1 && m[i + 1] && lab[i + 1] < 0) { lab[i + 1] = nl; stack[sp++] = i + 1; }
        if (y > 0 && m[i - w] && lab[i - w] < 0) { lab[i - w] = nl; stack[sp++] = i - w; }
        if (y < h - 1 && m[i + w] && lab[i + w] < 0) { lab[i + w] = nl; stack[sp++] = i + w; }
      }
      const touches = (minX === 0) + (maxX === w - 1) + (minY === 0) + (maxY === h - 1);
      const dc = Math.hypot(sx / area - cx0, sy / area - cy0) / diag;
      const score = area * (1 - 1.2 * dc) * (touches >= 3 ? 0.4 : 1);
      if (score > bestScore) { bestScore = score; bestLab = nl; }
      nl++;
    }
    if (bestLab < 0) return null;
    const pts = [];
    for (let y = 0; y < h; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (lab[y * w + x] === bestLab) { if (a < 0) a = x; b = x; }
      if (a >= 0) { pts.push({ x: a, y }); if (b !== a) pts.push({ x: b, y }); }
    }
    if (pts.length < 8) return null;
    return maxAreaQuad(convexHull(pts));
  }

  /* ---------- Bewertung eines Vierecks ---------- */
  // Kantenstärke an einer Stelle quer zur Seite: Betrag (mag), „ist überhaupt eine Kante da“ (con), Helligkeit innen–außen (dif)
  function edgeAt(G, px, py, nx, ny) {
    const { w, h, gx, gy, b: g } = G;
    let best = 0;
    for (let o = -2; o <= 2; o++) {
      const X = px + nx * o, Y = py + ny * o;
      const vx = sample(gx, w, h, X, Y);
      if (vx !== vx) continue;
      const v = Math.abs(vx * nx + sample(gy, w, h, X, Y) * ny);
      if (v > best) best = v;
    }
    const gi = sample(g, w, h, px + nx * 4, py + ny * 4), go = sample(g, w, h, px - nx * 4, py - ny * 4);
    // Helligkeit knapp neben der Kante (7 px) und weiter entfernt (24 px), jeweils auf beiden Seiten
    const ip = sample(g, w, h, px + nx * 7, py + ny * 7), op = sample(g, w, h, px - nx * 7, py - ny * 7);
    const ip2 = sample(g, w, h, px + nx * 24, py + ny * 24), op2 = sample(g, w, h, px - nx * 24, py - ny * 24);
    const pOk = ip === ip && ip2 === ip2, nOk = op === op && op2 === op2;
    const pb = sample(g, w, h, px + nx * 10, py + ny * 10), nb = sample(g, w, h, px - nx * 10, py - ny * 10);
    return { mag: Math.min(1, best / G.gref), con: best > G.tLow ? 1 : 0, dif: gi === gi && go === go ? gi - go : 0,
      ip: pOk ? ip2 - ip : 0, op: nOk ? op2 - op : 0, ipOk: pOk ? 1 : 0, opOk: nOk ? 1 : 0,
      pb: pb === pb ? pb : 0, nb: nb === nb ? nb : 0, pbOk: pb === pb ? 1 : 0, nbOk: nb === nb ? 1 : 0 };
  }
  // Vorberechnung entlang einer ganzen Linie (Präfixsummen) – damit lassen sich tausende Vierecke schnell bewerten
  function lineProfile(l, G) {
    const { w, h } = G, c = Math.cos(l.t), sn = Math.sin(l.t);
    const p0x = l.rho * c, p0y = l.rho * sn, dx = -sn, dy = c;
    let t0 = -Infinity, t1 = Infinity;
    const clip = (p, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; } return; }
      const a = (lo - p) / d, b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    };
    clip(p0x, dx, 0, w - 1); clip(p0y, dy, 0, h - 1);
    const ds = 1.5, n = t1 > t0 ? Math.floor((t1 - t0) / ds) + 1 : 0;
    const Pm = new Float32Array(n + 1), Pc = new Float32Array(n + 1), Pd = new Float32Array(n + 1);
    const Pp = new Float32Array(n + 1), Pn = new Float32Array(n + 1), Ppc = new Float32Array(n + 1), Pnc = new Float32Array(n + 1);
    const Qp = new Float32Array(n + 1), Qn = new Float32Array(n + 1), Qpc = new Float32Array(n + 1), Qnc = new Float32Array(n + 1);
    for (let k = 0; k < n; k++) {
      const t = t0 + k * ds, e = edgeAt(G, p0x + dx * t, p0y + dy * t, c, sn);
      Pm[k + 1] = Pm[k] + e.mag; Pc[k + 1] = Pc[k] + e.con; Pd[k + 1] = Pd[k] + e.dif;
      Pp[k + 1] = Pp[k] + e.ip; Pn[k + 1] = Pn[k] + e.op; Ppc[k + 1] = Ppc[k] + e.ipOk; Pnc[k + 1] = Pnc[k] + e.opOk;
      Qp[k + 1] = Qp[k] + e.pb; Qn[k + 1] = Qn[k] + e.nb; Qpc[k + 1] = Qpc[k] + e.pbOk; Qnc[k + 1] = Qnc[k] + e.nbOk;
    }
    return { p0x, p0y, dx, dy, nx: c, ny: sn, t0, ds, n, Pm, Pc, Pd, Pp, Pn, Ppc, Pnc, Qp, Qn, Qpc, Qnc };
  }
  // Kennzahlen einer Seite von a nach b; inside = Punkt im Inneren des Vierecks
  function sideStats(a, b, inside, line, G) {
    if (line && line.border) return { sup: 0.3, dif: 0 };
    const len = dist(a, b);
    if (len < 8) return null;
    if (line && line.prof) {
      const P = line.prof;
      let sa = (a.x - P.p0x) * P.dx + (a.y - P.p0y) * P.dy, sb = (b.x - P.p0x) * P.dx + (b.y - P.p0y) * P.dy;
      if (sa > sb) { const t = sa; sa = sb; sb = t; }
      const trim = (sb - sa) * 0.05; sa += trim; sb -= trim;
      const expected = Math.max(1, (sb - sa) / P.ds + 1);
      const k0 = Math.max(0, Math.ceil((sa - P.t0) / P.ds)), k1 = Math.min(P.n - 1, Math.floor((sb - P.t0) / P.ds));
      let m = 0, c = 0, d = 0, ins = NaN, outs = NaN, outB = NaN;
      const sign = ((inside.x - P.p0x) * P.nx + (inside.y - P.p0y) * P.ny) >= 0 ? 1 : -1;
      if (k1 >= k0) {
        m = P.Pm[k1 + 1] - P.Pm[k0]; c = P.Pc[k1 + 1] - P.Pc[k0]; d = P.Pd[k1 + 1] - P.Pd[k0];
        const sum = sign > 0 ? P.Pp[k1 + 1] - P.Pp[k0] : P.Pn[k1 + 1] - P.Pn[k0];
        const cnt = sign > 0 ? P.Ppc[k1 + 1] - P.Ppc[k0] : P.Pnc[k1 + 1] - P.Pnc[k0];
        if (cnt > 0) ins = sum / cnt;
        const osum = sign > 0 ? P.Pn[k1 + 1] - P.Pn[k0] : P.Pp[k1 + 1] - P.Pp[k0];
        const ocnt = sign > 0 ? P.Pnc[k1 + 1] - P.Pnc[k0] : P.Ppc[k1 + 1] - P.Ppc[k0];
        if (ocnt > 0) outs = osum / ocnt;
        const bsum = sign > 0 ? P.Qn[k1 + 1] - P.Qn[k0] : P.Qp[k1 + 1] - P.Qp[k0];
        const bcnt = sign > 0 ? P.Qnc[k1 + 1] - P.Qnc[k0] : P.Qpc[k1 + 1] - P.Qpc[k0];
        if (bcnt > 0) outB = bsum / bcnt;
      }
      return { sup: 0.5 * m / expected + 0.5 * c / expected, dif: k1 >= k0 ? sign * d / (k1 - k0 + 1) : 0, ins, outs, outB };
    }
    // ohne Linie (Kandidat aus der Flächenerkennung): direkt abtasten
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let nx = -uy, ny = ux;
    if ((inside.x - (a.x + b.x) / 2) * nx + (inside.y - (a.y + b.y) / 2) * ny < 0) { nx = -nx; ny = -ny; }
    const n = Math.max(12, Math.min(80, Math.round(len / 3)));
    let m = 0, c = 0, d = 0, dn = 0, is = 0, ic = 0, os = 0, oc = 0, bs = 0, bc = 0;
    for (let k = 0; k < n; k++) {
      const t = 0.05 + 0.9 * k / (n - 1), e = edgeAt(G, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, nx, ny);
      m += e.mag; c += e.con; if (e.dif) { d += e.dif; dn++; }
      is += e.ip; ic += e.ipOk; os += e.op; oc += e.opOk; bs += e.nb; bc += e.nbOk;
    }
    return { sup: 0.5 * m / n + 0.5 * c / n, dif: dn ? d / dn : 0, ins: ic ? is / ic : NaN, outs: oc ? os / oc : NaN, outB: bc ? bs / bc : NaN };
  }
  // lines[i] = Linie der Seite q[i] → q[i+1] (oder null)
  function scoreQuad(q, G, lines) {
    const inside = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    let tot = 0, minS = 1, dif = 0, dn = 0;
    for (let s = 0; s < 4; s++) {
      const st = sideStats(q[s], q[(s + 1) % 4], inside, lines ? lines[s] : null, G);
      if (!st) return -1;
      let sup = st.sup;
      if (st.dif < -20) sup *= 0.35;          // innen deutlich dunkler als außen: eher ein Balken im Dokument als die Blattkante
      if (st.ins === st.ins && st.ins > 25) sup *= 0.5;   // knapp innen deutlich dunkler als weiter innen: Kante liegt außerhalb des Blatts
      if (st.outs === st.outs && st.outs > 30) sup *= 0.6; // außen erst dunkel, dann wieder hell: Balken/Rahmen im Dokument, nicht die Blattkante
      tot += sup; if (sup < minS) minS = sup;
      if (!(lines && lines[s] && lines[s].border)) { dif += st.dif; dn++; }
    }
    const edge = 0.55 * (tot / 4) + 0.45 * minS;
    const A = Math.min(1, Math.abs(polyArea(q)) / (G.w * G.h));
    const C = dn ? Math.max(-1, Math.min(1, dif / dn / 50)) : 0;
    return edge + 0.15 * C + 0.3 * A;
  }

  /* ---------- Feinanpassung der Kanten in höherer Auflösung ---------- */
  function fitLine(pts) {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: mx, py: my, dx: Math.cos(a), dy: Math.sin(a) };
  }
  function interPD(L1, L2) {
    const det = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(det) < 1e-9) return null;
    const t = ((L2.px - L1.px) * L2.dy - (L2.py - L1.py) * L2.dx) / det;
    return { x: L1.px + t * L1.dx, y: L1.py + t * L1.dy };
  }
  function refine(canvas, q) {
    const M = grayData(canvas, REF_SIZE);
    const { w, h, k } = M;
    const S = sobel(boxBlur(M.g, w, h, 1), w, h);
    const Q = q.map(p => ({ x: p.x * k, y: p.y * k }));
    const diag = Math.hypot(w, h), R = Math.max(4, Math.round(diag * 0.012));
    const cx = (Q[0].x + Q[1].x + Q[2].x + Q[3].x) / 4, cy = (Q[0].y + Q[1].y + Q[2].y + Q[3].y) / 4;
    const lines = [];
    for (let s = 0; s < 4; s++) {
      const a = Q[s], b = Q[(s + 1) % 4], len = dist(a, b);
      if (len < 10) { lines.push(null); continue; }
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      let nx = -uy, ny = ux;
      if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny < 0) { nx = -nx; ny = -ny; }
      const pts = [];
      const NS = 48;
      for (let i = 0; i < NS; i++) {
        const t = 0.08 + 0.84 * i / (NS - 1);
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        let best = 0, bo = 0;
        for (let o = -R; o <= R; o++) {
          const X = px + nx * o, Y = py + ny * o;
          const vx = sample(S.gx, w, h, X, Y);
          if (vx !== vx) continue;
          const v = Math.abs(vx * nx + sample(S.gy, w, h, X, Y) * ny);
          if (v > best) { best = v; bo = o; }
        }
        if (best > 0) pts.push({ x: px + nx * bo, y: py + ny * bo, v: best });
      }
      const vmax = pts.reduce((m, p) => Math.max(m, p.v), 0);
      const good = pts.filter(p => p.v > 0.35 * vmax);
      if (good.length < 10) { lines.push(null); continue; }
      let L = fitLine(good);
      const res = good.map(p => Math.abs((p.x - L.px) * -L.dy + (p.y - L.py) * L.dx));
      const med = res.slice().sort((x, y) => x - y)[Math.floor(res.length / 2)];
      const keep = good.filter((p, i) => res[i] <= Math.max(1, 2.5 * med));
      if (keep.length >= 8) L = fitLine(keep);
      lines.push(L);
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const L1 = lines[(i + 3) % 4], L2 = lines[i];
      let p = Q[i];
      if (L1 && L2) { const c = interPD(L1, L2); if (c && dist(c, p) < diag * 0.03) p = c; }
      out.push({ x: p.x / k, y: p.y / k });
    }
    return out;
  }

  // Bild ist bereits ein Scan/Screenshot: alle vier Bildränder sind papierhell → nichts beschneiden
  function looksFlat(G) {
    const { w, h, b } = G, m = Math.max(2, Math.round(Math.min(w, h) * 0.025));
    const paper = percentile(b, 0.85);
    const lim = paper - 14, side = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bright = b[y * w + x] >= lim ? 1 : 0;
      if (y < m) { side[0] += bright; cnt[0]++; }
      if (y >= h - m) { side[1] += bright; cnt[1]++; }
      if (x < m) { side[2] += bright; cnt[2]++; }
      if (x >= w - m) { side[3] += bright; cnt[3]++; }
    }
    return paper > 140 && side.every((v, i) => v / cnt[i] > 0.9);
  }
  function fullCorners(canvas) {
    const W = canvas.width, H = canvas.height;
    return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  }

  /* ---------- Dokument im Foto finden ---------- */
  function detect(canvas, opts) {
    const G = grayData(canvas, DET_SIZE);
    const { w, h } = G;
    G.b = boxBlur(boxBlur(G.g, w, h, 1), w, h, 1);
    Object.assign(G, sobel(G.b, w, h));
    const thr = Math.max(10, percentile(G.mag, 0.8));
    G.gref = Math.max(40, percentile(G.mag, 0.985) * 0.5);
    G.tLow = Math.max(10, percentile(G.mag, 0.5) * 3);
    if (looksFlat(G)) return { found: true, flat: true, corners: fullCorners(canvas), score: 1 };
    let best = null;
    const consider = (q, lines, src) => {
      if (!q || q.some(p => !p)) return;
      if (!isGoodQuad(orderCorners(q), w, h, 0.1)) return;
      const s = scoreQuad(q, G, lines);
      if (!best || s > best.s) best = { q, s, src };
    };
    const peaks = houghLines(G, thr);
    const V = [], H = [];
    for (const l of peaks) (Math.abs(Math.cos(l.t)) > Math.SQRT1_2 ? V : H).push(l);
    V.splice(16); H.splice(16);
    for (const l of V.concat(H)) l.prof = lineProfile(l, G);
    V.push({ t: 0, rho: 0, border: true }, { t: 0, rho: w - 1, border: true });
    H.push({ t: Math.PI / 2, rho: 0, border: true }, { t: Math.PI / 2, rho: h - 1, border: true });
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++)
      for (let a = 0; a < H.length; a++) for (let c = a + 1; c < H.length; c++) {
        const q = [lineInter(V[i], H[a]), lineInter(V[i], H[c]), lineInter(V[j], H[c]), lineInter(V[j], H[a])];
        consider(q, [V[i], H[c], V[j], H[a]], 'lines');
      }
    consider(segmentQuad(G), null, 'segment');
    if (opts && opts.probe) opts.probeScores = opts.probe.map(q => scoreQuad(orderCorners(q.map(p => ({ x: p.x * G.k, y: p.y * G.k }))), G, null));
    if (opts) opts.best = best && { s: best.s, src: best.src, q: orderCorners(best.q).map(p => ({ x: Math.round(p.x / G.k), y: Math.round(p.y / G.k) })) };
    if (!best || best.s < MIN_SCORE) return { found: false, corners: fullCorners(canvas), score: best ? best.s : 0 };
    let q = orderCorners(best.q).map(p => ({ x: p.x / G.k, y: p.y / G.k }));
    try { q = refine(canvas, q); } catch (e) { /* grobe Ecken genügen */ }
    const W = canvas.width, Hh = canvas.height;
    q = q.map(p => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(Hh, p.y)) }));
    return { found: true, corners: orderCorners(q), score: best.s, src: best.src };
  }

  /* ---------- Perspektive entzerren ---------- */
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = from[i].x, y = from[i].y, X = to[i].x, Y = to[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      const piv = A[c][c];
      if (Math.abs(piv) < 1e-12) return null;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / piv;
        if (!f) continue;
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  // Echtes Seitenverhältnis (Breite/Höhe) aus der Perspektive zurückrechnen (Zhang & He, Whiteboard-Scanning):
  // Brennweite aus den Fluchtpunkten schätzen, Bildmitte als optische Achse. null, wenn nicht sicher bestimmbar.
  function trueAspect(q, imgW, imgH) {
    const u0 = imgW / 2, v0 = imgH / 2;
    const m = [q[0], q[1], q[3], q[2]].map(p => [p.x - u0, p.y - v0, 1]);   // m1 oben links, m2 oben rechts, m3 unten links, m4 unten rechts
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const c14 = cross(m[0], m[3]);
    const k2 = dot(c14, m[2]) / dot(cross(m[1], m[3]), m[2]);
    const k3 = dot(c14, m[1]) / dot(cross(m[2], m[3]), m[1]);
    if (!isFinite(k2) || !isFinite(k3)) return null;
    const n2 = m[1].map((v, i) => k2 * v - m[0][i]), n3 = m[2].map((v, i) => k3 * v - m[0][i]);
    const longSide = Math.max(imgW, imgH);
    // Brennweite aus den Fluchtpunkten; ist sie nicht sicher bestimmbar (fast parallele Kanten, zugeschnittenes Bild),
    // wird eine typische Handy-Brennweite angenommen (ca. 0,85 × lange Bildseite)
    let f2 = (0.85 * longSide) ** 2;
    const z2 = Math.abs(n2[2]) * longSide / (Math.hypot(n2[0], n2[1]) || 1), z3 = Math.abs(n3[2]) * longSide / (Math.hypot(n3[0], n3[1]) || 1);
    if (z2 > 0.05 && z3 > 0.05) {
      const est = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
      if (est > (0.4 * longSide) ** 2 && est < (4 * longSide) ** 2) f2 = est;
    }
    const ratio2 = (n2[0] * n2[0] / f2 + n2[1] * n2[1] / f2 + n2[2] * n2[2]) / (n3[0] * n3[0] / f2 + n3[1] * n3[1] / f2 + n3[2] * n3[2]);
    const r = Math.sqrt(ratio2);
    return isFinite(r) && r > 0.15 && r < 7 ? r : null;
  }
  // Ausgabegröße: Seitenverhältnis aus der Perspektive (sonst aus den Kantenlängen); nahe A4 wird auf A4 eingerastet
  function outputSize(q, imgW, imgH) {
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const ar = imgW && imgH ? trueAspect(q, imgW, imgH) : null;
    if (ar) { const long = Math.max(W, H); if (ar <= 1) { H = long; W = long * ar; } else { W = long; H = long / ar; } }
    const r = H / W;
    if (Math.abs(r - A4) / A4 < 0.08) H = W * A4;
    else if (Math.abs(1 / r - A4) / A4 < 0.08) W = H * A4;
    const long = Math.max(W, H);
    const k = Math.min(OUT_MAX / long, Math.max(1, OUT_MIN / long));
    return { W: Math.max(1, Math.round(W * k)), H: Math.max(1, Math.round(H * k)) };
  }
  // Ecken für eine Drehung um 90° × rot (im Uhrzeigersinn) umsortieren
  function rotateCorners(q, rot) {
    const r = ((rot % 4) + 4) % 4;
    return [0, 1, 2, 3].map(i => q[(i - r + 4) % 4]);
  }
  function warp(srcCanvas, quad, W, H) {
    const qLong = Math.max(dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0]));
    const s = Math.min(1, 1.3 * Math.max(W, H) / qLong);
    let sc = srcCanvas, q = quad;
    if (s < 0.9) {
      const t = scaled(srcCanvas, Math.round(Math.max(srcCanvas.width, srcCanvas.height) * s));
      sc = t.c; q = quad.map(p => ({ x: p.x * t.k, y: p.y * t.k }));
    }
    const sw = sc.width, sh = sc.height;
    const src = sc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const hm = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], q);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!hm) { ctx.drawImage(sc, 0, 0, W, H); return c; }
    const out = ctx.createImageData(W, H), o = out.data;
    const mxX = sw - 1.001, mxY = sh - 1.001;
    let oi = 0;
    for (let y = 0; y < H; y++) {
      const Y = y + 0.5;
      let nu = hm[0] * 0.5 + hm[1] * Y + hm[2], nv = hm[3] * 0.5 + hm[4] * Y + hm[5], dn = hm[6] * 0.5 + hm[7] * Y + 1;
      for (let x = 0; x < W; x++) {
        let u = nu / dn - 0.5, v = nv / dn - 0.5;
        if (u < 0) u = 0; else if (u > mxX) u = mxX;
        if (v < 0) v = 0; else if (v > mxY) v = mxY;
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const i0 = (y0 * sw + x0) * 4, i1 = i0 + sw * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        o[oi] = src[i0] * w00 + src[i0 + 4] * w10 + src[i1] * w01 + src[i1 + 4] * w11;
        o[oi + 1] = src[i0 + 1] * w00 + src[i0 + 5] * w10 + src[i1 + 1] * w01 + src[i1 + 5] * w11;
        o[oi + 2] = src[i0 + 2] * w00 + src[i0 + 6] * w10 + src[i1 + 2] * w01 + src[i1 + 6] * w11;
        o[oi + 3] = 255;
        oi += 4;
        nu += hm[0]; nv += hm[3]; dn += hm[6];
      }
    }
    ctx.putImageData(out, 0, 0);
    if (sc !== srcCanvas) { sc.width = sc.height = 0; }
    return c;
  }
  function rotateCanvas(c, rot) {
    const r = ((rot % 4) + 4) % 4;
    if (!r) return c;
    const o = document.createElement('canvas');
    o.width = r % 2 ? c.height : c.width; o.height = r % 2 ? c.width : c.height;
    const x = o.getContext('2d', { willReadFrequently: true });
    x.translate(o.width / 2, o.height / 2);
    x.rotate(r * Math.PI / 2);
    x.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  }
  function cloneCanvas(c) {
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    o.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0);
    return o;
  }

  /* ---------- Wie ein Scan aufbereiten ---------- */
  // filter: 'doc' (Farbe, weißes Papier), 'gray', 'bw', 'original'
  function enhance(canvas, filter) {
    if (filter === 'original') return canvas;
    const W = canvas.width, H = canvas.height, N = W * H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    const L = new Uint8ClampedArray(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) L[i] = (77 * d[j] + 150 * d[j + 1] + 29 * d[j + 2]) >> 8;

    // 1. Papierhelligkeit blockweise schätzen (helle Anteile je Block), Text und Linien fallen dabei heraus
    const B = Math.max(8, Math.round(Math.max(W, H) / 110));
    const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
    let bg = new Float32Array(bw * bh);
    const hist = new Uint32Array(64);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      const x1 = Math.min(W, (bx + 1) * B), y1 = Math.min(H, (by + 1) * B);
      let n = 0;
      for (let y = by * B; y < y1; y++) for (let x = bx * B, i = y * W + x; x < x1; x++, i++) { hist[L[i] >> 2]++; n++; }
      let acc = 0, k = 0;
      const target = n * 0.9;
      for (; k < 63; k++) { acc += hist[k]; if (acc >= target) break; }
      bg[by * bw + bx] = k * 4 + 2;
    }
    bg = maxFilter(bg, bw, bh, 2);
    const paper = percentile(bg, 0.9);
    const floor = Math.max(40, paper * 0.55);       // große dunkle Flächen (Fotos, schwarze Balken) bleiben dunkel
    for (let i = 0; i < bg.length; i++) if (bg[i] < floor) bg[i] = floor;
    bg = boxBlur(boxBlur(bg, bw, bh, 1), bw, bh, 1);

    // 2. Beleuchtung ausgleichen: jedes Pixel durch die örtliche Papierhelligkeit teilen
    const F = new Float32Array(N);       // Faktor je Pixel
    const nl = new Uint8ClampedArray(N); // ausgeglichene Helligkeit
    for (let y = 0; y < H; y++) {
      const gy = Math.max(0, Math.min(bh - 1.001, (y + 0.5) / B - 0.5));
      const y0 = gy | 0, fy = gy - y0, y1 = Math.min(bh - 1, y0 + 1);
      for (let x = 0; x < W; x++) {
        const gx = Math.max(0, Math.min(bw - 1.001, (x + 0.5) / B - 0.5));
        const x0 = gx | 0, fx = gx - x0, x1 = Math.min(bw - 1, x0 + 1);
        const v = (bg[y0 * bw + x0] * (1 - fx) + bg[y0 * bw + x1] * fx) * (1 - fy) + (bg[y1 * bw + x0] * (1 - fx) + bg[y1 * bw + x1] * fx) * fy;
        const i = y * W + x, f = 255 / Math.max(1, v);
        F[i] = f; nl[i] = L[i] * f;
      }
    }

    // 3. Weißabgleich: Papier wird neutral weiß
    let pr = 0, pg = 0, pb = 0, pn = 0;
    for (let i = 0, j = 0; i < N; i += 7, j = i * 4) if (nl[i] > 225) { pr += d[j] * F[i]; pg += d[j + 1] * F[i]; pb += d[j + 2] * F[i]; pn++; }
    let gr = 1, gg = 1, gb = 1;
    if (pn > 50) {
      const m = (pr + pg + pb) / (3 * pn);
      gr = Math.min(1.4, Math.max(0.7, m / (pr / pn))); gg = Math.min(1.4, Math.max(0.7, m / (pg / pn))); gb = Math.min(1.4, Math.max(0.7, m / (pb / pn)));
    }

    // 4. Tonwerte: Papier → reines Weiß, Schrift → kräftig dunkel
    const h2 = new Uint32Array(256);
    for (let i = 0; i < N; i += 3) h2[nl[i]]++;
    let tot = 0; for (let i = 0; i < 256; i++) tot += h2[i];
    let acc = 0, p1 = 0;
    for (; p1 < 255; p1++) { acc += h2[p1]; if (acc >= tot * 0.01) break; }
    const bp = Math.min(110, p1 + 8), wp = 232, span = wp - bp;

    if (filter === 'bw') {
      // Otsu-Schwelle auf der ausgeglichenen Helligkeit, mit weicher Kante gegen Treppenstufen
      let sum = 0; for (let i = 0; i < 256; i++) sum += i * h2[i];
      let wB = 0, sB = 0, best = 0, T = 170;
      for (let t = 0; t < 256; t++) {
        wB += h2[t]; if (!wB) continue;
        const wF = tot - wB; if (!wF) break;
        sB += t * h2[t];
        const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
        if (v > best) { best = v; T = t; }
      }
      T = Math.max(120, Math.min(215, T + 10));
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        // kräftige Farben (Textmarker) zählen als hell, damit sie nicht zu schwarzen Balken werden
        const mx = Math.min(255, Math.max(d[j], d[j + 1], d[j + 2]) * F[i]);
        const val = 0.5 * nl[i] + 0.5 * mx;
        const v = Math.max(0, Math.min(255, (val - (T - 12)) * (255 / 24)));
        d[j] = d[j + 1] = d[j + 2] = v;
      }
    } else {
      const Y = new Float32Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const f = F[i];
        if (filter === 'gray') {
          let v = (nl[i] - bp) / span; v = v < 0 ? 0 : v > 1 ? 1 : v;
          v = Math.pow(v, 1.15) * 255;
          d[j] = d[j + 1] = d[j + 2] = v; Y[i] = v;
        } else {
          let r = (d[j] * f * gr - bp) / span, g = (d[j + 1] * f * gg - bp) / span, b = (d[j + 2] * f * gb - bp) / span;
          r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          const sat = 1.25;                         // Farben (Marker, Stempel, Logos) leicht kräftiger
          r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
          d[j] = r * 255; d[j + 1] = g * 255; d[j + 2] = b * 255;
          Y[i] = l * 255;
        }
      }
      // 5. leichtes Nachschärfen (Unscharf-Maskieren auf der Helligkeit)
      const Yb = boxBlur(Y, W, H, 1);
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const delta = 0.55 * (Y[i] - Yb[i]);
        if (delta > -1 && delta < 1) continue;
        d[j] += delta; d[j + 1] += delta; d[j + 2] += delta;
      }
    }
    ctx.putImageData(im, 0, 0);
    return canvas;
  }

  /* ---------- Gesamter Ablauf ---------- */
  // liefert das entzerrte (noch nicht aufbereitete) Bild
  function rectify(srcCanvas, corners, rot) {
    const q = orderCorners(corners);
    const { W, H } = outputSize(q, srcCanvas.width, srcCanvas.height);
    return rotateCanvas(warp(srcCanvas, q, W, H), rot || 0);
  }

  global.DocScanner = {
    loadImage, detect, rectify, enhance, cloneCanvas, rotateCanvas, orderCorners, outputSize, trueAspect, rotateCorners, fullCorners,
    FILTERS: [
      { id: 'doc', name: 'Dokument' },
      { id: 'gray', name: 'Graustufen' },
      { id: 'bw', name: 'Schwarzweiß' },
      { id: 'original', name: 'Original' }
    ]
  };
})(window);
