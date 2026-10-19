<?php
// Aggiornamento automatico del sito su Aruba. Il PHP non può scrivere nella cartella del sito, quindi i file aggiornati stanno in
// mdb-database/sito/ e web.config li fa servire da api/sito.php al posto di quelli statici.
//
// - Il workflow di GitHub (scripts/pubblica-aruba.ts) chiede le impronte dei file pubblicati (?a=sito-impronte), manda a pezzi uno
//   zip con quelli cambiati (?a=sito-carica) e il server lo estrae in mdb-database/sito/.
// - La prima visita del giorno (?a=visita) e il pulsante dell'amministratore in /account/ (?a=aggiornamento) avviano il workflow
//   con l'API di GitHub (github_token in classifiche-config.php).
// - Dopo una distribuzione manuale con FileZilla (npm run dist:aruba -- --conferma) la cartella si svuota (?a=sito-svuota).
// Incluso da api/index.php e api/sito.php: aperto direttamente non fa nulla.

if (!defined('CLASSIFICHE_API')) {
    http_response_code(404);
    exit;
}

/** Tipi di file del sito che si possono aggiornare (niente PHP né configurazione del server). */
const SITE_FILE_TYPES = [
    'html' => 'text/html; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'svg' => 'image/svg+xml',
    'txt' => 'text/plain; charset=utf-8',
    'xml' => 'application/xml; charset=utf-8',
    'webmanifest' => 'application/manifest+json',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'avif' => 'image/avif',
    'gif' => 'image/gif',
    'ico' => 'image/x-icon',
    'woff2' => 'font/woff2',
];
/** Dimensione massima di un pezzo dello zip (sotto il post_max_size di PHP). */
const UPLOAD_PART_BYTES = 4 * 1024 * 1024;
/** Dopo un avvio senza pubblicazione (workflow fallito o ancora in corso) la visita successiva riprova solo dopo queste ore. */
const UPDATE_RETRY_HOURS = 3;

function overlay_dir(): string {
    return config()['db_dir'] . DIRECTORY_SEPARATOR . 'sito';
}

/** Percorso relativo di un file del sito ("film/settimana/index.html"): niente risalite, niente api/, solo i tipi ammessi. */
function valid_site_path(string $path): bool {
    if ($path === '' || strlen($path) > 300 || preg_match('/[\\\\:\0]/', $path) || str_starts_with($path, 'api/')) return false;
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.' || $part === '..') return false;
    }
    return isset(SITE_FILE_TYPES[strtolower(pathinfo($path, PATHINFO_EXTENSION))]);
}

function is_admin(?array $user): bool {
    $admin = config()['admin'];
    return $user !== null && $admin !== '' && strcasecmp($user['email'], $admin) === 0;
}

function require_admin(): array {
    $user = require_user();
    if (!is_admin($user)) fail(403, 'Operazione riservata all\'amministratore.');
    return $user;
}

/** Chiamate del workflow di pubblicazione: chiave nell'intestazione X-Chiave (chiave_pubblicazione in classifiche-config.php). */
function require_publish_key(): void {
    $key = config()['chiave_pubblicazione'];
    $given = $_SERVER['HTTP_X_CHIAVE'] ?? '';
    if ($key === '' || !is_string($given) || !hash_equals($key, $given)) fail(404, 'Non trovato.');
}

// --- Stato dell'aggiornamento (mdb-database/aggiornamento.json) ---------------------------------------------------

function update_state(): array {
    $raw = @file_get_contents(config()['db_dir'] . DIRECTORY_SEPARATOR . 'aggiornamento.json');
    $state = $raw ? json_decode($raw, true) : null;
    return is_array($state) ? $state : [];
}

function record_update(array $changes): void {
    $state = array_merge(update_state(), $changes);
    file_put_contents(config()['db_dir'] . DIRECTORY_SEPARATOR . 'aggiornamento.json', json_encode($state, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

// --- Avvio del workflow su GitHub ---------------------------------------------------------------------------------

/** Richiesta all'API di GitHub per il repository configurato: [stato HTTP, corpo JSON decodificato]. */
function github_request(string $method, string $path, ?array $body = null): array {
    $c = config();
    if ($c['github_token'] === '') throw new RuntimeException('Aggiornamento non configurato: manca github_token in classifiche-config.php.');
    $ch = curl_init('https://api.github.com/repos/' . $c['github_repo'] . $path);
    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => 'Classifiche-Italia',
        CURLOPT_HTTPHEADER => [
            'Accept: application/vnd.github+json',
            'Authorization: Bearer ' . $c['github_token'],
            'X-GitHub-Api-Version: 2022-11-28',
            'Content-Type: application/json',
        ],
    ];
    // Il PHP di Aruba non ha i certificati delle autorità: arrivano con gli aggiornamenti (_cacert.pem nello zip).
    $ca = $c['db_dir'] . DIRECTORY_SEPARATOR . 'cacert.pem';
    if (is_file($ca)) $options[CURLOPT_CAINFO] = $ca;
    if ($body !== null) $options[CURLOPT_POSTFIELDS] = json_encode($body);
    curl_setopt_array($ch, $options);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($raw === false) throw new RuntimeException("GitHub non raggiungibile: $error");
    return [$status, json_decode($raw ?: 'null', true)];
}

/** Avvia il workflow di aggiornamento; $motivo: "visita" o "admin". */
function start_update(string $motivo): void {
    record_update(['avviato' => time(), 'motivo' => $motivo, 'errore' => '']);
    try {
        [$status, $data] = github_request('POST', '/actions/workflows/' . config()['github_workflow'] . '/dispatches', ['ref' => 'main']);
        if ($status !== 204) throw new RuntimeException("GitHub ha risposto $status" . (isset($data['message']) ? ': ' . $data['message'] : '.'));
    } catch (RuntimeException $e) {
        record_update(['errore' => $e->getMessage()]);
        throw $e;
    }
}

/**
 * Prima visita del giorno: se oggi il sito non è ancora stato aggiornato (né c'è un avvio recente), avvia il workflow.
 * Il lucchetto evita che due visite contemporanee lo avviino due volte.
 */
function start_daily_update(): bool {
    if (config()['github_token'] === '') return false;
    $lock = fopen(config()['db_dir'] . DIRECTORY_SEPARATOR . 'aggiornamento.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return false;
    try {
        $state = update_state();
        if (date('Y-m-d', (int)($state['pubblicato'] ?? 0)) === date('Y-m-d')) return false;
        if ((int)($state['avviato'] ?? 0) > time() - UPDATE_RETRY_HOURS * 3600) return false;
        start_update('visita');
        return true;
    } catch (RuntimeException) {
        return false;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** Stato per il riquadro dell'amministratore: ultimo avvio e ultima pubblicazione, più l'ultima esecuzione del workflow su GitHub. */
function update_status(): array {
    $state = update_state();
    $status = [
        'configurato' => config()['github_token'] !== '',
        'avviato' => $state['avviato'] ?? null,
        'motivo' => $state['motivo'] ?? null,
        'pubblicato' => $state['pubblicato'] ?? null,
        'file' => $state['file'] ?? null,
        'errore' => $state['errore'] ?? '',
        'workflow' => null,
    ];
    if ($status['configurato']) {
        try {
            [$code, $data] = github_request('GET', '/actions/workflows/' . config()['github_workflow'] . '/runs?per_page=1');
            $run = $data['workflow_runs'][0] ?? null;
            if ($code !== 200) {
                $status['errore'] = $status['errore'] ?: "GitHub ha risposto $code" . (isset($data['message']) ? ': ' . $data['message'] : '.');
            } elseif (is_array($run)) {
                $status['workflow'] = [
                    'stato' => $run['status'] ?? '',
                    'esito' => $run['conclusion'] ?? null,
                    'quando' => strtotime($run['run_started_at'] ?? $run['created_at'] ?? '') ?: null,
                    'link' => $run['html_url'] ?? '',
                ];
            }
        } catch (RuntimeException $e) {
            $status['errore'] = $status['errore'] ?: $e->getMessage();
        }
    }
    return $status;
}

// --- Pubblicazione dei file aggiornati ----------------------------------------------------------------------------

/** Impronte (sha1) dei file che il sito serve adesso: quelli statici della cartella, sostituiti da quelli aggiornati. */
function site_fingerprints(): array {
    $files = [];
    foreach ([dirname(__DIR__, 2), overlay_dir()] as $base) {
        if (!is_dir($base)) continue;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if (!$file->isFile()) continue;
            $rel = str_replace('\\', '/', substr($file->getPathname(), strlen($base) + 1));
            if (valid_site_path($rel)) $files[$rel] = sha1_file($file->getPathname());
        }
    }
    return $files;
}

/**
 * Riceve un pezzo dello zip (corpo della richiesta). Con l'ultimo li unisce, controlla l'impronta sha256 ($id) ed estrae i file
 * in mdb-database/sito/.
 */
function receive_upload(string $id, int $part, int $parts): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $id) || $parts < 1 || $parts > 500 || $part < 1 || $part > $parts) fail(400, 'Richiesta non valida.');
    $dir = config()['db_dir'] . DIRECTORY_SEPARATOR . 'arrivo';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    // Pezzi rimasti da caricamenti interrotti.
    foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $old) {
        if (!str_starts_with(basename($old), $id) && filemtime($old) < time() - 3600) @unlink($old);
    }
    $data = file_get_contents('php://input', false, null, 0, UPLOAD_PART_BYTES + 1);
    if (!is_string($data) || $data === '' || strlen($data) > UPLOAD_PART_BYTES) fail(413, 'Pezzo vuoto o troppo grande.');
    $piece = fn(int $n) => $dir . DIRECTORY_SEPARATOR . "$id.$n";
    file_put_contents($piece($part), $data, LOCK_EX);
    if ($part < $parts) respond(['ricevuto' => $part]);

    $zipFile = $dir . DIRECTORY_SEPARATOR . "$id.zip";
    $out = fopen($zipFile, 'wb');
    for ($n = 1; $n <= $parts; $n++) {
        $in = @fopen($piece($n), 'rb');
        if (!$in) {
            fclose($out);
            @unlink($zipFile);
            fail(400, "Manca il pezzo $n dello zip.");
        }
        stream_copy_to_stream($in, $out);
        fclose($in);
    }
    fclose($out);
    for ($n = 1; $n <= $parts; $n++) @unlink($piece($n));
    if (hash_file('sha256', $zipFile) !== $id) {
        @unlink($zipFile);
        fail(400, 'Zip danneggiato durante il trasferimento.');
    }
    try {
        $count = extract_update($zipFile);
    } finally {
        @unlink($zipFile);
    }
    record_update(['pubblicato' => time(), 'file' => $count, 'errore' => '']);
    return ['ok' => true, 'file' => $count];
}

/** Estrae lo zip nella cartella dei file aggiornati; _cacert.pem (certificati per le richieste a GitHub) va in mdb-database. */
function extract_update(string $zipFile): int {
    @set_time_limit(300);
    ignore_user_abort(true);
    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) fail(400, 'Zip non leggibile.');
    $count = 0;
    try {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string)$zip->getNameIndex($i);
            if ($name === '_cacert.pem') {
                $target = config()['db_dir'] . DIRECTORY_SEPARATOR . 'cacert.pem';
            } elseif (valid_site_path($name)) {
                $target = overlay_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $name);
                $count++;
            } else {
                continue;
            }
            if (!is_dir(dirname($target))) mkdir(dirname($target), 0700, true);
            // Prima in un file temporaneo e poi al suo posto: chi apre la pagina in quel momento non la vede mai a metà.
            $tmp = $target . '.tmp';
            $in = $zip->getStream($name);
            $out = fopen($tmp, 'wb');
            if (!$in || !$out) throw new RuntimeException("Non riesco a estrarre $name.");
            stream_copy_to_stream($in, $out);
            fclose($in);
            fclose($out);
            if (!@rename($tmp, $target)) {
                copy($tmp, $target);
                @unlink($tmp);
            }
        }
    } finally {
        $zip->close();
    }
    return $count;
}

/** Svuota la cartella dei file aggiornati (dopo una distribuzione manuale completa): restituisce quanti file ha eliminato. */
function clear_overlay(): int {
    $dir = overlay_dir();
    if (!is_dir($dir)) return 0;
    $count = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $file) {
        if ($file->isDir()) {
            @rmdir($file->getPathname());
        } elseif (@unlink($file->getPathname())) {
            $count++;
        }
    }
    @rmdir($dir);
    return $count;
}
