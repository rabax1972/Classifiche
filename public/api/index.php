<?php
// API degli account di Classifiche Italia: registrazione con conferma email, accesso, recupero password e spunte
// (film visti e da vedere, serie viste, libri letti, titoli posseduti) salvate in SQLite. Il sito statico la chiama da src/lib/account.ts.
//
//   GET  ?a=stato                      utente collegato (o null)
//   POST ?a=registrazione              {email, password}       manda l'email di conferma
//   POST ?a=reinvio                    {email}                 rimanda l'email di conferma
//   POST ?a=conferma                   {token}                 conferma l'indirizzo e apre la sessione
//   POST ?a=accesso                    {email, password}
//   POST ?a=uscita
//   POST ?a=recupero                   {email}                 manda il link per una nuova password
//   POST ?a=nuova-password             {token, password}
//   POST ?a=cambio-password            {attuale, nuova}
//   POST ?a=elimina                    {password}              cancella l'account e tutte le spunte
//   GET  ?a=spunte                     tutte le spunte dell'utente
//   POST ?a=spunte                     {modifiche?: [{lista, chiave, on}], unisci?: {lista: [chiavi]}}
//   GET  ?a=profilo                    profilo pubblico dell'utente (nome e liste pubbliche)
//   POST ?a=profilo                    {nome, liste: [gruppi]}  o  {elimina: true}
//   GET  ?a=pubblici                   profili pubblici, con le liste che mostrano
//   GET  ?a=liste&u=nome               liste pubbliche di un profilo
//   GET  ?a=backup&k=…                 copia coerente del database in mdb-database (chiave in classifiche-config.php)
//
// Aggiornamento automatico del sito (_inc/aggiornamenti.php):
//   POST ?a=visita                     prima visita del giorno da un browser: avvia l'aggiornamento se oggi non è ancora stato fatto
//   GET  ?a=aggiornamento              stato dell'aggiornamento (solo amministratore)
//   POST ?a=aggiornamento              {}  avvia subito l'aggiornamento (solo amministratore)
//   GET  ?a=sito-impronte              impronte dei file pubblicati           ┐
//   POST ?a=sito-carica&id=&parte=&parti=   un pezzo dello zip dei file nuovi  ├ workflow di pubblicazione, intestazione X-Chiave
//   POST ?a=sito-svuota                dopo una distribuzione manuale          ┘

define('CLASSIFICHE_API', true);
require __DIR__ . '/_inc/app.php';
require __DIR__ . '/_inc/aggiornamenti.php';

set_exception_handler(function (Throwable $e) {
    error_log('Classifiche API: ' . $e->getMessage());
    fail(500, 'Errore del server: riprova più tardi.');
});

$action = is_string($_GET['a'] ?? null) ? $_GET['a'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
housekeeping();

const SENT = "Se l'indirizzo è corretto riceverai a breve un'email: controlla anche la cartella dello spam.";

switch ("$method $action") {
    case 'GET stato':
        $user = current_user();
        respond(['utente' => $user ? ['email' => $user['email'], 'admin' => is_admin($user)] : null]);

    case 'POST registrazione': {
        $data = body();
        $email = str_field($data, 'email');
        $password = $data['password'] ?? '';
        if (!is_string($password)) fail(400, 'Richiesta non valida.');
        if (!valid_email($email)) fail(400, "L'indirizzo email non è valido.");
        check_password_rules($password);
        rate_limit('registrazione:ip:' . client_ip(), 5, 3600);
        $pdo = db();
        $st = $pdo->prepare('SELECT id, verificato FROM utenti WHERE email = ?');
        $st->execute([$email]);
        $existing = $st->fetch();
        // Stessa risposta in ogni caso, per non rivelare quali indirizzi sono registrati.
        if (!$existing) {
            $pdo->prepare('INSERT INTO utenti (email, hash, creato) VALUES (?, ?, ?)')
                ->execute([$email, password_hash($password, password_algo()), time()]);
            send_verification((int)$pdo->lastInsertId(), $email);
        } elseif ($existing['verificato']) {
            send_mail($email, 'Hai già un account su Classifiche Italia',
                "Qualcuno ha provato a registrare di nuovo questo indirizzo su Classifiche Italia, ma l'account esiste già.\n\n"
                . "Per entrare: " . site_url('account/') . "\nSe non ricordi la password puoi sceglierne una nuova dalla stessa pagina." . mail_footer());
        } else {
            // Account in attesa di conferma: si rimanda il link senza cambiare la password scelta la prima volta.
            send_verification((int)$existing['id'], $email);
        }
        respond(['ok' => true, 'messaggio' => SENT]);
    }

    case 'POST reinvio': {
        $email = str_field(body(), 'email');
        if (!valid_email($email)) fail(400, "L'indirizzo email non è valido.");
        rate_limit('reinvio:ip:' . client_ip(), 5, 3600);
        rate_limit('reinvio:email:' . mb_strtolower($email), 3, 3600);
        $st = db()->prepare('SELECT id FROM utenti WHERE email = ? AND verificato = 0');
        $st->execute([$email]);
        $id = $st->fetchColumn();
        if ($id !== false) send_verification((int)$id, $email);
        respond(['ok' => true, 'messaggio' => SENT]);
    }

    case 'POST conferma': {
        rate_limit('token:ip:' . client_ip(), 20, 900);
        $userId = consume_token(str_field(body(), 'token', 100), 'conferma');
        if ($userId === null) fail(400, 'Il link di conferma non è valido o è scaduto. Prova ad accedere: potrai farti mandare un nuovo link.');
        db()->prepare('UPDATE utenti SET verificato = 1 WHERE id = ?')->execute([$userId]);
        start_session($userId);
        $email = user_email($userId);
        respond(['utente' => ['email' => $email, 'admin' => is_admin(['email' => $email])]]);
    }

    case 'POST accesso': {
        $data = body();
        $email = str_field($data, 'email');
        $password = $data['password'] ?? '';
        if (!is_string($password) || $email === '') fail(400, 'Inserisci email e password.');
        rate_limit('accesso:ip:' . client_ip(), 20, 900);
        rate_limit('accesso:email:' . mb_strtolower($email), 8, 900);
        $st = db()->prepare('SELECT id, email, hash, verificato FROM utenti WHERE email = ?');
        $st->execute([$email]);
        $user = $st->fetch();
        // Con un indirizzo sconosciuto si calcola comunque un hash, così i tempi di risposta non lo rivelano.
        $hash = $user['hash'] ?? password_hash($password, password_algo());
        if (!password_verify(mb_substr($password, 0, 200), $hash) || !$user) fail(401, 'Email o password non corretti.');
        if (!$user['verificato']) fail(403, "Devi ancora confermare l'indirizzo email: cerca il messaggio che ti abbiamo mandato.", ['codice' => 'non_confermato']);
        if (password_needs_rehash($user['hash'], password_algo())) {
            db()->prepare('UPDATE utenti SET hash = ? WHERE id = ?')->execute([password_hash($password, password_algo()), $user['id']]);
        }
        start_session((int)$user['id']);
        respond(['utente' => ['email' => $user['email'], 'admin' => is_admin($user)]]);
    }

    case 'POST uscita':
        body();
        end_session();
        respond(['ok' => true]);

    case 'POST recupero': {
        $email = str_field(body(), 'email');
        if (!valid_email($email)) fail(400, "L'indirizzo email non è valido.");
        rate_limit('recupero:ip:' . client_ip(), 5, 3600);
        rate_limit('recupero:email:' . mb_strtolower($email), 3, 3600);
        $st = db()->prepare('SELECT id FROM utenti WHERE email = ?');
        $st->execute([$email]);
        $id = $st->fetchColumn();
        if ($id !== false) {
            $token = issue_token((int)$id, 'password', RESET_HOURS);
            send_mail($email, 'Nuova password per Classifiche Italia',
                "Per scegliere una nuova password apri questo link entro un'ora:\n\n" . site_url('account/?password=' . $token)
                . "\n\nSe non hai chiesto tu di cambiare la password, ignora questo messaggio: quella attuale resta valida." . mail_footer());
        }
        respond(['ok' => true, 'messaggio' => SENT]);
    }

    case 'POST nuova-password': {
        $data = body();
        rate_limit('token:ip:' . client_ip(), 20, 900);
        $password = $data['password'] ?? '';
        if (!is_string($password)) fail(400, 'Richiesta non valida.');
        check_password_rules($password);
        $userId = consume_token(str_field($data, 'token', 100), 'password');
        if ($userId === null) fail(400, 'Il link non è valido o è scaduto: chiedine uno nuovo.');
        $pdo = db();
        // Il link è arrivato all'indirizzo, che quindi risulta confermato. Le altre sessioni vengono chiuse.
        $pdo->prepare('UPDATE utenti SET hash = ?, verificato = 1 WHERE id = ?')->execute([password_hash($password, password_algo()), $userId]);
        $pdo->prepare('DELETE FROM sessioni WHERE utente = ?')->execute([$userId]);
        $pdo->prepare('DELETE FROM token WHERE utente = ?')->execute([$userId]);
        start_session($userId);
        $email = user_email($userId);
        respond(['utente' => ['email' => $email, 'admin' => is_admin(['email' => $email])]]);
    }

    case 'POST cambio-password': {
        $data = body();
        $user = require_user();
        rate_limit('utente:' . $user['id'], 10, 900);
        $current = $data['attuale'] ?? '';
        $new = $data['nuova'] ?? '';
        if (!is_string($current) || !is_string($new)) fail(400, 'Richiesta non valida.');
        check_password($user['id'], $current);
        check_password_rules($new);
        $pdo = db();
        $pdo->prepare('UPDATE utenti SET hash = ? WHERE id = ?')->execute([password_hash($new, password_algo()), $user['id']]);
        // Restano valide solo la sessione corrente (riaperta qui sotto) e nessun'altra.
        $pdo->prepare('DELETE FROM sessioni WHERE utente = ?')->execute([$user['id']]);
        start_session($user['id']);
        respond(['ok' => true, 'messaggio' => 'Password cambiata. Gli altri dispositivi dovranno accedere di nuovo.']);
    }

    case 'POST elimina': {
        $data = body();
        $user = require_user();
        rate_limit('utente:' . $user['id'], 10, 900);
        $password = $data['password'] ?? '';
        if (!is_string($password)) fail(400, 'Richiesta non valida.');
        check_password($user['id'], $password);
        // Sessioni, token e spunte si cancellano a cascata (ON DELETE CASCADE).
        db()->prepare('DELETE FROM utenti WHERE id = ?')->execute([$user['id']]);
        set_session_cookie('', time() - 3600);
        respond(['ok' => true]);
    }

    case 'GET spunte':
        respond(['liste' => ticks(require_user()['id'])]);

    case 'POST spunte': {
        $data = body();
        $user = require_user();
        $changes = $data['modifiche'] ?? [];
        $merge = $data['unisci'] ?? [];
        if (!is_array($changes) || !is_array($merge) || count($changes) > 5000) fail(400, 'Richiesta non valida.');
        $pdo = db();
        $now = time();
        $add = $pdo->prepare('INSERT OR IGNORE INTO spunte (utente, lista, chiave, quando) VALUES (?, ?, ?, ?)');
        $del = $pdo->prepare('DELETE FROM spunte WHERE utente = ? AND lista = ? AND chiave = ?');
        $pdo->beginTransaction();
        foreach ($changes as $c) {
            if (!is_array($c) || !valid_tick($c['lista'] ?? null, $c['chiave'] ?? null)) continue;
            if (!empty($c['on'])) $add->execute([$user['id'], $c['lista'], $c['chiave'], $now]);
            else $del->execute([$user['id'], $c['lista'], $c['chiave']]);
        }
        $merged = 0;
        foreach ($merge as $list => $keys) {
            if (!is_array($keys)) continue;
            foreach ($keys as $key) {
                if (++$merged > MAX_TICKS_PER_USER) break 2;
                if (valid_tick($list, $key)) $add->execute([$user['id'], $list, $key, $now]);
            }
        }
        $st = $pdo->prepare('SELECT COUNT(*) FROM spunte WHERE utente = ?');
        $st->execute([$user['id']]);
        if ((int)$st->fetchColumn() > MAX_TICKS_PER_USER) {
            $pdo->rollBack();
            fail(413, 'Hai raggiunto il numero massimo di spunte.');
        }
        $pdo->commit();
        respond(['liste' => ticks($user['id'])]);
    }

    case 'GET profilo': {
        $user = require_user();
        $st = db()->prepare('SELECT nome, liste FROM profili WHERE utente = ?');
        $st->execute([$user['id']]);
        $row = $st->fetch();
        respond(['nome' => $row ? $row['nome'] : null, 'liste' => $row ? public_groups($row['liste']) : []]);
    }

    case 'POST profilo': {
        $data = body();
        $user = require_user();
        rate_limit('profilo:' . $user['id'], 20, 900);
        $pdo = db();
        if (!empty($data['elimina'])) {
            $pdo->prepare('DELETE FROM profili WHERE utente = ?')->execute([$user['id']]);
            respond(['nome' => null, 'liste' => []]);
        }
        $name = str_field($data, 'nome', 60);
        if (preg_match(PUBLIC_NAME_PATTERN, $name) !== 1) {
            fail(400, 'Il nome pubblico deve avere da 3 a 30 caratteri: lettere, cifre, punto, trattino o trattino basso, e iniziare con una lettera o una cifra.');
        }
        $groups = $data['liste'] ?? [];
        if (!is_array($groups)) fail(400, 'Richiesta non valida.');
        $groups = array_values(array_intersect(array_keys(PUBLIC_GROUPS), $groups));
        $st = $pdo->prepare('SELECT utente FROM profili WHERE nome = ?');
        $st->execute([$name]);
        $owner = $st->fetchColumn();
        if ($owner !== false && (int)$owner !== $user['id']) fail(409, 'Questo nome pubblico è già usato da un altro utente: scegline un altro.');
        $pdo->prepare('INSERT INTO profili (utente, nome, liste, aggiornato) VALUES (?, ?, ?, ?)
            ON CONFLICT(utente) DO UPDATE SET nome = excluded.nome, liste = excluded.liste, aggiornato = excluded.aggiornato')
            ->execute([$user['id'], $name, implode(',', $groups), time()]);
        respond(['nome' => $name, 'liste' => $groups]);
    }

    case 'GET pubblici': {
        rate_limit('pubblici:ip:' . client_ip(), 60, 60);
        // Senza numeri: le spunte non sono i titoli (un film importato può averne più d'una, una per variante della chiave).
        $profiles = db()->query("SELECT nome, liste FROM profili WHERE liste != '' ORDER BY nome COLLATE NOCASE LIMIT 1000")->fetchAll();
        respond(['profili' => array_map(fn($p) => ['nome' => $p['nome'], 'liste' => public_groups($p['liste'])], $profiles)]);
    }

    case 'GET liste': {
        rate_limit('liste:ip:' . client_ip(), 120, 60);
        $name = is_string($_GET['u'] ?? null) ? trim($_GET['u']) : '';
        $st = db()->prepare("SELECT utente, nome, liste FROM profili WHERE nome = ? AND liste != ''");
        $st->execute([$name]);
        $p = $st->fetch();
        if (!$p) fail(404, 'Questo profilo non esiste o non è pubblico.');
        $groups = public_groups($p['liste']);
        $stores = array_merge(...array_map(fn($g) => PUBLIC_GROUPS[$g], $groups));
        $all = ticks((int)$p['utente']);
        $lists = [];
        foreach ($stores as $s) $lists[$s] = is_array($all) ? ($all[$s] ?? []) : [];
        respond(['nome' => $p['nome'], 'gruppi' => $groups, 'liste' => $lists]);
    }

    case 'GET backup': {
        $key = config()['chiave_backup'];
        if ($key === '' || !is_string($_GET['k'] ?? null) || !hash_equals($key, $_GET['k'])) fail(404, 'Non trovato.');
        $dir = config()['db_dir'];
        $file = $dir . DIRECTORY_SEPARATOR . 'backup-' . date('Ymd-His') . '.sqlite';
        db()->exec('VACUUM INTO ' . db()->quote($file));
        // Si tengono le ultime 5 copie.
        $copies = glob($dir . DIRECTORY_SEPARATOR . 'backup-*.sqlite') ?: [];
        sort($copies);
        foreach (array_slice($copies, 0, -5) as $old) @unlink($old);
        respond(['ok' => true, 'file' => basename($file), 'byte' => filesize($file)]);
    }

    case 'POST visita':
        // Nessun dato del visitatore: conta solo la data dell'ultimo aggiornamento (mdb-database/aggiornamento.json).
        respond(['avviato' => start_daily_update()]);

    case 'GET aggiornamento':
        require_admin();
        respond(update_status());

    case 'POST aggiornamento': {
        body();
        $user = require_admin();
        rate_limit('aggiornamento:' . $user['id'], 3, 600);
        try {
            start_update('admin');
        } catch (RuntimeException $e) {
            fail(502, $e->getMessage());
        }
        respond(update_status());
    }

    case 'GET sito-impronte':
        require_publish_key();
        respond(['file' => site_fingerprints(), 'pezzo' => UPLOAD_PART_BYTES]);

    case 'POST sito-carica':
        require_publish_key();
        respond(receive_upload((string)($_GET['id'] ?? ''), (int)($_GET['parte'] ?? 0), (int)($_GET['parti'] ?? 0)));

    case 'POST sito-svuota':
        require_publish_key();
        respond(['eliminati' => clear_overlay()]);

    default:
        fail(404, 'Azione sconosciuta.');
}

// --- Funzioni usate solo qui --------------------------------------------------------------------------------------

function send_verification(int $userId, string $email): void {
    $token = issue_token($userId, 'conferma', VERIFY_HOURS);
    send_mail($email, 'Conferma il tuo account su Classifiche Italia',
        "Ti diamo il benvenuto su Classifiche Italia!\n\nPer attivare l'account e salvare le tue spunte apri questo link entro 48 ore:\n\n"
        . site_url('account/?conferma=' . $token) . mail_footer());
}

function user_email(int $userId): string {
    $st = db()->prepare('SELECT email FROM utenti WHERE id = ?');
    $st->execute([$userId]);
    return (string)$st->fetchColumn();
}

function check_password(int $userId, string $password): void {
    $st = db()->prepare('SELECT hash FROM utenti WHERE id = ?');
    $st->execute([$userId]);
    if (!password_verify(mb_substr($password, 0, 200), (string)$st->fetchColumn())) fail(403, 'La password non è corretta.');
}

function valid_tick(mixed $list, mixed $key): bool {
    return is_string($list) && preg_match(LIST_PATTERN, $list) === 1
        && is_string($key) && $key !== '' && strlen($key) <= MAX_KEY_LENGTH && mb_check_encoding($key, 'UTF-8');
}

/** Gruppi pubblici validi da una colonna "liste" di profili ("film-visti,libri-letti"). */
function public_groups(string $value): array {
    return array_values(array_intersect(array_keys(PUBLIC_GROUPS), explode(',', $value)));
}

/** Spunte dell'utente raggruppate per lista: {"visti": ["…", …], …}. */
function ticks(int $userId): array|object {
    $st = db()->prepare('SELECT lista, chiave FROM spunte WHERE utente = ? ORDER BY lista, quando');
    $st->execute([$userId]);
    $lists = [];
    foreach ($st as $row) $lists[$row['lista']][] = $row['chiave'];
    return $lists ?: new stdClass();
}
