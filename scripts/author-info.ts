// Schede degli autori per le modali dei Libri e delle liste di libri curate: introduzione della voce di Wikipedia (prima in italiano,
// poi in inglese; CC BY-SA) e foto con licenza libera da Wikimedia Commons, con autore e licenza da citare.
// Il link alla pagina dell'autore su Apple Books viene dalle schede dei libri (scripts/book-info.ts).
// Lanciato da `npm run info:libri` dopo le schede dei libri.

import { artistKey, splitArtists } from '../src/lib/aggregate';
import type { AuthorInfo, BookInfo } from '../src/lib/types';
import { MetaCache } from './lib/store';
import { commonsCredit, wikiPerson, type PersonKind } from './lib/wiki';
import { BOOK_INFO_CACHE, bookTargets } from './book-info';

export const AUTHOR_INFO_CACHE = 'author-info';

/** Le voci sugli autori: scrittori, ma in classifica ci sono anche giornalisti, storici e politici. */
const AUTHOR: PersonKind = {
  qualifiers: {
    it: ['', 'scrittore', 'scrittrice', 'giornalista', 'autore', 'autrice', 'scrittore russo', 'scrittore statunitense', 'scrittrice statunitense', 'fumettista'],
    en: ['', 'writer', 'author', 'novelist', 'American writer', 'American author', 'British writer', 'journalist', 'poet', 'cartoonist'],
  },
  words: {
    it: /\b(scrittor[ei]|scrittric[ei]|romanzier[ei]|autor[ei]|autric[ei]|giornalist[ai]|saggist[ai]|poet[ai]|poetessa|drammaturg[oi]|sceneggiator[ei]|storic[oi]|filosof[oi]|politic[oi]|politica|conduttor[ei]|conduttrice|accademic[oi]|fumettist[ai]|disegnator[ei]|illustrator[ei]|illustratrice|psicoanalist[ai]|psichiatr[ai]|critic[oi] letterari[oa])\b/i,
    en: /\b(writers?|authors?|novelists?|journalists?|essayists?|poets?|playwrights?|screenwriters?|historians?|philosophers?|politicians?|broadcasters?|academics?|cartoonists?|comics artists?|illustrators?|psychoanalysts?|psychiatrists?|literary critics?)\b/i,
  },
};

export async function lookupAuthorInfo({ budget = 60, log = console.log } = {}) {
  const cache = await new MetaCache<AuthorInfo>(AUTHOR_INFO_CACHE, 180).load();
  const books = await new MetaCache<BookInfo>(BOOK_INFO_CACHE, 180).load();
  // Nomi da cercare (divisi come nella classifica) e, per i libri di un solo autore, la sua pagina su Apple Books.
  const names = new Map<string, string>();
  const appleUrls = new Map<string, string>();
  for (const [bookKey, e] of await bookTargets()) {
    const parts = splitArtists(e.subtitle ?? '').filter((name, i) => i % 2 === 0 && name.trim() && !/^autori vari$/i.test(name.trim()));
    for (const name of parts) names.set(artistKey(name), name.trim());
    const url = books.get(bookKey)?.authorUrl;
    if (parts.length === 1 && url) appleUrls.set(artistKey(parts[0]!), url);
  }

  let done = 0;
  try {
    for (const [key, name] of names) {
      if (cache.has(key) || done >= budget) continue;
      done++;
      const found = (await wikiPerson('it', name, AUTHOR)) ?? (await wikiPerson('en', name, AUTHOR));
      const photo = found?.image ? await commonsCredit(found.image) : null;
      cache.set(key, { wiki: found?.intro ?? null, photo, appleUrl: appleUrls.get(key) ?? null });
      log(`- ${name}: ${found ? `Wikipedia ${found.intro.lang} «${found.intro.title}»` : 'Wikipedia ✗'}, foto ${photo ? '✓' : '✗'}`);
      if (done % 10 === 0) await cache.save();
    }
  } catch (err) {
    log(`! schede autori: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
  }
  // Link ad Apple Books trovato dopo la scheda (es. libro arrivato in classifica più tardi).
  for (const [key, url] of appleUrls) {
    const info = cache.get(key);
    if (info && !info.appleUrl) cache.set(key, { ...info, appleUrl: url });
  }
  await cache.save();
  const missing = [...names.keys()].filter((k) => !cache.has(k)).length;
  log(`Schede autori: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}
