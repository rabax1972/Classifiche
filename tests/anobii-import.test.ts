import { describe, expect, it } from 'vitest';
import { bookKeys, parseAnobiiCsv, readingState } from '../scripts/anobii-import';

/** Come l'esportazione di aNobii: testo dei campi in UTF-16LE, virgole, virgolette e a capo a byte singolo. */
function mixed(rows: string[][]): Buffer {
  const parts: Buffer[] = [];
  for (const row of rows) {
    row.forEach((field, i) => {
      if (i) parts.push(Buffer.from([0x2c]));
      const quoted = /[",\n ]/.test(field);
      if (quoted) parts.push(Buffer.from([0x22]));
      parts.push(Buffer.from(field, 'utf16le'));
      if (quoted) parts.push(Buffer.from([0x22]));
    });
    parts.push(Buffer.from([0x0a]));
  }
  return Buffer.concat(parts);
}

describe('parseAnobiiCsv', () => {
  it("legge l'esportazione a codifica mista, con virgole, accenti e campi vuoti", () => {
    const rows = [
      ['ISBN', 'Titolo', 'Autore', 'Stato di lettura'],
      ['9788835701392', 'Le coordinate della felicità', 'Gianluca Gotto', 'In lettura dal 2026-10-10'],
      ['', 'Il commosso viaggiatore. Alla scoperta dell’Africa', 'Giobbe Covatta, Paola Catella', ''],
    ];
    expect(parseAnobiiCsv(mixed(rows))).toEqual(rows);
  });

  it('legge anche un CSV in UTF-8', () => {
    expect(parseAnobiiCsv(Buffer.from('ISBN,Titolo\n1,"Uno, due"\n'))).toEqual([
      ['ISBN', 'Titolo'],
      ['1', 'Uno, due'],
    ]);
  });
});

describe('readingState', () => {
  it('finiti e senza stato sono letti; in lettura e abbandonati no', () => {
    expect(readingState('Finito nel 2019-11-23')).toEqual({ read: true, finished: '2019-11-23' });
    expect(readingState('Finito nel 1997-02')).toEqual({ read: true, finished: '1997-02' });
    expect(readingState('')).toEqual({ read: true, finished: null });
    expect(readingState('In lettura dal 2026-10-10').read).toBe(false);
    expect(readingState('Abbandonato nel 2020-01-01').read).toBe(false);
  });
});

describe('bookKeys', () => {
  it('titolo intero, senza sottotitolo dopo il punto e con il sottotitolo di aNobii; primo autore', () => {
    const keys = bookKeys('Il commosso viaggiatore. Alla scoperta dell’Africa', '', 'Giobbe Covatta, Paola Catella');
    expect(keys).toContain('il commosso viaggiatore alla scoperta dell africa|giobbe covatta');
    expect(keys).toContain('il commosso viaggiatore|giobbe covatta');
    expect(bookKeys('La ragazza che doveva morire', 'Millennium 6', 'David Lagercrantz')).toContain(
      'la ragazza che doveva morire millennium 6|david lagercrantz',
    );
  });
});
