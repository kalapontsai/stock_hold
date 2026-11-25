<?php
/**
 * debug.php — stock_hold deployment diagnostic.
 *
 * USAGE: drop this single file in the webroot (e.g. public_html/stock_hold/)
 *        via FileZilla, then curl it:
 *          curl -s https://tracker.elhomeo.com/debug.php
 *
 * Outputs JSON describing what files are actually deployed on the server:
 *   - sizes, mtimes, md5 sums of key files (VERSION.txt, api/bootstrap.php,
 *     frontend/login.html)
 *   - whether api/bootstrap.php contains the new debug code / new CSP
 *   - whether the X-Frame-Options header in the source is DENY (new) or
 *     SAMEORIGIN (old)
 *
 * DELETE THIS FILE AFTER DEBUGGING — it leaks file paths and md5s.
 *
 * Read-only. No DB calls, no .env reads. Safe to leave for a few minutes
 * while you copy the curl output back.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$root = __DIR__;

$out = [
    'server' => [
        'php_version'      => PHP_VERSION,
        'script_filename'  => $_SERVER['SCRIPT_FILENAME'] ?? null,
        'document_root'    => $_SERVER['DOCUMENT_ROOT'] ?? null,
        'request_time_utc' => gmdate('Y-m-d\TH:i:s\Z'),
    ],
    'webroot_top_level' => array_values(array_filter(
        scandir($root) ?: [],
        static fn(string $f): bool => $f !== '.' && $f !== '..'
    )),
    'files' => [],
];

$keyFiles = [
    'VERSION.txt',
    'api/bootstrap.php',
    'frontend/login.html',
];

foreach ($keyFiles as $rel) {
    $path = $root . '/' . $rel;
    if (!file_exists($path)) {
        $out['files'][$rel] = ['exists' => false];
        continue;
    }
    $info = [
        'exists' => true,
        'size'   => filesize($path),
        'mtime'  => gmdate('Y-m-d\TH:i:s\Z', filemtime($path)),
        'md5'    => md5_file($path),
    ];

    if ($rel === 'VERSION.txt') {
        $content = (string) file_get_contents($path);
        if (preg_match('/Commit:\s+([0-9a-f]{7,40})/', $content, $m)) {
            $info['commit'] = $m[1];
        }
        if (preg_match('/Built at:\s+(\S+)/', $content, $m)) {
            $info['built_at'] = $m[1];
        }
    }

    if ($rel === 'api/bootstrap.php') {
        $content = (string) file_get_contents($path);
        // Markers that should be present in commit e520ec0 (debug) and after:
        $info['has_X_Stock_Hold_Debug_header'] = str_contains($content, 'X-Stock-Hold-Debug');
        $info['has_challenges_cloudflare_in_CSP'] = str_contains($content, 'https://challenges.cloudflare.com');
        $info['has_frame_src_directive'] = str_contains($content, 'frame-src');
        // Markers from OLD code that should NOT be present:
        $info['has_frame_ancestors_old_directive'] = str_contains($content, 'frame-ancestors');
        $info['has_base_uri_old_directive'] = str_contains($content, 'base-uri');
        $info['has_form_action_old_directive'] = str_contains($content, 'form-action');
        if (preg_match("/X-Frame-Options:\s*'?([A-Z]+)'?/", $content, $m)) {
            $info['x_frame_options_value'] = $m[1];
        }
    }

    $out['files'][$rel] = $info;
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
