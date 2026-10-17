# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sito statico "Classifiche Italia" (Astro + TypeScript + Tailwind 4): classifiche italiane di Canzoni, Libri, Cinema, Film, Serie TV
per Oggi/Settimana/Mese/Anno, più liste curate statiche (album e libri "da avere"). Niente backend: i dati sono JSON in `data/`,
generati da script Node e committati. Codice, commenti, testi del sito e messaggi di commit sono in italiano.

## Comandi

- `npm run dev` — sito in locale (http://localhost:4321)
- `npm run build` — sito statico in `dist/`; `npm run typecheck` (`tsc --noEmit`, non controlla i `.astro`)
- `npm test` — vitest; un solo file: `npx vitest run tests/aggregate.test.ts`; un solo test: `npx vitest run -t "nome del test"`
- `npm run update` — quello che fa il cron giornaliero: `ingest` → `aggregate` → `info:canzoni` → `info:libri` → `info:film` → `info:serie`
- `npm run info:<canzoni|libri|film|serie> -- --all` — schede delle modali senza budget di richieste (di default ogni run ne fa un numero limitato)
- `covers:album`, `tracks:album`, `covers:libri` — completamento a mano delle liste curate (`-- --force` per rifare tutto)

Gli script girano con `tsx`; le chiavi (`TMDB_READ_TOKEN` o `TMDB_API_KEY`, `LASTFM_API_KEY`, `CLASSIFICHE_CONTACT`) stanno in `.env`
(vedi `.env.example`). Senza chiave le fonti relative vengono saltate. CI (`.github/workflows/ci.yml`): typecheck, test, build.

## Architettura

Pipeline dei dati (descritta in dettaglio nel README):

1. `scripts/ingest.ts` chiama gli adapter in `scripts/adapters/` (interfaccia `SourceAdapter` in `types.ts`, registro in `index.ts`) e
   scrive `data/snapshots/{categoria}/{data}.json` (una lista per fonte) e `data/official/...` (Netflix settimanale, FIMI annuale via Wikipedia).
   Esito per fonte in `data/status.json`.
2. `scripts/aggregate.ts` usa le funzioni pure di `src/lib/aggregate.ts` e `src/lib/build.ts` (punteggio Borda su finestre mobili,
   variazioni, fallback tra fonti in ordine di priorità) e scrive `data/charts/{categoria}/{periodo}.json`.
3. Le pagine Astro (`src/pages/[categoria]/[periodo].astro` → `src/components/ChartPage.astro`) leggono i JSON a build time
   tramite `import.meta.glob` in `src/lib/data.ts`.

Configurazione centrale in `src/lib/sources.ts`: `SOURCES` (attribuzione, `retentionDays`) e `CATEGORIES` (`snapshotSources` in ordine di
priorità, `officialFor`). Tipi condivisi tra script e sito in `src/lib/types.ts`.

Identità di un elemento: `entryKey()` (titolo + primo nome del sottotitolo, normalizzati). Persone: `artistKey()`; i nomi multipli
si dividono con `splitArtists()`. Per i film il sottotitolo è `"Regista, Regista (anno)"` → `movieSubtitle()`.

### Schede in modale

Ogni categoria con schede ha una coppia di modali opera/persona: Canzoni (Song/ArtistDialog), Libri e liste di libri (Book/AuthorDialog),
Cinema e Film (Movie/DirectorDialog), Serie TV (Series/CreatorDialog). Lo schema è sempre lo stesso:

- uno script `scripts/*-info.ts` raccoglie i dati in `data/cache/*-info.json` con `MetaCache` (`scripts/lib/store.ts`, cache committata
  con scadenza), chiave `entryKey` per le opere e `artistKey` per le persone; lo script dell'opera lancia poi quello della persona;
- le persone usano `wikiPerson()` + `commonsCredit()` di `scripts/lib/wiki.ts` (intro Wikipedia it→en, foto Commons solo con autore
  e licenza), con un `PersonKind` (qualificatori dei titoli e parole del mestiere) per evitare omonimi;
- il componente incorpora i dati della pagina come JSON (`<script type="application/json">`) e costruisce il contenuto lato client con
  `textContent`; `src/lib/dialogs.ts` gestisce apertura, link diretto nell'hash (`#libro=…`, `#regista=…`, `#serie=…`) e ritorno del focus;
- in `ChartTable.astro` i titoli e i nomi diventano pulsanti con classe trigger e attributo `data-*` della modale.

## Vincoli da rispettare

- Uso solo non commerciale (termini TMDB e Last.fm).
- TMDB: dati conservati al massimo 6 mesi. Gli snapshot TMDB oltre 180 giorni vengono cancellati (`pruneSnapshots`), le cache
  TMDB scadono a 150 giorni (`META_MAX_AGE_DAYS`); mostrare l'attribuzione TMDB, e JustWatch per i dati "dove vederlo".
- Testi di Wikipedia sempre citati con link alla voce e licenza CC BY-SA 4.0; niente testi delle canzoni (solo link a Genius).
- Nuove fonti solo se lecite (termini d'uso, robots.txt). Fonti già scartate per questo motivo, da non reintrodurre senza ok
  esplicito: IBS, Libraccio, Mondadori Store, Box Office Mojo, Cinetel, classifiche Deezer, sito FIMI diretto.
- Le richieste HTTP passano da `fetchJson`/`fetchText` di `scripts/lib/http.ts` (User-Agent con contatto, retry, limiti per host
  in `HOST_INTERVAL`, cache su disco opzionale con `cacheTtlMs`).
- Le pagine nuove o modificate che citano fonti vanno riportate anche in `src/pages/fonti.astro`.
