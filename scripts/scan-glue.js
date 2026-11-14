// Documentscan in de renderer-WebView: randdetectie, perspectief rechtzetten, schaduw weg, "magic" contrast.
// Wordt door build-renderer.js na renderer-glue.js ingevoegd en registreert extra operaties.
// De rekenkundige kern werkt op pixeldata (RGBA) zodat ze in Node getest kan worden (tests/scanMath.test.ts).
(function () {
  function loadImg(b64) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('afbeelding laden mislukt')); };
      im.src = 'data:image/jpeg;base64,' + b64;
    });
  }
  function toCanvas(im, maxSide) {
    var s = Math.min(1, maxSide / Math.max(im.width, im.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * s));
    c.height = Math.max(1, Math.round(im.height * s));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  var FALLBACK = [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }, { x: 0.04, y: 0.96 }];
  function isFallback(c) {
    for (var i = 0; i < 4; i++) if (Math.abs(c[i].x - FALLBACK[i].x) > 0.002 || Math.abs(c[i].y - FALLBACK[i].y) > 0.002) return false;
    return true;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function lumAt(d, i) { return d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; }

  // ---------------------------------------------------------------- randdetectie
  function otsu(vals, n) {
    var hist = new Array(256).fill(0), i, sum = 0;
    for (i = 0; i < n; i++) hist[Math.max(0, Math.min(255, vals[i] | 0))]++;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = -1, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }
  // Grootste samenhangende vlek van een masker (4-buren). Geeft {mask, count}.
  function largestComponent(mask, w, h) {
    var n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), best = 0, bestId = 0, id = 0, i;
    for (i = 0; i < n; i++) {
      if (!mask[i] || lab[i]) continue;
      id++; var cnt = 0, sp = 0; stack[sp++] = i; lab[i] = id;
      while (sp) {
        var p = stack[--sp]; cnt++;
        var x = p % w, y = (p / w) | 0, q;
        if (x > 0 && mask[q = p - 1] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
        if (x < w - 1 && mask[q = p + 1] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
        if (y > 0 && mask[q = p - w] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
        if (y < h - 1 && mask[q = p + w] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
      }
      if (cnt > best) { best = cnt; bestId = id; }
    }
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) if (lab[i] === bestId) out[i] = 1;
    return { mask: out, count: best };
  }
  // Dilatie (grow=1) of erosie (grow=0) met een vierkant van straal r (scheidbaar).
  function morph(mask, w, h, r, grow) {
    var n = w * h, tmp = new Uint8Array(n), out = new Uint8Array(n), x, y, k, hit;
    var on = grow ? 1 : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      hit = 0; for (k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < w && mask[y * w + xx] === on) { hit = 1; break; } }
      tmp[y * w + x] = hit ? on : 1 - on;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      hit = 0; for (k = -r; k <= r; k++) { var yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x] === on) { hit = 1; break; } }
      out[y * w + x] = hit ? on : 1 - on;
    }
    return out;
  }
  // Gaten (tekst, schaduwlijnen) in de vlek vullen: alles wat niet vanaf de rand bereikbaar is, hoort erbij.
  function fillHoles(mask, w, h) {
    var n = w * h, outside = new Uint8Array(n), stack = new Int32Array(n), sp = 0, i, x, y;
    function push(p) { if (!mask[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; } }
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      var p = stack[--sp]; x = p % w; y = (p / w) | 0;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
    }
    var out = new Uint8Array(n), cnt = 0;
    for (i = 0; i < n; i++) if (!outside[i]) { out[i] = 1; cnt++; }
    return { mask: out, count: cnt };
  }
  function convexHull(pts) {
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function polyArea(p) { var a = 0; for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2; }
  // Een convexe veelhoek met veel punten tot hooguit max punten terugbrengen (kleinste driehoek eerst weg).
  function simplifyHull(h, max) {
    h = h.slice();
    while (h.length > max) {
      var bi = 0, ba = 1e18;
      for (var i = 0; i < h.length; i++) {
        var a = h[(i + h.length - 1) % h.length], b = h[i], c = h[(i + 1) % h.length];
        var ar = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
        if (ar < ba) { ba = ar; bi = i; }
      }
      h.splice(bi, 1);
    }
    return h;
  }
  // De vierhoek met de grootste oppervlakte binnen een convexe veelhoek (alle 4 uit m punten).
  function bestQuad(h) {
    var m = h.length, best = -1, q = null, i, j, k, l;
    function tri(a, b, c) { return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2; }
    for (i = 0; i < m - 3; i++) for (j = i + 1; j < m - 2; j++) for (k = j + 1; k < m - 1; k++) {
      var t1 = tri(h[i], h[j], h[k]);
      for (l = k + 1; l < m; l++) { var ar = t1 + tri(h[i], h[k], h[l]); if (ar > best) { best = ar; q = [h[i], h[j], h[k], h[l]]; } }
    }
    return q;
  }
  // Hoeken in volgorde linksboven, rechtsboven, rechtsonder, linksonder; bovenrand = rand die het dichtst bij horizontaal ligt.
  function orderCorners(q) {
    var cx = 0, cy = 0, i; for (i = 0; i < 4; i++) { cx += q[i].x / 4; cy += q[i].y / 4; }
    var s = q.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    for (i = 0; i < 4; i++) {
      var p = s[i], nx = s[(i + 1) % 4], ang = Math.atan2(nx.y - p.y, nx.x - p.x) * 180 / Math.PI;
      if (ang > -45 && ang <= 45) return [s[i], s[(i + 1) % 4], s[(i + 2) % 4], s[(i + 3) % 4]];
    }
    return s;
  }
  function anglesOk(q) {
    for (var i = 0; i < 4; i++) {
      var a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
      var cos = (v1x * v2x + v1y * v2y) / Math.max(1e-6, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)), deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (deg < 50 || deg > 130) return false;
    }
    return true;
  }
  // Probeert uit één masker een bladvierhoek te halen en geeft die een score.
  function candidateFromMask(mask, w, h) {
    var closed = morph(morph(mask, w, h, 2, 1), w, h, 2, 0);
    var lc = largestComponent(closed, w, h);
    if (lc.count < w * h * 0.08) return null;
    var filled = fillHoles(lc.mask, w, h), pts = [], x, y;
    if (filled.count > w * h * 0.985) return { quad: [{ x: 2, y: 2 }, { x: w - 3, y: 2 }, { x: w - 3, y: h - 3 }, { x: 2, y: h - 3 }], score: 0.45 }; // het blad vult het hele beeld
    var m = filled.mask;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[y * w + x - 1] || !m[y * w + x + 1] || !m[(y - 1) * w + x] || !m[(y + 1) * w + x]) pts.push({ x: x, y: y });
    }
    if (pts.length < 8) return null;
    var hull = convexHull(pts);
    if (hull.length < 4) return null;
    var q = bestQuad(simplifyHull(hull, 64));
    if (!q) return null;
    var qa = polyArea(orderCorners(q)), frac = qa / (w * h);
    if (frac < 0.1 || frac > 0.97) return null;
    var fill = Math.min(1, filled.count / Math.max(1, qa)), pen = anglesOk(orderCorners(q)) ? 1 : 0.4;
    var onBorder = 0; q.forEach(function (p) { if (p.x <= 1 || p.y <= 1 || p.x >= w - 2 || p.y >= h - 2) onBorder++; });
    if (onBorder >= 4 && frac > 0.9) pen *= 0.3;
    return { quad: orderCorners(q), score: Math.pow(fill, 3) * Math.sqrt(frac) * pen };
  }
  // Verfijnt de vierhoek: langs elke rand zoeken we loodrecht naar de sterkste overgang (papier -> tafel) en passen daar een lijn op.
  // Daardoor sluiten de randen op de echte papierrand aan (geen afgeknipte letters, geen stukjes achtergrond).
  function sampleAt(g, w, h, x, y) {
    x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  }
  // Totaalkleinstekwadraten-lijn door punten: {px,py (punt), dx,dy (richting)}; verwijdert eerst de 25% slechtste punten.
  function fitLine(pts) {
    function fit(P) {
      var mx = 0, my = 0, i; for (i = 0; i < P.length; i++) { mx += P[i].x; my += P[i].y; } mx /= P.length; my /= P.length;
      var sxx = 0, sxy = 0, syy = 0; for (i = 0; i < P.length; i++) { var a = P[i].x - mx, b = P[i].y - my; sxx += a * a; sxy += a * b; syy += b * b; }
      var th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { px: mx, py: my, dx: Math.cos(th), dy: Math.sin(th) };
    }
    var l = fit(pts);
    var res = pts.map(function (p) { return { p: p, r: Math.abs((p.x - l.px) * -l.dy + (p.y - l.py) * l.dx) }; }).sort(function (a, b) { return a.r - b.r; });
    var keep = res.slice(0, Math.max(4, Math.floor(res.length * 0.75))).map(function (o) { return o.p; });
    return fit(keep);
  }
  function intersect(l1, l2) {
    var det = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(det) < 1e-6) return null;
    var t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
    return { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t };
  }
  function refineQuad(g, w, h, q, R) {
    var cx = 0, cy = 0, e, k; q.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    var lines = [];
    for (e = 0; e < 4; e++) {
      var a = q[e], b = q[(e + 1) % 4], L = dist(a, b); if (L < 10) return null;
      var ex = (b.x - a.x) / L, ey = (b.y - a.y) / L, nx = ey, ny = -ex;
      if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; } // naar buiten
      var found = [], inside = 0, outside = 0, cnt = 0, t, s;
      for (t = 0.12; t <= 0.88; t += 0.04) { var px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t; inside += sampleAt(g, w, h, px - nx * (R + 2), py - ny * (R + 2)); outside += sampleAt(g, w, h, px + nx * (R + 2), py + ny * (R + 2)); cnt++; }
      var sign = inside >= outside ? 1 : -1; // papier is meestal lichter dan wat eromheen ligt; anders omdraaien
      for (t = 0.12; t <= 0.88; t += 0.04) {
        var qx = a.x + (b.x - a.x) * t, qy = a.y + (b.y - a.y) * t, bs = -1, bv = 0;
        var grs = [];
        for (s = -R; s <= R; s += 0.5) {
          var gr = sign * (sampleAt(g, w, h, qx + nx * (s - 1.5), qy + ny * (s - 1.5)) - sampleAt(g, w, h, qx + nx * (s + 1.5), qy + ny * (s + 1.5)));
          grs.push(gr); if (gr > bv) bv = gr;
        }
        // de buitenste duidelijke overgang (papierrand), niet de sterkste: tekst vlak binnen de rand is vaak sterker
        for (var gi = grs.length - 1; gi >= 0; gi--) if (grs[gi] >= Math.max(10, bv * 0.3)) { bs = -R + gi * 0.5; break; }
        if (bs > -1e9 && bv > 10) found.push({ x: qx + nx * bs, y: qy + ny * bs });
      }
      if (found.length < 6) { lines.push({ px: a.x, py: a.y, dx: ex, dy: ey }); continue; } // te weinig bewijs: oude rand houden
      lines.push(fitLine(found));
    }
    var out = [];
    for (k = 0; k < 4; k++) {
      var p = intersect(lines[(k + 3) % 4], lines[k]);
      if (!p || dist(p, q[k]) > Math.max(w, h) * 0.12 || p.x < -w * 0.05 || p.y < -h * 0.05 || p.x > w * 1.05 || p.y > h * 1.05) p = q[k];
      out.push({ x: Math.min(w - 1, Math.max(0, p.x)), y: Math.min(h - 1, Math.max(0, p.y)) });
    }
    return out;
  }

  // Zoekt het blad op een (verkleind) beeld. Probeert meerdere maskers (licht blad / kleurverschil met de rand) en kiest het beste.
  function detectFromData(d, w, h, opts) {
    var n = w * h, g = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) g[i] = lumAt(d, i);
    var gb = boxBlur(g, w, h, 1), cands = [], t = otsu(gb, n), m1 = new Uint8Array(n);
    for (i = 0; i < n; i++) m1[i] = gb[i] > t ? 1 : 0;
    cands.push(candidateFromMask(m1, w, h));
    // papier is licht en bijna kleurloos; tafels, hout en bestek zijn dat meestal niet
    var m3 = new Uint8Array(n), tl = Math.max(60, t * 0.85);
    for (i = 0; i < n; i++) { var mxc = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), mnc = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); m3[i] = gb[i] > tl && mxc > 0 && (mxc - mnc) / mxc < 0.2 ? 1 : 0; }
    cands.push(candidateFromMask(m3, w, h));
    // verschil met de kleur van de rand van de foto (tafel)
    var ring = [], rw = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    for (y = 0; y < h; y += 2) for (x = 0; x < w; x += 2) if (x < rw || y < rw || x >= w - rw || y >= h - rw) ring.push((y * w + x) * 4);
    if (ring.length > 20) {
      var med = [0, 1, 2].map(function (ch) { var v = ring.map(function (p) { return d[p + ch]; }).sort(function (a, b) { return a - b; }); return v[v.length >> 1]; });
      var df = new Float32Array(n);
      for (i = 0; i < n; i++) df[i] = Math.min(255, Math.abs(d[i * 4] - med[0]) + Math.abs(d[i * 4 + 1] - med[1]) + Math.abs(d[i * 4 + 2] - med[2]));
      var dfb = boxBlur(df, w, h, 1), t2 = otsu(dfb, n), m2 = new Uint8Array(n);
      for (i = 0; i < n; i++) m2[i] = dfb[i] > t2 ? 1 : 0;
      cands.push(candidateFromMask(m2, w, h));
    }
    if (opts && opts.debug) opts.debug(cands);
    var best = null;
    cands.forEach(function (c) { if (c && (!best || c.score > best.score)) best = c; });
    if (!best || best.score < 0.25) return null;
    var rq = best.quad, R = Math.max(5, Math.min(w, h) * 0.02), pass;
    for (pass = 0; pass < (opts && opts.noRefine ? 0 : 3); pass++) { var r2 = refineQuad(gb, w, h, rq, pass === 2 ? R / 2 : R); if (r2 && anglesOk(orderCorners(r2))) rq = orderCorners(r2); }
    // ietsje naar binnen (0,15%) zodat de donkere rand van de tafel er niet meer in zit
    var cx = 0, cy = 0; rq.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    return rq.map(function (p) {
      var qx = p.x + (cx - p.x) * 0.0015, qy = p.y + (cy - p.y) * 0.0015;
      return { x: Math.min(1, Math.max(0, qx / (w - 1))), y: Math.min(1, Math.max(0, qy / (h - 1))) };
    });
  }
  function detectCorners(im) {
    var c = toCanvas(im, 480);
    return detectFromData(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height) || FALLBACK;
  }

  // ---------------------------------------------------------------- perspectief
  // Homografie van uitvoer-rechthoek naar bronvierhoek (8x8 stelsel, Gauss).
  function homography(dst, src) {
    var A = [], i;
    for (i = 0; i < 4; i++) {
      var X = dst[i].x, Y = dst[i].y, u = src[i].x, v = src[i].y;
      A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y, u]);
      A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y, v]);
    }
    for (var c = 0; c < 8; c++) {
      var m = c; for (i = c + 1; i < 8; i++) if (Math.abs(A[i][c]) > Math.abs(A[m][c])) m = i;
      var t = A[c]; A[c] = A[m]; A[m] = t;
      for (i = c + 1; i < 8; i++) { var f = A[i][c] / A[c][c]; for (var j = c; j < 9; j++) A[i][j] -= f * A[c][j]; }
    }
    var h = new Array(8);
    for (i = 7; i >= 0; i--) { var s = A[i][8]; for (var k = i + 1; k < 8; k++) s -= A[i][k] * h[k]; h[i] = s / A[i][i]; }
    return h;
  }

  // Echte beeldverhouding (breedte/hoogte) van een scheef gefotografeerd rechthoekig blad,
  // zonder de camera te kennen (Zhang & He): schat de brandpuntsafstand uit de vierhoek.
  // q: TL TR BR BL in pixels, (cx,cy) = beeldmiddelpunt. Geeft 0 als het niet te schatten valt.
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function trueAspect(q, cx, cy, fGuess) {
    var m1 = [q[0].x - cx, q[0].y - cy, 1], m2 = [q[1].x - cx, q[1].y - cy, 1], m3 = [q[3].x - cx, q[3].y - cy, 1], m4 = [q[2].x - cx, q[2].y - cy, 1];
    var k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3), k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
    if (!isFinite(k2) || !isFinite(k3)) return 0;
    var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
    var den = n2[2] * n3[2], f2 = Math.abs(den) < 1e-9 ? -1 : -(n2[0] * n3[0] + n2[1] * n3[1]) / den;
    // Bij kanteling om één as is f niet te schatten (of onzinnig): dan een gangbare telefooncamera aannemen.
    var fg = fGuess || Math.max(Math.abs(cx), Math.abs(cy)) * 2 * 0.75;
    if (!(f2 > 0) || Math.sqrt(f2) < fg * 0.4 || Math.sqrt(f2) > fg * 3) f2 = fg * fg;
    var a = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2], b = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
    if (!(a > 0 && b > 0)) return 0;
    return Math.sqrt(a / b);
  }
  var STD = [0.7071, 1.4142, 0.7727, 1.2941]; // A4/Letter staand en liggend

  // Zet de vierhoek (genormaliseerde hoeken in bron sd, sw x sh) om in een rechte pagina. Werkt op RGBA-data.
  function warpData(sd, sw, sh, corners, maxSide) {
    var src = corners.map(function (p) { return { x: p.x * (sw - 1), y: p.y * (sh - 1) }; });
    var ow = Math.max(dist(src[0], src[1]), dist(src[3], src[2])), oh = Math.max(dist(src[0], src[3]), dist(src[1], src[2]));
    // Perspectief in alle richtingen: de echte verhouding uit de vierhoek halen, niet uit de (verkorte) randen.
    var asp = trueAspect(src, sw / 2, sh / 2), edge = ow / Math.max(1, oh);
    if (asp > 0 && asp > edge / 2 && asp < edge * 2) oh = ow / asp;
    var r = ow / oh;
    for (var k = 0; k < STD.length; k++) if (Math.abs(r / STD[k] - 1) < 0.03) { oh = ow / STD[k]; break; }
    var s = Math.min(1, maxSide / Math.max(ow, oh));
    ow = Math.max(8, Math.round(ow * s)); oh = Math.max(8, Math.round(oh * s));
    var H = homography([{ x: 0, y: 0 }, { x: ow - 1, y: 0 }, { x: ow - 1, y: oh - 1 }, { x: 0, y: oh - 1 }], src);
    var o = new Uint8ClampedArray(ow * oh * 4);
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
      var den = H[6] * x + H[7] * y + 1, u = (H[0] * x + H[1] * y + H[2]) / den, v = (H[3] * x + H[4] * y + H[5]) / den;
      u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
      var x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4, q = (y * ow + x) * 4;
      for (var ch = 0; ch < 3; ch++) o[q + ch] = (sd[p00 + ch] * (1 - fx) + sd[p10 + ch] * fx) * (1 - fy) + (sd[p01 + ch] * (1 - fx) + sd[p11 + ch] * fx) * fy;
      o[q + 3] = 255;
    }
    return { data: o, w: ow, h: oh };
  }

  // ---------------------------------------------------------------- verbeteren
  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, acc, k;
    for (y = 0; y < h; y++) {
      acc = 0; for (k = -r; k <= r; k++) acc += src[y * w + Math.min(w - 1, Math.max(0, k))];
      for (x = 0; x < w; x++) { tmp[y * w + x] = acc / (2 * r + 1); acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      acc = 0; for (k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    return out;
  }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  // Papierhelderheid per blok (85e percentiel, dus niet gevoelig voor tekst of een lichtvlek), dan 3x3 max en zacht gemaakt.
  // get(x,y) levert de waarde van het kanaal. Blokgrootte schaalt mee met de resolutie.
  function gridFrom(get, w, h) {
    var cell = Math.max(8, Math.round(Math.max(w, h) / 110));
    var sw = Math.max(4, Math.ceil(w / cell)), sh = Math.max(4, Math.ceil(h / cell)), small = new Float32Array(sw * sh), x, y;
    var buf = new Float32Array((Math.ceil(cell / 2) + 2) * (Math.ceil(cell / 2) + 2) + 8);
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      var x0 = Math.floor(x * w / sw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / sw)), y0 = Math.floor(y * h / sh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / sh)), len = 0;
      for (var yy = y0; yy < y1 && yy < h; yy += 2) for (var xx = x0; xx < x1 && xx < w; xx += 2) if (len < buf.length) buf[len++] = get(xx, yy);
      var sub = buf.subarray(0, len).sort();
      small[y * sw + x] = len ? sub[Math.floor((len - 1) * 0.85)] : 255;
    }
    var mx = new Float32Array(sw * sh);
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      var m = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var X = Math.min(sw - 1, Math.max(0, x + dx)), Y = Math.min(sh - 1, Math.max(0, y + dy)); if (small[Y * sw + X] > m) m = small[Y * sw + X]; }
      mx[y * sw + x] = m;
    }
    return { sw: sw, sh: sh, grid: boxBlur(mx, sw, sh, 1) };
  }
  function bgSampler(G, w, h) {
    var sw = G.sw, sh = G.sh, bg = G.grid;
    return function (x, y) {
      var fx = Math.min(sw - 1, x * sw / w), fy = Math.min(sh - 1, y * sh / h), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      var ix2 = Math.min(sw - 1, ix + 1), iy2 = Math.min(sh - 1, iy + 1);
      return (bg[iy * sw + ix] * (1 - tx) + bg[iy * sw + ix2] * tx) * (1 - ty) + (bg[iy2 * sw + ix] * (1 - tx) + bg[iy2 * sw + ix2] * tx) * ty;
    };
  }
  // Eén papierhelderheid voor het hele blad (95e percentiel van een steekproef): zonder schaduwcorrectie.
  function constBg(get, w, h) {
    var step = Math.max(1, Math.floor(Math.sqrt(w * h / 40000))), vals = [];
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) vals.push(get(x, y));
    vals.sort(function (a, b) { return a - b; });
    var v = vals[Math.floor((vals.length - 1) * 0.95)] || 255;
    return function () { return v; };
  }
  // Hoe sterk de belichting verschilt (0 = egaal, 1 = zeer ongelijk): 1 - p5/p95 van de papierhelderheid.
  function shadowStrength(d, w, h) {
    var G = gridFrom(function (x, y) { return lumAt(d, y * w + x); }, w, h);
    var a = Array.prototype.slice.call(G.grid).sort(function (p, q) { return p - q; });
    var lo = a[Math.floor(a.length * 0.05)], hi = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
    return hi > 0 ? Math.max(0, 1 - lo / hi) : 0;
  }
  // Lichte verscherping tegen de zachtheid van het rechtzetten.
  function sharpen(d, w, h, amount) {
    var src = new Uint8ClampedArray(d), x, y, c;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var q = (y * w + x) * 4;
      for (c = 0; c < 3; c++) {
        var s = src[q + c - 4] + src[q + c + 4] + src[q + c - w * 4] + src[q + c + w * 4];
        d[q + c] = src[q + c] * (1 + 4 * amount) - amount * s;
      }
    }
  }
  // Papier = 1.0. Zachte curve: papier wit, inkt donkerder, tussentonen blijven.
  function curve(r) { r = Math.min(1.15, r); return Math.min(1, 0.6 * smooth(0.12, 0.95, r) + 0.4 * Math.min(1, r)); }

  // Werkt op RGBA-data. mode: document | gray | color | original. shadow: belichting per plek egaliseren (anders één waarde voor het hele blad).
  // bright en contrast: -1..1 (handmatig fijn afstellen).
  function enhanceData(d, w, h, mode, shadow, bright, contrast) {
    bright = bright || 0; contrast = contrast || 0;
    var x, y, i, q;
    function adj(v) { return clamp255(((v / 255 - 0.5) * (1 + 0.5 * contrast) + 0.5 + 0.15 * bright) * 255); }
    var lum = function (xx, yy) { return lumAt(d, yy * w + xx); };
    if (mode === 'document') { // zwart op wit, papier overal egaal wit
      var bgf = bgSampler(gridFrom(lum, w, h), w, h), c = 0.71, hw = 0.21 / (1 + 0.8 * contrast), gain = 1 + 0.25 * bright;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x; q = i * 4;
        var ratio = Math.min(1.2, lumAt(d, i) * gain / Math.max(40, bgf(x, y)));
        d[q] = d[q + 1] = d[q + 2] = 255 * smooth(c - hw, c + hw, ratio);
      }
      return;
    }
    if (mode === 'original') {
      if (shadow) {
        var bo = bgSampler(gridFrom(lum, w, h), w, h);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          var g1 = Math.min(2.8, 255 / Math.max(60, bo(x, y))); q = (y * w + x) * 4;
          d[q] = d[q] * g1; d[q + 1] = d[q + 1] * g1; d[q + 2] = d[q + 2] * g1;
        }
      }
      for (i = 0; i < w * h; i++) for (var ch0 = 0; ch0 < 3; ch0++) d[i * 4 + ch0] = adj(d[i * 4 + ch0]);
      sharpen(d, w, h, 0.2);
      return;
    }
    if (mode === 'gray') {
      var bg1 = shadow ? bgSampler(gridFrom(lum, w, h), w, h) : constBg(lum, w, h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x; q = i * 4;
        var o = adj(255 * curve(lumAt(d, i) / Math.max(40, bg1(x, y))));
        d[q] = d[q + 1] = d[q + 2] = o;
      }
      sharpen(d, w, h, 0.3);
      return;
    }
    // color ("magic color"): papierkleur (lamp) globaal wit trekken per kanaal; schaduw alleen via de helderheid (zo blijven grote gekleurde vlakken gekleurd)
    var paper = [0, 1, 2].map(function (ch) { return constBg(function (xx, yy) { return d[(yy * w + xx) * 4 + ch]; }, w, h)(); });
    var lg = shadow ? bgSampler(gridFrom(lum, w, h), w, h) : null, Lc = constBg(lum, w, h)();
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      q = (y * w + x) * 4;
      var sc = lg ? Math.min(2.8, Math.max(1, Lc / Math.max(60, lg(x, y)))) : 1;
      d[q] = adj(255 * curve(d[q] * sc / Math.max(40, paper[0])));
      d[q + 1] = adj(255 * curve(d[q + 1] * sc / Math.max(40, paper[1])));
      d[q + 2] = adj(255 * curve(d[q + 2] * sc / Math.max(40, paper[2])));
    }
    sharpen(d, w, h, 0.3);
  }

  // Staat de tekst zijwaarts? Tekstregels geven een sterk schommelend rij-profiel; zijwaarts schommelt het kolom-profiel.
  function textSideways(d, w, h) {
    var rows = new Float32Array(h), cols = new Float32Array(w), dark = 0, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (d[(y * w + x) * 4] < 128) { rows[y]++; cols[x]++; dark++; }
    if (dark < w * h * 0.002 || dark > w * h * 0.4) return false;
    function cv(a) { var m = 0, i; for (i = 0; i < a.length; i++) m += a[i]; m /= a.length; var v = 0; for (i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m); return m > 0 ? Math.sqrt(v / a.length) / m : 0; }
    return cv(cols) > cv(rows) * 1.4;
  }
  // Kleurrijk (foto's, markeringen) of gewone zwarte tekst op papier?
  function isColorful(d, n) {
    var step = Math.max(1, Math.floor(n / 60000)), chroma = [], i;
    for (i = 0; i < n; i += step) { var r = d[i * 4], g2 = d[i * 4 + 1], b = d[i * 4 + 2]; chroma.push(Math.max(r, g2, b) - Math.min(r, g2, b)); }
    var sorted = chroma.slice().sort(function (a, b) { return a - b; }), base = sorted[Math.floor(sorted.length * 0.5)], hot = 0;
    for (i = 0; i < chroma.length; i++) if (chroma[i] > base + 45) hot++;
    return hot / chroma.length > 0.03;
  }

  // ---------------------------------------------------------------- canvas-laag
  function warp(im, corners, maxSide, srcMax) {
    var sc = toCanvas(im, srcMax || 3600), sw = sc.width, sh = sc.height;
    var r = warpData(sc.getContext('2d').getImageData(0, 0, sw, sh).data, sw, sh, corners, maxSide);
    sc.width = sc.height = 0;
    var out = document.createElement('canvas'); out.width = r.w; out.height = r.h;
    var ctx = out.getContext('2d'), img = ctx.createImageData(r.w, r.h); img.data.set(r.data); ctx.putImageData(img, 0, 0);
    return out;
  }

  window.__scanMath = { trueAspect: trueAspect, homography: homography, enhanceData: enhanceData, textSideways: textSideways, isColorful: isColorful, shadowStrength: shadowStrength, detectFromData: detectFromData, warpData: warpData, orderCorners: orderCorners, refineQuad: refineQuad, sampleAt: sampleAt };
  window.__scanOps = {
    detect: async function (msg) {
      var im = await loadImg(msg.b64);
      return { corners: detectCorners(im) };
    },
    scan: async function (msg) {
      var im = await loadImg(msg.b64);
      var corners = msg.corners || detectCorners(im), maxSide = msg.maxSide || 3000;
      var out = warp(im, corners, maxSide, maxSide <= 1200 ? 1600 : 3600);
      var ctx = out.getContext('2d'), img = ctx.getImageData(0, 0, out.width, out.height);
      enhanceData(img.data, out.width, out.height, msg.mode || 'document', msg.shadow !== false, msg.bright || 0, msg.contrast || 0);
      ctx.putImageData(img, 0, 0);
      var png = msg.fmt === 'png', res = { dataUrl: out.toDataURL(png ? 'image/png' : 'image/jpeg', msg.quality || 0.92), w: out.width, h: out.height };
      out.width = out.height = 0;
      return res;
    },
    // Suggestie: kijkt naar de foto en kiest de beste bewerking (stand, schaduw, draaien) met uitleg.
    suggest: async function (msg) {
      var im = await loadImg(msg.b64);
      var corners = msg.corners || detectCorners(im), notes = [];
      var out = warp(im, corners, 800, 1400), w = out.width, hh = out.height;
      var img = out.getContext('2d').getImageData(0, 0, w, hh), n = w * hh;
      var colorful = isColorful(img.data, n), sh = shadowStrength(img.data, w, hh);
      var copy = new Uint8ClampedArray(img.data); enhanceData(copy, w, hh, 'document', true);
      var sideways = textSideways(copy, w, hh);
      out.width = out.height = 0;
      var px = corners.map(function (p) { return { x: p.x * im.width, y: p.y * im.height }; });
      var tb = dist(px[0], px[1]) / Math.max(1, dist(px[3], px[2])), lr = dist(px[0], px[3]) / Math.max(1, dist(px[1], px[2]));
      var tilt = Math.max(tb, 1 / tb, lr, 1 / lr), angle = Math.abs(Math.atan2(px[1].y - px[0].y, px[1].x - px[0].x) * 180 / Math.PI);
      var fb = isFallback(corners);
      notes.push(fb ? 'Randen niet zeker gevonden: sleep de hoeken naar het blad' : 'Randen gevonden en bijgesneden');
      if (tilt > 1.04) notes.push('scheef gefotografeerd, rechtgezet');
      if (angle > 2 && angle < 88) notes.push('blad stond gedraaid, rechtgezet');
      if (sh > 0.12) notes.push('schaduw weggehaald');
      notes.push(colorful ? 'kleur behouden' : 'scherp zwart op wit');
      if (sideways) notes.push('tekst stond zijwaarts, foto gedraaid (klopt het niet? tik op draaien)');
      return { mode: colorful ? 'color' : 'document', shadow: true, rotate: sideways ? 90 : 0, notes: notes, found: !fb };
    },
  };
})();
