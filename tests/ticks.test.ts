import { describe, expect, it } from 'vitest';
import { applyQueue, isTickStore } from '../src/lib/ticks';

describe('applyQueue', () => {
  it('applica i cambi in coda sopra le liste del server, nell\'ordine', () => {
    const lists = applyQueue({ visti: ['a', 'b'], 'serie-viste': ['1'] }, [
      { lista: 'visti', chiave: 'b', on: false },
      { lista: 'visti', chiave: 'c', on: true },
      { lista: 'posseduti:libri-da-avere', chiave: 'x|y', on: true },
      { lista: 'visti', chiave: 'c', on: false },
    ]);
    expect([...lists.visti!]).toEqual(['a']);
    expect([...lists['serie-viste']!]).toEqual(['1']);
    expect([...lists['posseduti:libri-da-avere']!]).toEqual(['x|y']);
  });

  it('senza coda restituisce le liste del server', () => {
    expect(applyQueue({ visti: ['a'] }, [])).toEqual({ visti: new Set(['a']) });
  });
});

describe('isTickStore', () => {
  it('accetta solo le liste note (come LIST_PATTERN nell\'API PHP)', () => {
    expect(isTickStore('visti')).toBe(true);
    expect(isTickStore('serie-viste')).toBe(true);
    expect(isTickStore('posseduti:album-da-avere')).toBe(true);
    expect(isTickStore('vista:visti')).toBe(false);
    expect(isTickStore('tema')).toBe(false);
    expect(isTickStore('posseduti:')).toBe(false);
    expect(isTickStore('posseduti:Maiuscole')).toBe(false);
  });
});
