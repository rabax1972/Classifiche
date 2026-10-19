import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from '../scripts/lib/zip';

/** Lettura minima dello zip dalla directory centrale, come fa ZipArchive. */
function readZip(zip: Buffer): Record<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLength);
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const body = zip.subarray(start, start + size);
    out[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return out;
}

describe('createZip', () => {
  it('scrive file compressi e no, con nomi UTF-8, rileggibili dalla directory centrale', () => {
    const page = Buffer.from('<p>Classifiche</p>\n'.repeat(500));
    const tiny = Buffer.from('x');
    const files = readZip(createZip([
      { name: 'film/settimana/index.html', data: page },
      { name: 'serie-tv/città.json', data: tiny },
      { name: 'vuoto.txt', data: Buffer.alloc(0) },
    ]));
    expect(Object.keys(files)).toEqual(['film/settimana/index.html', 'serie-tv/città.json', 'vuoto.txt']);
    expect(files['film/settimana/index.html']!.equals(page)).toBe(true);
    expect(files['serie-tv/città.json']!.equals(tiny)).toBe(true);
    expect(files['vuoto.txt']!.length).toBe(0);
  });
});
