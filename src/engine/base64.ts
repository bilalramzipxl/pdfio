const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < CH.length; i++) LOOKUP[CH.charCodeAt(i)] = i;

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    out += CH[a >> 2] + CH[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < n ? CH[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < n ? CH[c & 63] : '=';
  }
  return out;
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const n = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)], b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)] : 0;
    if (p < n) out[p++] = (a << 2) | (b >> 4);
    if (p < n) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < n) out[p++] = ((c & 3) << 6) | d;
  }
  return out;
}
