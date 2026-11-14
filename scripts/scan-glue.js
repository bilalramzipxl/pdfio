// Documentscan in de renderer-WebView: randdetectie, perspectief rechtzetten, schoon contrast.
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

  // Zoekt het (lichte) papier: Otsu-drempel op verkleind beeld, grootste lichte vlek, uiterste hoeken.
  function detectCorners(im) {
    var c = toCanvas(im, 160), w = c.width, h = c.height;
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
    return [nz(tl), nz(tr), nz(br), nz(bl)];
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

  function enhance(c, mode) {
    var w = c.width, h = c.height, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h, i;
    if (mode === 'color') {
      var lo = [255, 255, 255], hi = [0, 0, 0];
      for (i = 0; i < n; i += 7) for (var ch = 0; ch < 3; ch++) { var v = d[i * 4 + ch]; if (v < lo[ch]) lo[ch] = v; if (v > hi[ch]) hi[ch] = v; }
      for (i = 0; i < n; i++) for (var c2 = 0; c2 < 3; c2++) d[i * 4 + c2] = Math.max(0, Math.min(255, (d[i * 4 + c2] - lo[c2]) * 255 / Math.max(40, hi[c2] - lo[c2])));
      ctx.putImageData(img, 0, 0); return;
    }
    var g = new Float32Array(n);
    for (i = 0; i < n; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    if (mode === 'document') {
      // belichting/schaduw schatten (helderste punt per blok = papier) en papier egaal wit trekken
      var sw = Math.max(8, Math.round(w / 8)), sh = Math.max(8, Math.round(h / 8)), small = new Float32Array(sw * sh), x, y;
      for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
        var mx = 0, x0 = Math.floor(x * w / sw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / sw)), y0 = Math.floor(y * h / sh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / sh));
        for (var yy = y0; yy < y1 && yy < h; yy += 2) for (var xx = x0; xx < x1 && xx < w; xx += 2) if (g[yy * w + xx] > mx) mx = g[yy * w + xx];
        small[y * sw + x] = mx;
      }
      var bg = boxBlur(small, sw, sh, 3);
      for (i = 0; i < n; i++) {
        x = i % w; y = (i / w) | 0;
        var fx = Math.min(sw - 1, x * sw / w), fy = Math.min(sh - 1, y * sh / h), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
        var ix2 = Math.min(sw - 1, ix + 1), iy2 = Math.min(sh - 1, iy + 1);
        var b = (bg[iy * sw + ix] * (1 - tx) + bg[iy * sw + ix2] * tx) * (1 - ty) + (bg[iy2 * sw + ix] * (1 - tx) + bg[iy2 * sw + ix2] * tx) * ty;
        var ratio = Math.min(1.2, g[i] / Math.max(40, b));
        var o = 255 * smooth(0.5, 0.92, ratio);
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = o;
      }
    } else {
      var mn = 255, mxv = 0;
      for (i = 0; i < n; i += 5) { if (g[i] < mn) mn = g[i]; if (g[i] > mxv) mxv = g[i]; }
      for (i = 0; i < n; i++) { var o2 = Math.max(0, Math.min(255, (g[i] - mn) * 255 / Math.max(40, mxv - mn))); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = o2; }
    }
    ctx.putImageData(img, 0, 0);
  }

  function warp(im, corners, maxSide) {
    var sc = toCanvas(im, 2400), sw = sc.width, sh = sc.height;
    var src = corners.map(function (p) { return { x: p.x * (sw - 1), y: p.y * (sh - 1) }; });
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    var ow = Math.max(dist(src[0], src[1]), dist(src[3], src[2])), oh = Math.max(dist(src[0], src[3]), dist(src[1], src[2]));
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
    return out;
  }

  window.__scanOps = {
    detect: async function (msg) {
      var im = await loadImg(msg.b64);
      return { corners: detectCorners(im) };
    },
    scan: async function (msg) {
      var im = await loadImg(msg.b64);
      var corners = msg.corners || detectCorners(im);
      var out = warp(im, corners, msg.maxSide || 1800);
      enhance(out, msg.mode || 'document');
      return { dataUrl: out.toDataURL('image/jpeg', msg.quality || 0.8), w: out.width, h: out.height };
    },
  };
})();
