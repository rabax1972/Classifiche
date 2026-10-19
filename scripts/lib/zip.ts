// Archivio zip minimo (deflate, nomi UTF-8, niente zip64) per mandare i file aggiornati al server: ZipArchive del PHP lo estrae.

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Percorso nell'archivio, con "/" come separatore. */
  name: string;
  data: Buffer;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    // Campi comuni a intestazione locale e centrale: versione 2.0, flag UTF-8, metodo, data 1/1/1980, crc, dimensioni, nome.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(stored ? 0 : 8, 4);
    common.writeUInt16LE(0, 6);
    common.writeUInt16LE(0x21, 8);
    common.writeUInt32LE(crc, 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(fileName.length, 22);
    common.writeUInt16LE(0, 24);

    const local = Buffer.alloc(4);
    local.writeUInt32LE(0x04034b50);
    parts.push(local, common, fileName, body);

    const head = Buffer.alloc(6);
    head.writeUInt32LE(0x02014b50);
    head.writeUInt16LE(20, 4);
    const tail = Buffer.alloc(14); // commento, disco, attributi interni ed esterni: zero; poi la posizione dell'intestazione locale
    tail.writeUInt32LE(offset, 10);
    central.push(head, common, tail, fileName);
    offset += 30 + fileName.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
