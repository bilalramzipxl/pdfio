// Kleine server om de renderer in een gewone browser te testen: http://localhost:8123/
const http = require('http'), fs = require('fs'), path = require('path');
const { PDFDocument } = require('pdf-lib');
http.createServer(async (req, res) => {
  if (req.url === '/test.b64') {
    const d = await PDFDocument.create(); const p = d.addPage([300, 400]); p.drawText('Hallo renderer', { x: 30, y: 300, size: 24 });
    res.end(Buffer.from(await d.save()).toString('base64'));
  } else { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(path.join(__dirname, 'renderer.html'))); }
}).listen(8123, () => console.log('http://localhost:8123/'));
