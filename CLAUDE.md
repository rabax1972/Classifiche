# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sito statico "Classifiche Italia" (Astro + TypeScript + Tailwind 4): classifiche italiane di Canzoni, Libri, Cinema, Film, Serie TV
per Oggi/Settimana/Mese/Anno, più liste curate statiche (album e libri "da avere"). Niente backend: i dati sono JSON in `data/`,
generati da script Node e committati. Codice, commenti, testi del sito e messaggi di commit sono in italiano.

## Comandi

- `npm run dev` — sito in locale (http://localhost:4321)
- `npm run build` — sito statico in `dist/`; `npm run typecheck` (`tsc --noEmit`, non controlla i `.astro`)
- `npm test` — vitest; un solo file: `npx vitest run tests/aggregate.test.ts`; un solo test: `npx vitest run -t "nome del test"`
- `npm run update` — quello che fa il cron giornaliero: `ingest` → `imdb:top` → `aggregate` → `info:canzoni` → `info:libri` → `info:film` → `ratings:film` → `info:serie`
- `npm run info:<canzoni|libri|film|serie> -- --all` — schede delle modali senza budget di richieste (di default ogni run ne fa un numero limitato)
- `npm run dist:aruba` (o `distribuzione-aruba.cmd`) — build per https://www.giacomorabaglia.com/classifiche/ in `aruba/classifiche/`,
  da caricare a mano con FileZilla (niente deploy automatico); in `aruba/modifiche/` solo i file cambiati dall'ultima pubblicazione
  confermata (`-- --conferma`, impronte in `aruba/pubblicato.json`, e svuota sul server i file della pubblicazione automatica;
  `-- --tutto` per ripartire da zero)
- `npm run pubblica:aruba` — pubblicazione automatica su Aruba senza FTP (ultimo passo del cron, vedi "Aggiornamento automatico"); serve `ARUBA_CHIAVE`
- `covers:album`, `tracks:album`, `covers:libri` — completamento a mano delle liste curate (`-- --force` per rifare tutto)
- `npm run import:trakt` — film, serie ed episodi visti su Trakt (`TRAKT_CLIENT_ID`, `TRAKT_USERNAME`, `TRAKT_ACCOUNT` in `.env`) in un
  file di spunte in `privato/` (fuori da git), da importare a mano da `/account/` nell'account indicato
- `npm run import:anobii` — libri letti dall'esportazione CSV di aNobii (il file più recente in `privato/`; aNobii non ha API e il suo
  robots.txt esclude i bot) in un file di spunte e nel catalogo `privato/libri-letti.json`

Gli script girano con `tsx`; le chiavi (`TMDB_READ_TOKEN` o `TMDB_API_KEY`, `LASTFM_API_KEY`, `CLASSIFICHE_CONTACT`) stanno in `.env`
(vedi `.env.example`). Senza chiave le fonti relative vengono saltate. CI (`.github/workflows/ci.yml`): typecheck, test, build.

## Architettura

Pipeline dei dati (descritta in dettaglio nel README):

1. `scripts/ingest.ts` chiama gli adapter in `scripts/adapters/` (interfaccia `SourceAdapter` in `types.ts`, registro in `index.ts`) e
   scrive `data/snapshots/{categoria}/{data}.json` (una lista per fonte) e `data/official/...` (Netflix settimanale, FIMI annuale via Wikipedia).
   Esito per fonte in `data/status.json`. `scripts/imdb-top.ts` scrive `data/official/film/imdb-top.json` (IMDb Top 100 dai dataset
   non commerciali di IMDb, una volta a settimana; il sito imdb.com vieta lo scraping), che `aggregate` aggiunge come scheda a tutti i periodi di Film.
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

Voti IMDb e Rotten Tomatoes dei film (`scripts/movie-ratings.ts`, `getMovieRatings()` per ID TMDB): IMDb dai dataset non commerciali,
Tomatometer da Wikidata; `data/cache/movie-ratings.json` per i film delle classifiche, `privato/film-voti.json` per quelli solo del catalogo
privato. Badge in `ChartTable.astro` e `ratingBadges()` di `src/lib/my-list.ts` (MovieDialog, MyMovies).

Eccezione: gli episodi delle serie (`scripts/episode-info.ts`, un file per serie in `data/cache/episodes/`) sono troppi per la pagina;
`src/pages/serie-tv/episodi/[id]/[stagione].json.ts` li pubblica come JSON statici che `SeriesDialog` scarica alla scelta della stagione.

### Account e spunte

Unica parte con un backend: `public/api/index.php` (+ `_inc/app.php`), PHP 8.3 su hosting Windows/IIS di Aruba (niente `pdo_sqlsrv`, quindi
SQLite in `mdb-database/classifiche.sqlite` nella radice del dominio; `.htaccess` lì non vale). Registrazione con conferma email, sessioni
in un cookie con token il cui hash sta nel DB, limiti ai tentativi, schema versionato con `PRAGMA user_version` in `migrate()`.
Lato client tutte le spunte passano da `src/lib/ticks.ts` (localStorage + coda verso l'API + riallineamento a ogni pagina, evento
`TICK_EVENT`); `seen.ts` e `CuratedPage.astro` lo usano. Le liste ammesse (`visti`, `da-vedere`, `serie-viste`, `episodi-visti` con chiave `idTMDB:stagione:episodio`, `letti`, `posseduti:…`) sono definite in due
posti da tenere uguali: `STORE_PATTERN` in `ticks.ts` e `LIST_PATTERN` in `app.php`. Pagine `/account/` e `/privacy/`.
Liste personali di film (`MyMovies.astro`): la scheda "I miei visti" della pagina Film (solo con l'account) e la pagina `/da-vedere/`
(lista `da-vedere`, spunta "Da vedere" nelle righe di Cinema e Film). Leggono `/film/catalogo.json` (`src/pages/film/catalogo.json.ts`):
catalogo `privato/film-visti.json` di `import:trakt` (fuori da git, ignorato oltre 150 giorni) più tutte le schede di `movie-info.json`;
un film è nella lista se è spuntata una qualsiasi delle sue `keys` (tra cui `movie:{idTMDB}`).
Pulsante "Sincronizza con Trakt" in `/account/` (`src/lib/trakt-sync.ts`, solo per l'account `TRAKT_ACCOUNT`, chiavi lette a build time):
legge Trakt dal browser (serve l'origine del sito tra le CORS origins dell'app Trakt) e aggiunge le spunte mancanti; i film nuovi
come `movie:{idTMDB}`, che valgono per la riga in classifica tramite `aliasSeen()` di `src/lib/seen.ts`.
Serie viste: pagina `/serie-tv/viste/` (`MySeries.astro`, `/serie-tv/catalogo.json` da `privato/serie-viste.json` di `import:trakt` più
le schede di `series-info.json`): viste per intero (`serie-viste`) e in corso (`episodi-visti`); il titolo apre `SeriesDialog`, che
riceve le schede del catalogo con l'evento `SERIES_CARDS_EVENT` (`src/lib/dialogs.ts`); gli episodi di queste serie stanno in
`privato/episodi/` (scritti da `import:trakt` con `updateEpisodes()`) e sono pubblicati insieme a quelli di `data/cache/episodes/`. Le liste personali condividono
`src/lib/my-list.ts` (riga, voto, servizi, filtri a scelta multipla).
Ordinamento "Ultimi visti" / "Ultime viste" (solo con l'account): data delle spunte (`quando` nel DB, azione `date-spunte`, `tickDates()`
di `ticks.ts`); "Sincronizza con Trakt" ci mette la data di visione di Trakt (`watchDates()`, `setTickDates()`), le altre restano quella
in cui sono state messe.
Libri letti: spunta "Letto" (lista `letti`, chiave `entryKey` di titolo e primo autore) nella classifica Libri e nelle liste di libri;
pagina `/libri-letti/` (`MyBooks.astro`) con `/libri/catalogo.json`: catalogo `privato/libri-letti.json` di `import:anobii` più i libri
di classifica e liste.
Profili pubblici (facoltativi, con consenso): tabella `profili` (nome pubblico unico, liste mostrate), azioni `profilo`, `pubblici`,
`liste&u=` dell'API; sezione in `/account/` e pagina `/utenti/` che mostra le liste di un profilo con `MyMovies`/`MySeries`/`MyBooks`
in sola lettura (`readonly`, spunte consegnate con `showPublicLists()` di `src/lib/my-list.ts`). I gruppi di liste pubblicabili sono
in due posti da tenere uguali: `PUBLIC_GROUPS` in `app.php` e in `src/lib/profiles.ts`.
Google Analytics 4 (`GA_MEASUREMENT_ID` nel `.env`): solo nella build pubblicata (`SITE_URL`) e solo dopo il consenso nel banner di
`Base.astro` (`src/lib/analytics.ts`, scelta nel localStorage, "Preferenze cookie" nel footer e nella pagina Privacy).
### Aggiornamento automatico su Aruba

Aruba non esegue Node, il suo PHP scrive solo in `mdb-database` (non nella cartella del sito), le regole del `.htaccess` non valgono (IIS)
e l'FTP da GitHub si blocca. Quindi: il cron (`update.yml`) finisce con `scripts/pubblica-aruba.ts`, che confronta la build con le
impronte servite dal server e gli manda a pezzi uno zip dei file cambiati (`scripts/lib/zip.ts`, azioni `sito-*` con intestazione
`X-Chiave`); il server lo estrae in `mdb-database/sito/` e `public/web.config` (URL Rewrite) fa servire quei file da `api/sito.php`.
Mai pubblicati così: `api/`, `.htaccess`, `web.config` e un `catalogo.json` senza il suo file in `privato/` (il workflow rifà quelli di
film e serie con `import:trakt`; i libri letti di aNobii arrivano solo dal PC). `public/api/_inc/aggiornamenti.php`
avvia il workflow con l'API di GitHub (`github_token` in `classifiche-config.php`, `cacert.pem` portato dagli zip) alla prima visita
del giorno (`notifyDailyVisit()` in `src/lib/account.ts`, da `Base.astro`) e dal pulsante in `/account/` per l'amministratore (config
`admin`, flag `admin` nelle risposte con l'utente), che mostra anche il riepilogo dell'ultima pubblicazione (`_riepilogo.json` nello zip,
`scripts/lib/riepilogo.ts`: nuove entrate rispetto al commit `PRIMA` del workflow, fonti non raggiunte, file). `dist:aruba -- --conferma`
svuota `mdb-database/sito/`.

In locale: `npm run api:dev` (PHP su 127.0.0.1:8787) + `npm run dev` (proxy di `/api/`); email in `mdb-database/mail.log`.

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
- Se l'API degli account comincia a trattare dati personali nuovi, va aggiornata l'informativa in `src/pages/privacy.astro`.
