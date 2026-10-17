import { describe, expect, it } from 'vitest';
import type { AuthorInfo } from '../src/lib/types';
import { blurbText } from '../scripts/book-info';
import { ancientWork, lastFreeDeathYear, publicDomain } from '../scripts/free-books';

describe('blurbText', () => {
  it('trasforma gli a capo in paragrafi e decodifica le entità', () => {
    expect(blurbText('Troy &amp; Sparrow.&#xa0;<br />Un <b>matrimonio</b> forzato.<br /><br />Fine')).toBe('Troy & Sparrow.\nUn matrimonio forzato.\nFine');
  });

  it('scarta le righe di soli hashtag', () => {
    expect(blurbText('Trama.<br /><br />#ArrangedMarriage #Spicy #HateToLove')).toBe('Trama.');
  });
});

describe('pubblico dominio', () => {
  const authors: Record<string, { died?: number | null }> = {
    'jane austen': { died: 1817 },
    'george orwell': { died: 1950 },
    'albert camus': { died: 1960 },
    'l j shen': { died: null },
  };
  const get = (k: string) => authors[k] as AuthorInfo | undefined;
  const book = (subtitle: string, year?: number | string) => ({ title: 'X', subtitle, cover: null, sourceUrl: null, externalId: null, year });

  it('nel 2026 sono liberi gli autori morti entro il 1955', () => {
    expect(lastFreeDeathYear('2026-10-17')).toBe(1955);
    expect(publicDomain(book('George Orwell'), get, 1955)).toBe(1950);
    expect(publicDomain(book('Albert Camus'), get, 1955)).toBeUndefined();
  });

  it("con più autori conta l'ultimo, e tutti devono avere una data", () => {
    expect(publicDomain(book('Jane Austen & George Orwell'), get, 1955)).toBe(1950);
    expect(publicDomain(book('Jane Austen & Albert Camus'), get, 1955)).toBeUndefined();
    expect(publicDomain(book('L.J. Shen'), get, 1955)).toBeUndefined();
    expect(publicDomain(book('Autore Sconosciuto'), get, 1955)).toBeUndefined();
  });

  it('opere antiche senza autore', () => {
    expect(publicDomain(book('Autori vari', 'I millennio a.C. - I secolo d.C.'), get, 1955)).toBeNull();
    expect(publicDomain(book('Autori vari', 1995), get, 1955)).toBeUndefined();
    expect(ancientWork('1304-1321')).toBe(true);
    expect(ancientWork('VIII secolo a.C.')).toBe(true);
    expect(ancientWork('1954-1955')).toBe(false);
  });
});
