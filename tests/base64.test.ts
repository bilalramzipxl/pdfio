import { describe, it, expect } from 'vitest';
import { bytesToB64, b64ToBytes } from '../src/engine/base64';

describe('base64', () => {
  it('komt overeen met Node voor elke lengte', () => {
    for (let len = 0; len < 40; len++) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      expect(bytesToB64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(Array.from(b64ToBytes(bytesToB64(b)))).toEqual(Array.from(b));
    }
  });
  it('negeert data-url prefix', () => {
    expect(Array.from(b64ToBytes('data:image/jpeg;base64,AQID'))).toEqual([1, 2, 3]);
  });
});
