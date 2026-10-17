import { describe, expect, it } from 'vitest';
import { trimExtract } from '../scripts/lib/wiki';

describe('trimExtract', () => {
  it('tiene i paragrafi brevi', () => {
    expect(trimExtract('Primo.\nSecondo.')).toBe('Primo.\n\nSecondo.');
  });

  it('si ferma al paragrafo che supera il limite', () => {
    const long = 'x'.repeat(80);
    expect(trimExtract(`Breve.\n${long}`, 50)).toBe('Breve.');
  });

  it('taglia un paragrafo troppo lungo a fine frase', () => {
    const text = `${'a'.repeat(250)}. ${'b'.repeat(100)}. ${'c'.repeat(100)}`;
    expect(trimExtract(text, 400)).toBe(`${'a'.repeat(250)}. ${'b'.repeat(100)}.`);
  });
});
