/* Shared text finder for Screenshot Privacy Cleaner.
   Finds emails, phone numbers, card/account numbers and links in OCR words, even when the OCR is imperfect,
   and finds the tilt of text in photos so it can be read straight. No network, no dependencies. */
(function (g) {
'use strict';
const TF = {};
const PROV = 'gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|proton|protonmail|aol|zoho|msn|rocketmail';
const TLDS = new Set('com net org edu gov co ng uk io me info biz us ke gh za in de fr ca au tv app dev xyz online site tech ai'.split(' '));
const RE_A = /[A-Za-z0-9._%+\-]+\s?@\s?[A-Za-z0-9\-]+(?:\s?\.\s?[A-Za-z0-9\-]{2,}){1,4}/g;
const RE_B = new RegExp('[A-Za-z0-9._%+\\-]*\\s?[@©®]\\s?(?:' + PROV + ')\\s?[. ,]\\s?(?:com|net|org|ng|co)\\b', 'gi');
const RE_C = new RegExp('[A-Za-z0-9._%+\\-]{3,}(?:' + PROV + ')\\s?[.,]\\s?(?:com|net|org|ng|co)\\b', 'gi');
// shortened by the app with "..." (mosesprecious907@gmail...) or cut off before the ending
const RE_D = new RegExp('[A-Za-z0-9._%+\\-]{3,}\\s?@\\s?(?:(?:' + PROV + ')\\b(?:\\s?[.,…]{1,3})?|[A-Za-z0-9\\-]{2,}\\s?(?:\\.{2,}|…))', 'gi');
const RE_URL = /(?:https?:\/\/|www\.)\S+/gi;
const RE_NUM = /[+(]?\d[\d\s().\-*]{6,}\d/g;

// OCR often reads 0 as O and 1 as l or I inside numbers. Fix those, keeping the text the same length.
function fixDigits(t) {
  const a = Array.from(t), isD = c => c >= '0' && c <= '9';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      let m = null;
      if ('OoQD'.indexOf(c) >= 0) m = '0';
      else if ('lI|i'.indexOf(c) >= 0) m = '1';
      else if (c === 'S') m = '5';
      else if (c === 'B') m = '8';
      if (!m) continue;
      let p = i - 1, q = i + 1;
      const okPrev = p >= 0 && (isD(a[p]) || ((a[p] === ' ' || a[p] === '-') && p > 0 && isD(a[p - 1])));
      const okNext = q < a.length && (isD(a[q]) || ((a[q] === ' ' || a[q] === '-') && q + 1 < a.length && isD(a[q + 1])));
      // a letter is only treated as a digit when digits are on both sides, or on one side and it ends the token
      const endsTok = q >= a.length || a[q] === ' ';
      const startsTok = p < 0 || a[p] === ' ';
      if ((okPrev && okNext) || (okPrev && endsTok) || (okNext && startsTok)) a[i] = m;
    }
  }
  return a.join('');
}

function trimEmail(s) {
  // drop trailing words glued on after the real domain ending (".com. Thanks")
  const at = s.indexOf('@');
  if (at < 0) return s;
  const dom = s.slice(at + 1).replace(/\s/g, '');
  const parts = dom.split('.');
  if (parts.length <= 2) return s;
  let keep = parts.length;
  while (keep > 2 && !TLDS.has(parts[keep - 1].toLowerCase())) keep--;
  if (keep === parts.length) return s;
  // find where the kept part ends inside s
  const drop = parts.slice(keep).join('.').length + 1;
  let n = 0, i = s.length;
  while (i > 0 && n < drop) { if (!/\s/.test(s[i - 1])) n++; i--; }
  return s.slice(0, i);
}

const FILL = /^(address|number|no|no\.|num|#|details|id)$/i;
const strip = w => w.replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '');

/* words: [{text,x0,y0,x1,y1,conf}] in reading order for ONE line.
   cats: ['email','phone','card','url'] (the ones switched on).
   Returns [{cat, i, j}] word index ranges (inclusive) that should be hidden. */
/* Flatten a canvas to plain grey. The text reader finds digits on coloured cards much more reliably this way. */
TF.gray = function (c) {
  const x = c.getContext('2d', { willReadFrequently: true }), d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const v = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
  x.putImageData(d, 0, 0); return c;
};

TF.matches = function (words, cats) {
  const want = k => cats.indexOf(k) >= 0, out = [];
  if (!words.length) return out;
  let t = '';
  const map = [];
  words.forEach(w => { map.push([t.length, t.length + w.text.length]); t += w.text + ' '; });
  const range = (a, b) => {
    let i = -1, j = -1;
    for (let k = 0; k < map.length; k++) if (map[k][0] < b && map[k][1] > a) { if (i < 0) i = k; j = k; }
    return i < 0 ? null : [i, j];
  };
  const push = (cat, a, b) => { const r = range(a, b); if (r) out.push({ cat, i: r[0], j: r[1] }); };

  const emailR = [];
  if (want('email')) {
    for (const re of [RE_A, RE_B, RE_C, RE_D]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        const s = re === RE_A ? trimEmail(m[0]) : m[0];
        if (s.length < 5) continue;
        emailR.push([m.index, m.index + s.length]);
        push('email', m.index, m.index + s.length);
      }
    }
    // Label rule: "Email: <anything>" hides the value even when the OCR garbles it
    for (let k = 0; k < words.length; k++) {
      const w = strip(words[k].text);
      if (!/^(e-?mail|mail)$/i.test(w)) continue;
      let v = k + 1;
      while (v < words.length && FILL.test(strip(words[v].text))) v++;
      const val = words.slice(v).map(x => x.text).join('');
      if (v < words.length && /[@\u00a9\u00ae]|\.[a-z]{2,}|gmail|yahoo|outlook|hotmail|icloud/i.test(val) && val.replace(/[^A-Za-z0-9@]/g, '').length >= 4) out.push({ cat: 'email', i: v, j: words.length - 1, label: true });
    }
  }
  const inEmail = (a, b) => emailR.some(r => a < r[1] && b > r[0]);
  const t2 = fixDigits(t);
  if (want('phone') || want('card') || want('id')) {
    RE_NUM.lastIndex = 0;
    let m;
    while ((m = RE_NUM.exec(t2))) {
      const s = m[0].replace(/\s+$/, ''), a = m.index, b = a + s.length;
      if (inEmail(a, b)) continue;
      const digits = s.replace(/\D/g, ''), stars = (s.match(/\*/g) || []).length, total = digits.length + stars;
      let cat = null;
      const nigerian = /^(?:234[789]\d{9}|0[789]\d{9})$/.test(digits);
      const grouped4 = /^\d{4}[\s\-]+\d{4}[\s\-]+\d{4}([\s\-]+\d{1,4})?$/.test(s);
      // NIN and BVN are 11 digits. A Nigerian mobile number is also 11 digits, but starts 07/08/09.
      if (!stars && !nigerian && s.charAt(0) !== '+' && /^\d{3,4}\s\d{3}\s\d{4}$/.test(s) && (digits.length === 10 || digits.length === 11)) cat = want('id') ? 'id' : 'phone';
      else if (!stars && digits.length === 11 && !nigerian && s.charAt(0) !== '+' && !/^(\d)\1+$/.test(digits)) cat = want('id') ? 'id' : 'phone';
      else if (stars > 0) cat = total >= 10 ? 'card' : null;
      else if (nigerian || s.charAt(0) === '+') cat = digits.length >= 9 && digits.length <= 15 ? 'phone' : null;
      else if (grouped4 || (digits.length >= 13 && digits.length <= 19)) cat = 'card';
      else if (digits.length >= 9 && digits.length <= 15) cat = 'phone';
      if (cat && want(cat)) push(cat, a, b);
    }
    // Label rule: "Phone: ...", "Account: ..." hide the value even when the OCR garbles a few digits
    for (let k = 0; k < words.length; k++) {
      const w = strip(words[k].text);
      let cat = null;
      if (/^(phone|tel|telephone|mobile|mob|whatsapp|cell|gsm)$/i.test(w)) cat = 'phone';
      else if (/^(card|account|acct|a\/c|iban|pan|nuban)$/i.test(w)) cat = 'card';
      else if (/^(nin|vnin|bvn|nimc|nin-slip)$/i.test(w)) cat = 'id';
      if (!cat || !want(cat)) continue;
      let v = k + 1;
      while (v < words.length && FILL.test(strip(words[v].text))) v++;
      const val = fixDigits(words.slice(v).map(x => x.text).join(' '));
      const n = (val.match(/[\d*]/g) || []).length;
      if (v < words.length && n >= 6) out.push({ cat, i: v, j: words.length - 1, label: true });
    }
  }
  if (want('url')) {
    RE_URL.lastIndex = 0;
    let m;
    while ((m = RE_URL.exec(t))) push('url', m.index, m.index + m[0].length);
  }
  return out;
};

/* Group loose OCR words into reading lines. Works for tilted lines and for "sparse" OCR output. */
TF.rows = function (ws) {
  const a = ws.filter(w => w.text && w.text.trim()).slice().sort((p, q) => p.x0 - q.x0);
  const chains = [];
  for (const w of a) {
    const cy = (w.y0 + w.y1) / 2, h = Math.max(4, w.y1 - w.y0);
    let best = null, bd = 1e9;
    for (const c of chains) {
      const l = c[c.length - 1], lh = Math.max(4, l.y1 - l.y0), lcy = (l.y0 + l.y1) / 2;
      const gap = w.x0 - l.x1, dy = Math.abs(cy - lcy);
      if (gap > -0.5 * h && gap < 2.6 * Math.max(h, lh) && dy < 0.6 * Math.max(h, lh) && dy < bd) { best = c; bd = dy; }
    }
    if (best) best.push(w); else chains.push([w]);
  }
  return chains;
};

/* Find how much the text is tilted. Returns angles (degrees, clockwise) to rotate the picture by so text is level.
   Only strong, separate tilts are returned (0 is always read anyway). */
TF.skew = function (src) {
  const W0 = src.width, H0 = src.height, k = 700 / Math.max(W0, H0), w = Math.max(16, Math.round(W0 * k)), h = Math.max(16, Math.round(H0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { const v = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]; gray[i] = v; sum += v; }
  const dark = sum / (w * h) < 110;
  // local-mean threshold through an integral image
  const I = new Float64Array((w + 1) * (h + 1));
  for (let yy = 0; yy < h; yy++) { let row = 0; for (let xx = 0; xx < w; xx++) { row += gray[yy * w + xx]; I[(yy + 1) * (w + 1) + xx + 1] = I[yy * (w + 1) + xx + 1] + row; } }
  const R = 8, xs = [], ys = [];
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const x0 = Math.max(0, xx - R), x1 = Math.min(w, xx + R + 1), y0 = Math.max(0, yy - R), y1 = Math.min(h, yy + R + 1);
    const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const v = gray[yy * w + xx];
    if (dark ? v > m * 1.25 && v > 60 : v < m * 0.8) { xs.push(xx - w / 2); ys.push(yy - h / 2); }
  }
  if (xs.length < 200 || xs.length > w * h * .5) return [];
  const bins = Math.ceil(Math.hypot(w, h)) + 4, off = bins / 2, ang = [], sc = [];
  for (let a = -30; a <= 30; a += 2) {
    const r = a * Math.PI / 180, s = Math.sin(r), co = Math.cos(r), hist = new Float64Array(bins);
    for (let i = 0; i < xs.length; i++) hist[Math.round(xs[i] * s + ys[i] * co + off)]++;
    let e = 0; for (let i = 1; i < bins; i++) { const df = hist[i] - hist[i - 1]; e += df * df; }
    ang.push(a); sc.push(e);
  }
  const mx = Math.max.apply(null, sc), res = [];
  for (let i = 1; i < sc.length - 1; i++) {
    if (sc[i] >= sc[i - 1] && sc[i] >= sc[i + 1] && sc[i] >= .16 * mx && Math.abs(ang[i]) >= 4) res.push([ang[i], sc[i]]);
  }
  // the text is tilted by -a, so level it by rotating +a ... (our projection uses clockwise-positive rotation)
  return res.sort((p, q) => q[1] - p[1]).slice(0, 2).map(p => p[0]);
};

/* Rotate (and scale) a picture. Returns {c, toOrig(x,y)->[x,y]} to map points back to the original. */
TF.rotate = function (src, deg, s, invert) {
  const W = src.width, H = src.height, r = deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  const nw = Math.ceil((Math.abs(W * co) + Math.abs(H * si)) * s), nh = Math.ceil((Math.abs(W * si) + Math.abs(H * co)) * s);
  const c = document.createElement('canvas'); c.width = nw; c.height = nh;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, nw, nh);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.translate(nw / 2, nh / 2); x.rotate(r); x.scale(s, s); x.drawImage(src, -W / 2, -H / 2);
  if (invert) {
    const q = x.getImageData(0, 0, nw, nh), p = q.data;
    for (let i = 0; i < p.length; i += 4) { p[i] = 255 - p[i]; p[i + 1] = 255 - p[i + 1]; p[i + 2] = 255 - p[i + 2]; }
    x.setTransform(1, 0, 0, 1, 0, 0); x.putImageData(q, 0, 0);
  }
  return {
    c: c,
    toOrig: (px, py) => {
      const qx = (px - nw / 2) / s, qy = (py - nh / 2) / s;
      return [qx * co + qy * si + W / 2, -qx * si + qy * co + H / 2];
    }
  };
};

TF.isDark = function (src) {
  const t = document.createElement('canvas'); t.width = t.height = 16;
  const tx = t.getContext('2d'); tx.drawImage(src, 0, 0, 16, 16);
  const d = tx.getImageData(0, 0, 16, 16).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / 768 < 110;
};

const polyArea = q => { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; };
const inPoly = (x, y, q) => {
  let c = false;
  for (let i = 0, j = 3; i < 4; j = i++) if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c;
  return c;
};
// share of quad a that lies inside quad b
TF.overlap = function (a, b) {
  let n = 0, tot = 0;
  for (let u = 0; u < 12; u++) for (let v = 0; v < 3; v++) {
    const fu = (u + .5) / 12, fv = (v + .5) / 3;
    const top = [a[0][0] + (a[1][0] - a[0][0]) * fu, a[0][1] + (a[1][1] - a[0][1]) * fu];
    const bot = [a[3][0] + (a[2][0] - a[3][0]) * fu, a[3][1] + (a[2][1] - a[3][1]) * fu];
    tot++; if (inPoly(top[0] + (bot[0] - top[0]) * fv, top[1] + (bot[1] - top[1]) * fv, b)) n++;
  }
  return n / tot;
};
TF.bounds = q => { const xs = q.map(p => p[0]), ys = q.map(p => p[1]), x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys); return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 }; };
TF.area = polyArea;

/* Scan a picture. ocr(canvas, psm) must return a Promise of [{text,x0,y0,x1,y1,conf}].
   Returns [{cat, q:[[x,y]x4], text}] in picture coordinates. */

/* QR codes and barcodes. Uses the browser's own detector when it has one, and a small library otherwise.
   Returns [{x,y,w,h}] in the picture's own pixels. */
let jsqrP = null;
function loadJsQR() {
  if (g.jsQR) return Promise.resolve(g.jsQR);
  if (!jsqrP) jsqrP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => res(g.jsQR || null); s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return jsqrP;
}
TF.qr = async function (src, opts) {
  opts = opts || {};
  const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
  const k = Math.min(1, (opts.max || 2000) / Math.max(W, H)), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
  const out = [];
  const add = (bx, by, bw, bh) => {
    const p = Math.max(bw, bh) * 0.06;
    const r = { x: (bx - p) / k, y: (by - p) / k, w: (bw + 2 * p) / k, h: (bh + 2 * p) / k };
    const same = o => { const iw = Math.min(o.x + o.w, r.x + r.w) - Math.max(o.x, r.x), ih = Math.min(o.y + o.h, r.y + r.h) - Math.max(o.y, r.y); return iw > 0 && ih > 0 && iw * ih > 0.4 * Math.min(o.w * o.h, r.w * r.h); };
    if (!out.some(same)) out.push(r);
  };
  if (typeof BarcodeDetector !== 'undefined') {
    try {
      const bd = new BarcodeDetector();
      for (const b of await bd.detect(c)) { const q = b.boundingBox; add(q.x, q.y, q.width, q.height); }
    } catch (e) { /* not supported for this format list: fall through to the library */ }
  }
  const J = await loadJsQR();
  if (J) {
    // find one code at a time, blank it out, look again
    for (let n = 0; n < 8; n++) {
      const d = x.getImageData(0, 0, w, h);
      const r = await J(d.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!r) break;
      const L = r.location, xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x],
        ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      add(x0, y0, x1 - x0, y1 - y0);
      x.fillStyle = '#808080'; x.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
    }
  }
  return out;
};

TF.scan = async function (src, cats, ocr, opts) {
  opts = opts || {};
  const prog = opts.progress || function () {};
  const W = src.width, H = src.height, long = Math.max(W, H);
  const s = Math.max(.6, Math.min(2, 2200 / long));
  const dark = TF.isDark(src);
  let angles = [0];
  try { const sk = TF.skew(src); sk.forEach(a => angles.push(a)); } catch (e) {}
  if (opts.sweep) [-24, -16, -8, 8, 16, 24].forEach(a => { if (angles.every(b => Math.abs(b - a) > 3)) angles.push(a); });
  const passes = [];
  angles.forEach((a, i) => { passes.push([a, i === 0 ? 3 : 11]); if (i === 0) passes.push([a, 11]); });
  const found = [];
  for (let pi = 0; pi < passes.length; pi++) {
    const [a, psm] = passes[pi];
    prog(pi, passes.length, a);
    const rot = TF.rotate(src, a, s, dark);
    let words = [];
    if (!g.__noGray) TF.gray(rot.c);
    try { words = await ocr(rot.c, psm); } catch (e) { if (pi === 0) throw e; }
    for (const row of TF.rows(words)) {
      for (const m of TF.matches(row, cats)) {
        const ws = row.slice(m.i, m.j + 1), pad = Math.max(3, (ws[0].y1 - ws[0].y0) * .18);
        const x0 = Math.min.apply(null, ws.map(w => w.x0)) - pad, x1 = Math.max.apply(null, ws.map(w => w.x1)) + pad;
        const y0 = Math.min.apply(null, ws.map(w => w.y0)) - pad, y1 = Math.max.apply(null, ws.map(w => w.y1)) + pad;
        const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => rot.toOrig(p[0], p[1]));
        found.push({ cat: m.cat, q: q, text: ws.map(w => w.text).join(' '), a: a, n: ws.length });
      }
    }
  }
  // keep one box per spot: drop a box mostly covered by a bigger or equal one of the same kind
  found.sort((p, q) => (q.text.length - p.text.length) || (polyArea(p.q) - polyArea(q.q)));
  const keep = [];
  for (const f of found) {
    if (keep.some(k => k.cat === f.cat && TF.overlap(f.q, k.q) > .6)) continue;
    keep.push(f);
  }
  return keep;
};
g.TF = TF;
})(typeof window !== 'undefined' ? window : globalThis);
