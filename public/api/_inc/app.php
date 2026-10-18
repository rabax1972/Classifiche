<?php
// Funzioni comuni dell'API degli account: configurazione, database SQLite, risposte JSON, sessioni, limiti ai tentativi, posta.
// Incluso solo da api/index.php: aperto direttamente non fa nulla.

if (!defined('CLASSIFICHE_API')) {
    http_response_code(404);
    exit;
}

date_default_timezone_set('Europe/Rome');

const SESSION_COOKIE = 'cl_sessione';
const SESSION_DAYS = 60;
const VERIFY_HOURS = 48;
const RESET_HOURS = 1;
const UNVERIFIED_DAYS = 7;
/** Liste di spunte accettate: film visti, serie viste, episodi visti, titoli posseduti delle liste curate (src/lib/ticks.ts). */
const LIST_PATTERN = '/^(visti|serie-viste|episodi-visti|posseduti:[a-z0-9-]{1,60})$/';
const MAX_KEY_LENGTH = 300;
const MAX_TICKS_PER_USER = 50000;

/**
 * Configurazione: valori predefiniti, sovrascritti dal file facoltativo mdb-database/classifiche-config.php
 * (fuori dal repository, non raggiungibile dal web) che restituisce un array con le stesse chiavi.
 */
function config(): array {
    static $config = null;
    if ($config !== null) return $config;
    // Sul server: /classifiche/api → ../../mdb-database. In locale: public/api → mdb-database del progetto.
    $dir = getenv('CLASSIFICHE_DB_DIR') ?: dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'mdb-database';
    $config = [
        'db_dir' => $dir,
        'mittente' => 'info@giacomorabaglia.com',
        'nome_mittente' => 'Classifiche Italia',
        // 'mail' invia con mail(); 'log' scrive i messaggi in mdb-database/mail.log (sviluppo in locale).
        'posta' => PHP_SAPI === 'cli-server' ? 'log' : 'mail',
        // Chiave per api/index.php?a=backup; vuota = backup disattivato.
        'chiave_backup' => '',
    ];
    $file = $dir . DIRECTORY_SEPARATOR . 'classifiche-config.php';
    if (is_file($file)) $config = array_merge($config, (array)require $file);
    return $config;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = config()['db_dir'];
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) fail(500, 'Archivio non disponibile.');
    $pdo = new PDO('sqlite:' . $dir . DIRECTORY_SEPARATOR . 'classifiche.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    migrate($pdo);
    return $pdo;
}

/** Schema del database, versionato con PRAGMA user_version: per cambiarlo si aggiunge un passo in fondo. */
function migrate(PDO $pdo): void {
    $steps = [
        1 => <<<SQL
            CREATE TABLE utenti (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                hash TEXT NOT NULL,
                verificato INTEGER NOT NULL DEFAULT 0,
                creato INTEGER NOT NULL
            );
            CREATE TABLE sessioni (
                token TEXT PRIMARY KEY,
                utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
                scade INTEGER NOT NULL
            );
            CREATE INDEX sessioni_utente ON sessioni(utente);
            CREATE TABLE token (
                token TEXT PRIMARY KEY,
                utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
                tipo TEXT NOT NULL,
                scade INTEGER NOT NULL
            );
            CREATE INDEX token_utente ON token(utente, tipo);
            CREATE TABLE spunte (
                utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
                lista TEXT NOT NULL,
                chiave TEXT NOT NULL,
                quando INTEGER NOT NULL,
                PRIMARY KEY (utente, lista, chiave)
            ) WITHOUT ROWID;
            CREATE TABLE tentativi (
                chiave TEXT NOT NULL,
                quando INTEGER NOT NULL
            );
            CREATE INDEX tentativi_chiave ON tentativi(chiave, quando);
            SQL,
    ];
    $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    foreach ($steps as $n => $sql) {
        if ($n <= $version) continue;
        $pdo->beginTransaction();
        $pdo->exec($sql);
        $pdo->exec('PRAGMA user_version = ' . $n);
        $pdo->commit();
    }
}

/** Pulizia saltuaria (circa una richiesta su 50): sessioni e token scaduti, tentativi vecchi, account mai confermati. */
function housekeeping(): void {
    if (random_int(1, 50) !== 1) return;
    $now = time();
    $pdo = db();
    $pdo->prepare('DELETE FROM sessioni WHERE scade < ?')->execute([$now]);
    $pdo->prepare('DELETE FROM token WHERE scade < ?')->execute([$now]);
    $pdo->prepare('DELETE FROM tentativi WHERE quando < ?')->execute([$now - 86400]);
    $pdo->prepare('DELETE FROM utenti WHERE verificato = 0 AND creato < ?')->execute([$now - UNVERIFIED_DAYS * 86400]);
}

// --- Richieste e risposte -----------------------------------------------------------------------------------------

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $message, array $extra = []): never {
    respond(['errore' => $message] + $extra, $status);
}

/**
 * Corpo JSON di una richiesta POST. Contro le richieste da altri siti (CSRF): Content-Type JSON obbligatorio
 * (da un altro sito richiede un preflight CORS, che qui non è mai concesso) e Origin, se presente, uguale all'host.
 */
function body(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'Metodo non consentito.');
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail(415, 'Formato non valido.');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && strcasecmp((string)parse_url($origin, PHP_URL_HOST) . port_suffix($origin), $_SERVER['HTTP_HOST'] ?? '') !== 0) {
        fail(403, 'Origine non consentita.');
    }
    $raw = file_get_contents('php://input', false, null, 0, 2_000_000);
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) fail(400, 'Richiesta non valida.');
    return $data;
}

function port_suffix(string $url): string {
    $port = parse_url($url, PHP_URL_PORT);
    return $port ? ':' . $port : '';
}

function str_field(array $data, string $name, int $max = 200): string {
    $v = $data[$name] ?? '';
    if (!is_string($v)) fail(400, 'Richiesta non valida.');
    return mb_substr(trim($v), 0, $max);
}

function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/** Cartella del sito vista dal browser: /classifiche/api/index.php → /classifiche/ (in locale /). */
function base_path(): string {
    $dir = str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')));
    return rtrim($dir, '/') . '/';
}

/** Indirizzo assoluto di una pagina del sito, per i link nelle email. */
function site_url(string $path): string {
    return (is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . base_path() . ltrim($path, '/');
}

function client_ip(): string {
    return $_SERVER['REMOTE_ADDR'] ?? '?';
}

// --- Token, sessioni, utente corrente -----------------------------------------------------------------------------

/** Token casuale da mandare al browser (o nelle email); nel database se ne salva solo l'hash. */
function new_token(): string {
    return bin2hex(random_bytes(32));
}

function token_hash(string $token): string {
    return hash('sha256', $token);
}

function set_session_cookie(string $value, int $expires): void {
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires,
        'path' => base_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function start_session(int $userId): void {
    $token = new_token();
    $expires = time() + SESSION_DAYS * 86400;
    db()->prepare('INSERT INTO sessioni (token, utente, scade) VALUES (?, ?, ?)')->execute([token_hash($token), $userId, $expires]);
    set_session_cookie($token, $expires);
}

function end_session(): void {
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($token) && $token !== '') db()->prepare('DELETE FROM sessioni WHERE token = ?')->execute([token_hash($token)]);
    set_session_cookie('', time() - 3600);
}

/** Utente della sessione corrente, o null. La scadenza si rinnova (al massimo una volta al giorno) a ogni uso. */
function current_user(): ?array {
    static $user = false;
    if ($user !== false) return $user;
    $user = null;
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    $st = db()->prepare('SELECT u.id, u.email, s.scade FROM sessioni s JOIN utenti u ON u.id = s.utente WHERE s.token = ? AND s.scade > ? AND u.verificato = 1');
    $st->execute([token_hash($token), time()]);
    $row = $st->fetch();
    if (!$row) return null;
    $expires = time() + SESSION_DAYS * 86400;
    if ($expires - (int)$row['scade'] > 86400) {
        db()->prepare('UPDATE sessioni SET scade = ? WHERE token = ?')->execute([$expires, token_hash($token)]);
        set_session_cookie($token, $expires);
    }
    return $user = ['id' => (int)$row['id'], 'email' => $row['email']];
}

function require_user(): array {
    return current_user() ?? fail(401, 'Devi accedere al tuo account.');
}

/** Token monouso (conferma email, nuova password): crea, sostituendo quelli precedenti dello stesso tipo. */
function issue_token(int $userId, string $type, int $hours): string {
    $token = new_token();
    $pdo = db();
    $pdo->prepare('DELETE FROM token WHERE utente = ? AND tipo = ?')->execute([$userId, $type]);
    $pdo->prepare('INSERT INTO token (token, utente, tipo, scade) VALUES (?, ?, ?, ?)')->execute([token_hash($token), $userId, $type, time() + $hours * 3600]);
    return $token;
}

/** Consuma un token monouso: restituisce l'id dell'utente o null se non valido o scaduto. */
function consume_token(string $token, string $type): ?int {
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    $pdo = db();
    $st = $pdo->prepare('SELECT utente FROM token WHERE token = ? AND tipo = ? AND scade > ?');
    $st->execute([token_hash($token), $type, time()]);
    $userId = $st->fetchColumn();
    if ($userId === false) return null;
    $pdo->prepare('DELETE FROM token WHERE token = ?')->execute([token_hash($token)]);
    return (int)$userId;
}

// --- Password e limiti ai tentativi -------------------------------------------------------------------------------

function password_algo(): string|int {
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

function check_password_rules(string $password): void {
    $len = mb_strlen($password);
    if ($len < 8) fail(400, 'La password deve avere almeno 8 caratteri.');
    if ($len > 200) fail(400, 'La password è troppo lunga.');
}

function valid_email(string $email): bool {
    return strlen($email) <= 200 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * Limite ai tentativi: al massimo $max azioni con la stessa chiave (es. "accesso:ip:1.2.3.4") negli ultimi $seconds.
 * Ogni chiamata conta come tentativo.
 */
function rate_limit(string $key, int $max, int $seconds): void {
    $pdo = db();
    $st = $pdo->prepare('SELECT COUNT(*) FROM tentativi WHERE chiave = ? AND quando > ?');
    $st->execute([$key, time() - $seconds]);
    if ((int)$st->fetchColumn() >= $max) fail(429, 'Troppi tentativi: riprova tra qualche minuto.');
    $pdo->prepare('INSERT INTO tentativi (chiave, quando) VALUES (?, ?)')->execute([$key, time()]);
}

// --- Posta --------------------------------------------------------------------------------------------------------

function send_mail(string $to, string $subject, string $text): bool {
    $c = config();
    if ($c['posta'] === 'log') {
        $line = sprintf("[%s] A: %s\nOggetto: %s\n%s\n\n", date('c'), $to, $subject, $text);
        return file_put_contents($c['db_dir'] . DIRECTORY_SEPARATOR . 'mail.log', $line, FILE_APPEND | LOCK_EX) !== false;
    }
    ini_set('sendmail_from', $c['mittente']);
    $headers = [
        'From' => mb_encode_mimeheader($c['nome_mittente'], 'UTF-8') . ' <' . $c['mittente'] . '>',
        'Reply-To' => $c['mittente'],
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => '8bit',
    ];
    return mail($to, mb_encode_mimeheader($subject, 'UTF-8'), str_replace("\n", "\r\n", $text), $headers);
}

function mail_footer(): string {
    return "\n\n--\nClassifiche Italia\n" . site_url('') . "\nHai ricevuto questa email perché il tuo indirizzo è stato inserito sul sito. Se non l'hai fatto tu, ignorala.";
}
