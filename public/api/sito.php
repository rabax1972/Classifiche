<?php
// File aggiornati dal workflow di GitHub (mdb-database/sito/, vedi _inc/aggiornamenti.php): web.config manda qui le richieste
// per cui ne esiste uno, al posto del file statico della cartella /classifiche.

define('CLASSIFICHE_API', true);
require __DIR__ . '/_inc/app.php';
require __DIR__ . '/_inc/aggiornamenti.php';

$path = is_string($_GET['f'] ?? null) ? $_GET['f'] : '';
$file = overlay_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $path);
if (!valid_site_path($path) || !is_file($file)) {
    // Tolto tra il controllo di web.config e questa richiesta (es. cartella appena svuotata): la pagina 404 del sito.
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    @readfile(dirname(__DIR__) . DIRECTORY_SEPARATOR . '404.html');
    exit;
}

$type = SITE_FILE_TYPES[strtolower(pathinfo($path, PATHINFO_EXTENSION))];
$mtime = (int)filemtime($file);
$etag = '"' . dechex($mtime) . '-' . dechex((int)filesize($file)) . '"';
header('Content-Type: ' . $type);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
header('ETag: ' . $etag);
// CSS e JS in _astro/ hanno l'hash nel nome; il resto cambia a ogni aggiornamento e va ricontrollato (con l'ETag).
header('Cache-Control: ' . (str_starts_with($path, '_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache'));
header('Vary: Accept-Encoding');

if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}

$body = file_get_contents($file);
$text = str_starts_with($type, 'text/') || str_starts_with($type, 'application/') || $type === 'image/svg+xml';
if ($text && function_exists('gzencode') && str_contains($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip')) {
    $body = gzencode($body, 5);
    header('Content-Encoding: gzip');
}
header('Content-Length: ' . strlen($body));
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $body;
