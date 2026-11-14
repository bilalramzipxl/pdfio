(function () {
  // rAF pauzeert in verborgen WebViews; pdf.js heeft het nodig om te renderen.
  window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 0); };
  window.cancelAnimationFrame = function (h) { clearTimeout(h); };
  var docs = {};
  function post(o) {
    var s = JSON.stringify(o);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage({ pdfRenderer: o }, "*");
    else window.__out = (window.__out || []).concat([o]);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function handle(msg) {
    try {
      if (msg.op === 'load') {
        var task = pdfjsLib.getDocument({ data: b64ToBytes(msg.b64), isEvalSupported: false, useSystemFonts: false });
        var pdf = await task.promise;
        docs[msg.docId] = pdf;
        post({ id: msg.id, ok: true, pages: pdf.numPages });
      } else if (msg.op === 'render') {
        var d = docs[msg.docId];
        if (!d) throw new Error('document niet geladen');
        var page = await d.getPage(msg.page + 1);
        var v1 = page.getViewport({ scale: 1 });
        var scale = Math.min(msg.maxWidth / v1.width, msg.maxScale || 4);
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(vp.width));
        c.height = Math.max(1, Math.round(vp.height));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        var url = c.toDataURL(msg.fmt === 'png' ? 'image/png' : 'image/jpeg', msg.quality || 0.85);
        post({ id: msg.id, ok: true, dataUrl: url, w: c.width, h: c.height, wPt: v1.width, hPt: v1.height });
        c.width = c.height = 0;
        page.cleanup();
      } else if (msg.op === 'detect' || msg.op === 'scan' || msg.op === 'suggest') {
        var r = await window.__scanOps[msg.op](msg);
        r.id = msg.id; r.ok = true; post(r);
      } else if (msg.op === 'free') {
        if (docs[msg.docId]) { docs[msg.docId].destroy(); delete docs[msg.docId]; }
        post({ id: msg.id, ok: true });
      }
    } catch (e) {
      post({ id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  }
  window.handle = handle;
  post({ ready: true });
})();
