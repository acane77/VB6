import {crc32} from '../project/zip.js';

const join = parts => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {output.set(part, offset); offset += part.length;}
  return output;
};
const u32 = value => {const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes;};
const chunk = (type, data) => {
  const content = join([new TextEncoder().encode(type), data]);
  return join([u32(data.length), content, u32(crc32(content))]);
};

/** Original generic application glyph. Deterministic RGBA PNG/STORE-zlib output;
 * no canvas, OS fonts, image libraries, clocks or platform compression settings.
 */
export function applicationIconPNG(size) {
  if (![192, 512].includes(size)) throw new RangeError('Application icon must be 192 or 512 pixels.');
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * 512 / size, py = y * 512 / size;
    let color = [36, 54, 75];
    if (px >= 96 && px < 416 && py >= 136 && py < 376) color = [192, 192, 192];
    if (px >= 112 && px < 400 && py >= 152 && py < 192) color = [0, 0, 128];
    if (py >= 236 && py < 320 && ((px >= 148 && px < 208 && Math.abs(px - 152 - (py - 240) * 2 / 3) < 10) || (px >= 192 && px < 256 && Math.abs(px - 248 + (py - 240) * 2 / 3) < 10) || (px >= 276 && px < 348 && (px < 296 || px >= 328 || py < 256 || py >= 300)))) color = [36, 54, 75];
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    raw.set([...color, 255], offset);
  }
  const blocks = [new Uint8Array([0x78, 0x01])];
  let a = 1, b = 0;
  for (const byte of raw) {a = (a + byte) % 65521; b = (b + a) % 65521;}
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const data = raw.subarray(offset, offset + 65535), header = new Uint8Array(5), view = new DataView(header.buffer);
    header[0] = offset + data.length === raw.length ? 1 : 0;
    view.setUint16(1, data.length, true); view.setUint16(3, data.length ^ 65535, true);
    blocks.push(header, data);
  }
  blocks.push(u32(((b << 16) | a) >>> 0));
  const ihdr = join([u32(size), u32(size), new Uint8Array([8, 6, 0, 0, 0])]);
  return join([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', join(blocks)), chunk('IEND', new Uint8Array())]);
}
