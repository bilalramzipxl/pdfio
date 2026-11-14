// Documentscan in de renderer-WebView: randdetectie, perspectief rechtzetten, schaduw weg, schoon contrast.
// Wordt door build-renderer.js na renderer-glue.js ingevoegd en registreert extra operaties.
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

  // Zoekt het (lichte) papier: Otsu-drempel op verkleind beeld, grootste lichte vlek, uiterste hoeken.
  function detectCorners(im) {
    var c = toCanvas(im, 320), w = c.width, h = c.height;
    var d = c.getContext('2d').getImageData(0, 0, w, h).data, g = new Uint8Array(w * h), hist = new Array(256).fill(0), i;
    for (i = 0; i < w * h; i++) { g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0; hist[g[i]]++; }
    var total = w * h, sum = 0, sB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    var lab = new Int32Array(w * h), bestN = 0, bestId = 0, id = 0, stack = [];
    for (i = 0; i < w * h; i++) {
      if (g[i] <= thr || lab[i]) continue;
      id++; var n = 0; stack.length = 0; stack.push(i); lab[i] = id;
      while (stack.length) {
        var p = stack.pop(); n++;
        var x = p % w, y = (p / w) | 0, q;
        if (x > 0 && !lab[q = p - 1] && g[q] > thr) { lab[q] = id; stack.push(q); }
        if (x < w - 1 && !lab[q = p + 1] && g[q] > thr) { lab[q] = id; stack.push(q); }
        if (y > 0 && !lab[q = p - w] && g[q] > thr) { lab[q] = id; stack.push(q); }
        if (y < h - 1 && !lab[q = p + w] && g[q] > thr) { lab[q] = id; stack.push(q); }
      }
      if (n > bestN) { bestN = n; bestId = id; }
    }
    if (bestN < total * 0.15) return FALLBACK;
    var tl = null, tr = null, br = null, bl = null, a = 1e9, b = -1e9, cc = -1e9, dd = 1e9;
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      if (lab[y2 * w + x2] !== bestId) continue;
      var s1 = x2 + y2, s2 = x2 - y2;
      if (s1 < a) { a = s1; tl = { x: x2, y: y2 }; }
      if (s1 > b) { b = s1; br = { x: x2, y: y2 }; }
      if (s2 > cc) { cc = s2; tr = { x: x2, y: y2 }; }
      if (s2 < dd) { dd = s2; bl = { x: x2, y: y2 }; }
    }
    function nz(p) { return { x: Math.min(1, Math.max(0, p.x / (w - 1))), y: Math.min(1, Math.max(0, p.y / (h - 1))) }; }
    var res = [nz(tl), nz(tr), nz(br), nz(bl)];
    var area = 0; // vierhoek moet een echte vlek zijn (shoelace)
    for (i = 0; i < 4; i++) { var p1 = res[i], p2 = res[(i + 1) % 4]; area += p1.x * p2.y - p2.x * p1.y; }
    return Math.abs(area) / 2 < 0.1 ? FALLBACK : res;
  }

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

  function luminance(d, n) {
    var g = new Float32Array(n);
    for (var i = 0; i < n; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    return g;
  }

  // Belichting schatten: helderste punt per blok is papier; daarna zacht gemaakt. Blokgrootte schaalt mee met de resolutie.
  function illumGrid(g, w, h) {
    var cell = Math.max(8, Math.round(Math.max(w, h) / 110));
    var sw = Math.max(4, Math.ceil(w / cell)), sh = Math.max(4, Math.ceil(h / cell)), small = new Float32Array(sw * sh), x, y;
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      var mx = 0, x0 = Math.floor(x * w / sw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / sw)), y0 = Math.floor(y * h / sh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / sh));
      for (var yy = y0; yy < y1 && yy < h; yy += 2) for (var xx = x0; xx < x1 && xx < w; xx += 2) if (g[yy * w + xx] > mx) mx = g[yy * w + xx];
      small[y * sw + x] = mx;
    }
    return { sw: sw, sh: sh, grid: boxBlur(small, sw, sh, 2) };
  }
  function bgSampler(G, w, h) {
    var sw = G.sw, sh = G.sh, bg = G.grid;
    return function (x, y) {
      var fx = Math.min(sw - 1, x * sw / w), fy = Math.min(sh - 1, y * sh / h), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      var ix2 = Math.min(sw - 1, ix + 1), iy2 = Math.min(sh - 1, iy + 1);
      return (bg[iy * sw + ix] * (1 - tx) + bg[iy * sw + ix2] * tx) * (1 - ty) + (bg[iy2 * sw + ix] * (1 - tx) + bg[iy2 * sw + ix2] * tx) * ty;
    };
  }
  // Hoe sterk de belichting verschilt (0 = egaal, 1 = zeer ongelijk): 1 - p5/p95 van de papierhelderheid.
  function shadowStrength(G) {
    var a = Array.prototype.slice.call(G.grid).sort(function (p, q) { return p - q; });
    var lo = a[Math.floor(a.length * 0.05)], hi = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
    return hi > 0 ? Math.max(0, 1 - lo / hi) : 0;
  }
  function percentile(vals, step, p) {
    var hist = new Array(256).fill(0), cnt = 0, i;
    for (i = 0; i < vals.length; i += step) { hist[Math.max(0, Math.min(255, vals[i] | 0))]++; cnt++; }
    var target = cnt * p, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  // Schaduw weg: elk pixel delen door de lokale papierhelderheid (kleur blijft behouden).
  function removeShadow(d, w, h, bgf) {
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var gain = Math.min(2.8, 255 / Math.max(60, bgf(x, y))), q = (y * w + x) * 4;
      d[q] = Math.min(255, d[q] * gain); d[q + 1] = Math.min(255, d[q + 1] * gain); d[q + 2] = Math.min(255, d[q + 2] * gain);
    }
  }
  // Lichte verscherping tegen de zachtheid van het rechtzetten (alleen foto-achtige standen).
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

  // Werkt op RGBA-data. mode: document | gray | color | original. shadow: schaduw/belichting egaliseren.
  function enhanceData(d, w, h, mode, shadow) {
    var n = w * h, i, g = luminance(d, n);
    var bgf = (mode === 'document' || shadow) ? bgSampler(illumGrid(g, w, h), w, h) : null;
    if (mode === 'document') {
      for (i = 0; i < n; i++) {
        var ratio = Math.min(1.2, g[i] / Math.max(40, bgf(i % w, (i / w) | 0)));
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255 * smooth(0.5, 0.92, ratio);
      }
      return;
    }
    if (shadow) { removeShadow(d, w, h, bgf); g = luminance(d, n); }
    if (mode === 'original') { sharpen(d, w, h, 0.2); return; }
    var step = Math.max(1, Math.floor(n / 200000)), lo = percentile(g, step, 0.01), hi = percentile(g, step, 0.99), span = Math.max(40, hi - lo);
    if (mode === 'gray') {
      for (i = 0; i < n; i++) { var o = Math.max(0, Math.min(255, (g[i] - lo) * 255 / span)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = o; }
    } else { // color: papier neutraal wit (kleurzweem van de lamp weg), daarna één gezamenlijk contrast (geen tint-verschuiving)
      var sr = 0, sg = 0, sb = 0, cnt = 0, cut = percentile(g, step, 0.7);
      for (i = 0; i < n; i += step) if (g[i] >= cut) { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; cnt++; }
      var wb = [1, 1, 1];
      if (cnt) { var mean = [sr / cnt, sg / cnt, sb / cnt], L = (mean[0] + mean[1] + mean[2]) / 3; wb = mean.map(function (m) { return Math.max(0.75, Math.min(1.35, L / Math.max(1, m))); }); }
      for (i = 0; i < n; i++) for (var ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.max(0, Math.min(255, (d[i * 4 + ch] * wb[ch] - lo) * 255 / span));
    }
    sharpen(d, w, h, 0.25);
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

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  var STD = [0.7071, 1.4142, 0.7727, 1.2941]; // A4/Letter staand en liggend

  function warp(im, corners, maxSide, srcMax) {
    var sc = toCanvas(im, srcMax || 3600), sw = sc.width, sh = sc.height;
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
    var sd = sc.getContext('2d').getImageData(0, 0, sw, sh).data;
    var out = document.createElement('canvas'); out.width = ow; out.height = oh;
    var octx = out.getContext('2d'), od = octx.createImageData(ow, oh), o = od.data;
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
      var den = H[6] * x + H[7] * y + 1, u = (H[0] * x + H[1] * y + H[2]) / den, v = (H[3] * x + H[4] * y + H[5]) / den;
      u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
      var x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4, q = (y * ow + x) * 4;
      for (var ch = 0; ch < 3; ch++) o[q + ch] = (sd[p00 + ch] * (1 - fx) + sd[p10 + ch] * fx) * (1 - fy) + (sd[p01 + ch] * (1 - fx) + sd[p11 + ch] * fx) * fy;
      o[q + 3] = 255;
    }
    octx.putImageData(od, 0, 0);
    sc.width = sc.height = 0;
    return out;
  }

  window.__scanMath = { trueAspect: trueAspect, homography: homography, enhanceData: enhanceData, textSideways: textSideways, isColorful: isColorful, illumGrid: illumGrid, shadowStrength: shadowStrength };
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
      enhanceData(img.data, out.width, out.height, msg.mode || 'document', msg.shadow !== false);
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
      var colorful = isColorful(img.data, n), sh = shadowStrength(illumGrid(luminance(img.data, n), w, hh));
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
