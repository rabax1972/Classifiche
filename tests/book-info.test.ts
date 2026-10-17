import { describe, expect, it } from 'vitest';
import { blurbText } from '../scripts/book-info';

describe('blurbText', () => {
  it('trasforma gli a capo in paragrafi e decodifica le entità', () => {
    expect(blurbText('Troy &amp; Sparrow.&#xa0;<br />Un <b>matrimonio</b> forzato.<br /><br />Fine')).toBe('Troy & Sparrow.\nUn matrimonio forzato.\nFine');
  });

  it('scarta le righe di soli hashtag', () => {
    expect(blurbText('Trama.<br /><br />#ArrangedMarriage #Spicy #HateToLove')).toBe('Trama.');
  });
});
