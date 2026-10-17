# Classifiche Italia

Sito statico che raccoglie le classifiche italiane più popolari in 5 categorie: **Canzoni, Libri, Cinema, Film, Serie TV**.
Per ognuna mostra i periodi **Oggi, Settimana, Mese, Anno**. Usa solo fonti gratuite e il cron di GitHub Actions: niente backend, niente costi.

- **Stack**: Astro + TypeScript + Tailwind CSS, output completamente statico.
- **Dati**: file JSON in [`data/`](data/), generati ogni giorno dagli script in [`scripts/`](scripts/) e committati nel repository.
- **Uso**: solo non commerciale. È una condizione dei termini d'uso di TMDB e Last.fm, quindi niente pubblicità né abbonamenti.

## Fonti

| Categoria | Oggi / Settimana / Mese | Ufficiale | Chiave |
|---|---|---|---|
| Canzoni | Apple Music "Top brani" Italia (RSS). Riserva: Last.fm `geo.getTopTracks` | Anno: Top Singoli FIMI, da Wikipedia | Last.fm (facoltativa) |
| Libri | Apple Books, ebook a pagamento più venduti in Italia (RSS) | — | — |
| Cinema | TMDB `movie/now_playing` (region IT), ordinati per popolarità | — | TMDB |
| Film | TMDB `discover/movie` disponibili in abbonamento in Italia. Riserva: TMDB trending | Settimana: Netflix Top 10 Italia | TMDB |
| Serie TV | TMDB `discover/tv` disponibili in abbonamento in Italia. Riserva: TMDB trending | Settimana: Netflix Top 10 Italia | TMDB |

**I 100 dischi da avere assolutamente** (pagina `/album-da-avere/`): lista statica in [`data/curated/album-da-avere.json`](data/curated/album-da-avere.json), con la top 100 dei 500 migliori album di Rolling Stone (2003) ripresa da [Il Rocker](https://ilrockerofficial.weebly.com/il-rocker-classifica-100-album-rock-di-sempre.html). Le descrizioni sono originali. Le copertine si completano a mano con `npm run covers:album`: prima l'API di ricerca iTunes (discografia dell'artista, poi ricerca testuale), in mancanza Cover Art Archive (MusicBrainz). Nella stessa pagina si può passare alla seconda lista, **I 100 migliori album di sempre secondo Consequence** (`/album-da-avere/consequence/`, 2024, ripresa da [OndaRock](https://www.ondarock.it/news/migliori-album-rock-sempre-consequence-magazine/)), con le spunte condivise come per i libri. Ogni album ha la tracklist, completata con `npm run tracks:album`: brani da Apple Music (edizione standard se l'album abbinato è deluxe), con il link a ogni brano; per gli album assenti da Apple Music, da MusicBrainz. I link a Spotify sono ricerche: l'API di Spotify richiede una chiave.

**I 100 libri da avere assolutamente** (pagina `/libri-da-avere/`): lista statica in [`data/curated/libri-da-avere.json`](data/curated/libri-da-avere.json), la versione italiana della lista virale «i cento libri secondo la BBC» pubblicata da [La lettrice controcorrente](https://www.lalettricecontrocorrente.it/pensieri-in-liberta/i-cento-libri-da-leggere-secondo-la-bbc/). Non è il sondaggio The Big Read della BBC. Le descrizioni sono originali. Nella stessa pagina si può passare alla seconda lista, **I 100 libri del secolo secondo Le Monde** (`/libri-da-avere/le-monde/`, dati da [Wikipedia](https://it.wikipedia.org/wiki/I_100_libri_del_secolo_di_le_Monde), CC BY-SA). Le due liste formano un gruppo (campo `group` nel JSON): stessa voce di menu, selettore in alto e spunte "Ce l'ho" condivise. Le copertine di entrambe si completano con `npm run covers:libri`: prima Apple Books Italia (edizione italiana), poi Open Library, infine Apple Books Francia e USA con il titolo originale; con `coverCountry` si può far partire la ricerca da un altro catalogo.

**Fonti valutate e scartate** (verifica di ottobre 2026):
- **IBS e Libraccio**: le condizioni d'uso (art. 3.2) vietano qualsiasi estrazione automatica.
- **Mondadori Store**: escluso per prudenza.
- **Box Office Mojo**: il robots.txt vieta lo scraping.
- **Cinetel**: nessuna API pubblica.
- **Deezer**: le classifiche via API sono geolocalizzate; dai server di GitHub restituirebbero dati non italiani.
- **Sito FIMI**: nessuna condizione d'uso pubblicata; usiamo i dati FIMI riportati da Wikipedia.

### Limiti da conoscere

- **Libri**: non esistono classifiche librarie italiane gratuite e riutilizzabili. La classifica riflette solo gli ebook di Apple Books.
- **Cinema**: è la popolarità su TMDB dei film in sala, **non** gli incassi.
- **TMDB**: i termini consentono di conservare i dati per massimo 6 mesi. Le conseguenze:
  - gli snapshot TMDB più vecchi di 180 giorni vengono cancellati automaticamente;
  - l'"Anno" calcolato per Cinema, Film e Serie TV copre quindi gli ultimi 180 giorni;
  - anche le cache di registi e copertine scadono dopo 150 giorni.
- **Netflix**: il robots.txt di netflix.com blocca i crawler generici. Il file TSV della Top 10 è però pubblicato da Netflix appositamente per il download. Lo scarichiamo al massimo una volta al giorno, e solo quando manca la settimana più recente.

## Setup

Requisiti: Node.js ≥ 22.12.

```bash
npm install
cp .env.example .env       # poi inserisci le chiavi (vedi sotto)
npm run seed               # prima raccolta + storico + generazione classifiche
npm run dev                # http://localhost:4321
```

| Comando | Cosa fa |
|---|---|
| `npm run ingest` | Raccoglie le classifiche di oggi da tutte le fonti |
| `npm run aggregate` | Ricalcola `data/charts/` dagli snapshot e dalle classifiche ufficiali |
| `npm run update` | `ingest` + `aggregate` + schede delle modali (`info:canzoni`, `info:libri`, `info:film`, `info:serie`): quello che fa il cron |
| `npm run seed` | Come `update`, più lo storico: Netflix degli ultimi 2 anni e FIMI degli ultimi 5 anni |
| `npm run info:canzoni` | Completa le schede di brani e artisti (`-- --all` senza limite di richieste) |
| `npm run info:libri` | Completa le schede di libri e autori e le edizioni gratuite dei libri di pubblico dominio (`-- --all` senza limite) |
| `npm run info:film` | Completa le schede di film e registi di Cinema e Film (`-- --all` senza limite; richiede la chiave TMDB) |
| `npm run info:serie` | Completa le schede di serie e creatori di Serie TV (`-- --all` senza limite; richiede la chiave TMDB) |
| `npm run covers:album` | Completa le copertine mancanti delle liste di album (`-- --force` per rifarle tutte) |
| `npm run tracks:album` | Completa le tracklist mancanti delle liste di album (`-- --force` per rifarle tutte) |
| `npm run covers:libri` | Completa le copertine mancanti delle liste di libri (`-- --force` per rifarle tutte) |
| `npm test` | Test di aggregazione, adapter e conservazione dati |
| `npm run build` | Sito statico in `dist/` |

Senza chiavi il sito funziona lo stesso: Canzoni, Libri e Netflix non le richiedono. Le fonti senza chiave vengono saltate e la loro categoria mostra lo stato vuoto.

### Ottenere le chiavi gratuite

- **TMDB** (necessaria per Cinema, Film, Serie TV e per le copertine Netflix):
  1. Crea un account su [themoviedb.org](https://www.themoviedb.org/signup).
  2. Vai in *Impostazioni → API* ([link](https://www.themoviedb.org/settings/api)) e richiedi una chiave di tipo *Developer*, indicando un uso personale/non commerciale.
  3. Copia l'**API Read Access Token** in `TMDB_READ_TOKEN`, oppure l'**API Key** in `TMDB_API_KEY`.
- **Last.fm** (facoltativa, fonte di riserva per le Canzoni): crea un'applicazione su [last.fm/api/account/create](https://www.last.fm/api/account/create) e copia la *API key* in `LASTFM_API_KEY`.
- **`CLASSIFICHE_CONTACT`**: l'URL del repository o un'email. Viene inserito nello User-Agent, come richiede la policy delle API di Wikipedia. In GitHub Actions è impostato automaticamente.

Le chiavi non vanno mai committate: `.env` è in `.gitignore`. In GitHub vanno messe nei *secrets*.

## Come funziona

```
scripts/adapters/*  ──fetch──▶  data/snapshots/{categoria}/{YYYY-MM-DD}.json   (una lista per fonte, ogni giorno)
                    ──fetch──▶  data/official/{categoria}/{week|year}/{chiave}.json
                                data/cache/*.json   (registi, copertine: metadati con scadenza)
                                data/status.json    (esito dell'ultima raccolta per fonte)

scripts/aggregate.ts ─────────▶  data/charts/{categoria}/{oggi|settimana|mese|anno}.json  ──▶  pagine Astro
```

Ogni riga di classifica ha lo stesso schema ([`src/lib/types.ts`](src/lib/types.ts)):
`{ rank, title, subtitle, cover, source, sourceUrl, externalId }`.

### Le classifiche per periodo

Le funzioni sono pure e testate, in [`src/lib/aggregate.ts`](src/lib/aggregate.ts) e [`src/lib/build.ts`](src/lib/build.ts).

- **Oggi**: l'ultimo snapshot disponibile, con la variazione rispetto allo snapshot precedente.
- **Settimana / Mese / Anno** ("Calcolata da snapshot"): finestre mobili di 7, 30 e 365 giorni che terminano all'ultimo snapshot.
  - **Punteggio Borda**: ogni giorno il 1° posto vale 100 punti, il 2° 99, … il 100° 1.
  - **Ordinamento**: punti totali, poi posizione migliore, poi giorni in classifica.
  - **Variazione**: confronto con la finestra precedente della stessa durata.
  - **Giorni mancanti**: vengono saltati. La pagina indica su quanti giorni di dati è calcolata la classifica.
- **Ufficiale**: se la categoria ha una classifica ufficiale per il periodo (Netflix settimanale, FIMI annuale), viene mostrata per prima, con l'etichetta "Ufficiale" e una scheda per passare a quella calcolata.
- **Identità degli elementi**: titolo e primo artista/autore normalizzati (minuscole, senza accenti, senza "feat."). Così lo stesso brano viene riconosciuto tra giorni e fonti diverse.
- **Fallback**: ogni categoria ha un elenco di fonti in ordine di priorità.
  - Se la fonte principale fallisce, nello snapshot del giorno vale la successiva.
  - Se falliscono tutte, non viene scritto nessuno snapshot: il sito continua a mostrare l'ultimo valido, con un avviso e la data.

### Schede in modale

Cliccando su un titolo o su un nome si apre una scheda. Le schede si possono linkare direttamente con l'ancora (`#brano=…`, `#artista=…`, `#libro=…`, `#autore=…`, `#film=…`, `#regista=…`, `#serie=…`, `#creatore=…`).

| Pagine | Clic sul titolo | Clic sul nome |
|---|---|---|
| Canzoni | Brano: album, uscita, genere, durata (Apple Music), introduzione di Wikipedia; per il testo, link a Genius | Artista |
| Libri e liste di libri | Libro: genere, uscita, presentazione dell'editore (Apple Books) o introduzione di Wikipedia; link per scaricare i libri di pubblico dominio (Liber Liber, Wikisource) | Autore |
| Cinema e Film | Film: trama, generi, durata, uscita in Italia, voto, interpreti, trailer (TMDB); dove vederlo in Italia (JustWatch via TMDB) | Regista, con i film diretti (TMDB) |
| Serie TV | Serie: trama, generi, stagioni ed episodi, anni, stato, reti, prossimo episodio, voto, interpreti, trailer (TMDB); dove vederla in Italia (JustWatch via TMDB) | Creatore, con le serie create (TMDB) |

Le schede delle persone usano l'introduzione della voce di Wikipedia (in italiano o in inglese, CC BY-SA 4.0) e, se c'è, una foto con licenza libera da Wikimedia Commons, con autore e licenza indicati. Per registi e creatori senza voce o senza foto si usano la biografia e la foto di TMDB.

Con gli stessi dati, le classifiche Cinema e Film si possono filtrare per servizi in abbonamento (con i loghi; il filtro compare solo se almeno 5 film ne hanno uno) e generi, anche più di uno alla volta (basta che il film ne abbia uno), e per durata e voto TMDB minimo. Serie TV ha gli stessi filtri, con numero di stagioni e stato (in corso o conclusa) al posto della durata. Il filtro è lato client: senza JavaScript la tabella resta completa.

Come le spunte "Ce l'ho" delle liste curate, ogni film di Cinema e Film si può segnare come "Visto", dalla classifica o dalla scheda del film (`src/lib/seen.ts`): la spunta resta salvata solo nel browser (localStorage, chiave `entryKey`), vale per entrambe le classifiche e per tutti i periodi, e un filtro mostra solo i film da vedere o quelli già visti. Allo stesso modo ogni serie si può segnare come "Vista", con una lista separata: la chiave è l'ID TMDB, così la spunta vale per tutte le stagioni della Top 10 Netflix e per le classifiche TMDB.

I dati sono raccolti dagli script `scripts/*-info.ts` in `data/cache/*-info.json`. Ogni run completa un numero limitato di schede. Le schede con dati TMDB scadono dopo 150 giorni e vengono rifatte.

### Il cron (GitHub Actions)

[`.github/workflows/update.yml`](.github/workflows/update.yml) parte ogni giorno alle 04:15 UTC (06:15 in Italia con l'ora legale). Esegue:
1. `npm run update`
2. `npm test`
3. il commit di `data/`, se qualcosa è cambiato

Lo si può anche avviare a mano da *Actions → Aggiorna classifiche → Run workflow*. Spuntando **seed**, la prima volta recupera anche lo storico.

Configurazione del repository:
1. *Settings → Secrets and variables → Actions → Secrets*: aggiungi `TMDB_READ_TOKEN` (o `TMDB_API_KEY`) e, se vuoi, `LASTFM_API_KEY`.
2. *Settings → Actions → General → Workflow permissions*: seleziona **Read and write**, così il workflow può fare il commit dei dati.

## Deploy

Il sito è pubblicato su Aruba: **https://www.giacomorabaglia.com/classifiche/**. Il caricamento si fa a mano con FileZilla.

1. Lancia [`distribuzione-aruba.cmd`](distribuzione-aruba.cmd) (doppio clic). Lo script:
   - scarica da GitHub i dati aggiornati dal cron giornaliero (`git pull`);
   - fa la build per l'indirizzo pubblico (`npm run dist:aruba`, [`scripts/dist-aruba.ts`](scripts/dist-aruba.ts));
   - mette il risultato in `aruba/classifiche/` (cartella esclusa da git) e la apre.

   Con `distribuzione-aruba.cmd --update` aggiorna prima anche i dati in locale, come il cron (servono le chiavi nel `.env`).
2. Con FileZilla carica tutto il contenuto di `aruba/classifiche/` nella cartella `/classifiche` del dominio, sovrascrivendo i file esistenti.
   Includi il file nascosto `.htaccess` (in FileZilla: *Server → Forza la visualizzazione dei file nascosti*).

[`public/.htaccess`](public/.htaccess) configura Apache per la cartella `/classifiche`: pagina 404, redirect su HTTPS, barra finale sulle cartelle, compressione e cache.
Se il sito cambia cartella, vanno aggiornati `BASE_PATH` in `scripts/dist-aruba.ts` e i percorsi in `.htaccess`.

I file CSS e JS hanno l'hash nel nome: quelli vecchi rimasti sul server non danno fastidio, ma ogni tanto si può svuotare `/classifiche/_astro/` prima del caricamento.

## Aggiungere una nuova fonte

1. Verifica che sia gratuita e lecita: termini d'uso, robots.txt, limiti di richieste.
2. Registra la fonte in [`src/lib/sources.ts`](src/lib/sources.ts), dentro `SOURCES`, con:
   - `id`, `name`, `homepage`;
   - `attribution`, il testo che i termini chiedono di mostrare;
   - `retentionDays`, se i termini limitano la conservazione dei dati.
3. Crea l'adapter in `scripts/adapters/` implementando `SourceAdapter` ([`scripts/adapters/types.ts`](scripts/adapters/types.ts)):

   ```ts
   export const miaFonte: SourceAdapter = {
     id: 'mia-fonte',
     requiredEnv: [['MIA_FONTE_KEY']],            // facoltativo
     dailyCategories: ['libri'],
     async fetchDaily(category, ctx) {
       const json = await fetchJson<MiaRisposta>('https://…');   // retry, timeout e rate limit inclusi
       return cleanEntries(json.items.map((x, i) => ({
         rank: i + 1, title: x.title, subtitle: x.author, cover: x.image,
         source: 'mia-fonte', sourceUrl: x.url, externalId: x.id,
       })));
     },
     // oppure/inoltre: async fetchOfficial(ctx) { return [/* OfficialChart */]; }
   };
   ```

   L'adapter deve **lanciare un errore** se la fonte non risponde o se i dati non sono validi. `cleanEntries` lo fa già per le liste vuote. L'errore viene registrato in `data/status.json` e le altre fonti proseguono.
4. Aggiungi l'adapter a `ADAPTERS` in [`scripts/adapters/index.ts`](scripts/adapters/index.ts).
5. In `CATEGORIES` aggiungi l'id a `snapshotSources` della categoria, nell'ordine di priorità voluto. Se è una classifica ufficiale, aggiungilo invece a `officialFor`.
6. Se serve un limite di richieste specifico, aggiungi l'host a `HOST_INTERVAL` in [`scripts/lib/http.ts`](scripts/lib/http.ts).
7. Scrivi un test del parser con una risposta d'esempio, come in [`tests/adapters.test.ts`](tests/adapters.test.ts). Infine aggiungi l'attribuzione nel footer, se i termini la richiedono.

## Attribuzioni

This product uses the TMDB API but is not endorsed or certified by TMDB.

Dati di ascolto: Last.fm. Classifiche: Apple Music, Apple Books, Netflix Top 10. Classifiche FIMI tratte da Wikipedia (CC BY-SA 4.0).

Schede: introduzioni e biografie da Wikipedia (CC BY-SA 4.0), foto da Wikimedia Commons con autore e licenza, presentazioni degli editori da Apple Books, trame e dati di film e serie da TMDB, disponibilità in streaming da JustWatch.

I testi delle canzoni non vengono riprodotti: la scheda del brano rimanda a Genius.
