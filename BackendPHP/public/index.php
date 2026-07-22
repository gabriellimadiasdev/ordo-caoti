<?php
declare(strict_types=1);

$configFile = dirname(__DIR__) . '/config.php';
if (!is_file($configFile)) {
    respond(['error' => 'Backend not configured. Copy config.example.php to config.php.'], 503);
}
$config = require $configFile;

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $config['allowed_origins'] ?? [];
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: false');
}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $db = $config['database'];
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $db['host'],
        $db['port'],
        $db['name'],
        $db['charset']
    );
    $pdo = new PDO($dsn, $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (Throwable $exception) {
    error_log('Database connection failed: ' . $exception->getMessage());
    respond(['error' => 'Database unavailable.'], 503);
}

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$payload = readJsonBody();

if ($method === 'GET' && $path === '/api/health') {
    $pdo->query('SELECT 1');
    respond(['ok' => true, 'service' => 'BackendPHP']);
}

if ($method === 'POST' && $path === '/api/auth/register') {
    $name = trim((string) ($payload['nome'] ?? ''));
    $email = strtolower(trim((string) ($payload['email'] ?? '')));
    $password = (string) ($payload['senha'] ?? '');
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 12) {
        respond(['error' => 'Nome, e-mail válido e senha de pelo menos 12 caracteres são obrigatórios.'], 422);
    }

    $check = $pdo->prepare('SELECT id FROM usuarios WHERE email = :email LIMIT 1');
    $check->execute(['email' => $email]);
    if ($check->fetch()) {
        respond(['error' => 'E-mail já cadastrado.'], 409);
    }

    $insert = $pdo->prepare(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo) VALUES (:nome, :email, :senha_hash, :tipo_usuario, 1)'
    );
    $insert->execute([
        'nome' => $name,
        'email' => $email,
        'senha_hash' => password_hash($password, PASSWORD_DEFAULT),
        'tipo_usuario' => 'aluno',
    ]);
    respond(['ok' => true, 'usuario_id' => (int) $pdo->lastInsertId()], 201);
}

if ($method === 'POST' && $path === '/api/auth/login') {
    $email = strtolower(trim((string) ($payload['email'] ?? '')));
    $password = (string) ($payload['senha'] ?? '');
    $statement = $pdo->prepare('SELECT id, nome, email, senha_hash, tipo_usuario FROM usuarios WHERE email = :email AND ativo = 1 LIMIT 1');
    $statement->execute(['email' => $email]);
    $user = $statement->fetch();
    if (!$user || !password_verify($password, $user['senha_hash'])) {
        respond(['error' => 'Credenciais inválidas.'], 401);
    }

    $token = bin2hex(random_bytes(32));
    $session = $pdo->prepare(
        'INSERT INTO usuario_sessoes (usuario_id, token_hash, expira_em) VALUES (:usuario_id, :token_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))'
    );
    $session->execute([
        'usuario_id' => $user['id'],
        'token_hash' => hash('sha256', $token),
    ]);
    unset($user['senha_hash']);
    respond(['token' => $token, 'usuario' => $user]);
}

if ($method === 'GET' && $path === '/api/auth/me') {
    $user = authenticatedUser($pdo);
    respond(['usuario' => $user]);
}

if ($method === 'POST' && $path === '/api/auth/logout') {
    $token = bearerToken();
    if ($token !== null) {
        $revoke = $pdo->prepare('UPDATE usuario_sessoes SET revogado_em = UTC_TIMESTAMP() WHERE token_hash = :token_hash AND revogado_em IS NULL');
        $revoke->execute(['token_hash' => hash('sha256', $token)]);
    }
    respond(['ok' => true]);
}

respond(['error' => 'Route not found.'], 404);

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respond(['error' => 'JSON body inválido.'], 400);
    }
    return $decoded;
}

function bearerToken(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([a-f0-9]{64})$/i', $header, $matches) !== 1) {
        return null;
    }
    return $matches[1];
}

function authenticatedUser(PDO $pdo): array
{
    $token = bearerToken();
    if ($token === null) {
        respond(['error' => 'Authentication required.'], 401);
    }
    $statement = $pdo->prepare(
        'SELECT u.id, u.nome, u.email, u.tipo_usuario FROM usuario_sessoes s INNER JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = :token_hash AND s.revogado_em IS NULL AND s.expira_em > UTC_TIMESTAMP() AND u.ativo = 1 LIMIT 1'
    );
    $statement->execute(['token_hash' => hash('sha256', $token)]);
    $user = $statement->fetch();
    if (!$user) {
        respond(['error' => 'Invalid or expired token.'], 401);
    }
    return $user;
}

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
