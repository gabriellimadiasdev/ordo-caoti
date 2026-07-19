const path = require('path');
function requireWithWorkspaceFallback(moduleName) {
  try {
    return require(moduleName);
  } catch (_) {
    return require(path.join(__dirname, '../json/node_modules', moduleName));
  }
}

const dotenv = requireWithWorkspaceFallback('dotenv');
// Priority: backend/json/.env -> repo-root/.env -> process cwd/.env
dotenv.config({ path: path.join(__dirname, '../json/.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();
const express = requireWithWorkspaceFallback('express');
const { Pool } = requireWithWorkspaceFallback('pg');
const bcrypt = requireWithWorkspaceFallback('bcrypt');
const jwt = requireWithWorkspaceFallback('jsonwebtoken');
const cors = requireWithWorkspaceFallback('cors');
const crypto = require('crypto');
const multer = requireWithWorkspaceFallback('multer');
const fs = require('fs');
const { createClient } = requireWithWorkspaceFallback('@supabase/supabase-js');
const { google } = requireWithWorkspaceFallback('googleapis');
const {
  createIdempotencyKey,
  createOrderClient,
  normalizeOrderStatusToPedidoStatus,
  normalizeOrderStatusToTransactionStatus,
  sanitizeMercadoError,
  toAmountString,
  verifyMercadoPagoWebhookSignature
} = require('./services/mercadoPagoOrders');
const { fetchCorreiosTracking } = require('./services/correiosTracking');
const { createMeetingToken, createRoom, listRooms } = require('./services/dailyCo');
const {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  hasAwsS3Config,
  putBufferToS3
} = require('./services/awsS3Storage');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer?.toString('utf8') || '';
  }
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const isProductionEnv = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const DEFAULT_CORS_ALLOWED_ORIGINS = isProductionEnv
  ? [
      'https://ordocaoti.com.br',
      'https://www.ordocaoti.com.br',
      'https://ordocaoti.com',
      'https://www.ordocaoti.com'
    ]
  : [
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];

const configuredCorsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsAllowedOrigins = configuredCorsAllowedOrigins.length
  ? configuredCorsAllowedOrigins
  : DEFAULT_CORS_ALLOWED_ORIGINS;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        if (isProductionEnv) {
          return callback(null, false);
        }
        return callback(null, true);
      }

      if (corsAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id']
    ? String(req.headers['x-request-id']).trim()
    : createIdempotencyKey();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests; script-src 'self' 'unsafe-inline' https://sdk.mercadopago.com https://apis.google.com https://www.gstatic.com https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://www.instagram.com https://*.tiktok.com https://*.tiktokcdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.ordocaoti.com.br https://api.mercadopago.com https://*.mercadopago.com https://www.googleapis.com https://accounts.google.com https://*.supabase.co wss://*.supabase.co https://*.daily.co https://www.instagram.com https://*.tiktok.com https://*.tiktokcdn.com; frame-src 'self' https://meet.google.com https://www.youtube.com https://www.youtube-nocookie.com https://*.daily.co https://www.instagram.com https://*.tiktok.com; media-src 'self' blob: https:; form-action 'self' https://api.mercadopago.com https://*.mercadopago.com"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

const PROJECT_ROOT = path.join(__dirname, '../..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const FRONTEND_HTML_DIR = path.join(FRONTEND_DIR, 'html');
const FRONTEND_UPLOADS_DIR = path.join(FRONTEND_DIR, 'uploads');

fs.mkdirSync(FRONTEND_UPLOADS_DIR, { recursive: true });

const STATIC_CACHE_OPTIONS = {
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  immutable: process.env.NODE_ENV === 'production'
};

app.use('/css', express.static(path.join(FRONTEND_DIR, 'css'), STATIC_CACHE_OPTIONS));
app.use('/img', express.static(path.join(FRONTEND_DIR, 'img'), STATIC_CACHE_OPTIONS));
app.use('/js', express.static(path.join(FRONTEND_DIR, 'js'), STATIC_CACHE_OPTIONS));
app.use('/i18n', express.static(path.join(FRONTEND_DIR, 'i18n'), STATIC_CACHE_OPTIONS));
app.use('/uploads', express.static(FRONTEND_UPLOADS_DIR, { ...STATIC_CACHE_OPTIONS, immutable: false, maxAge: '1h' }));
app.use('/frontend', express.static(FRONTEND_DIR, STATIC_CACHE_OPTIONS));

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.DATABASE1_URL || process.env.POSTGRES_URL || '').trim();
const IS_DATABASE_URL_SUSPECT = /postgresql:\/\/[^:]+:eyJ[a-zA-Z0-9._-]+@/i.test(DATABASE_URL);

if (!DATABASE_URL) {
  throw new Error('Configuracao insegura: DATABASE_URL, DATABASE1_URL ou POSTGRES_URL obrigatorio para iniciar o servidor.');
}

if (IS_DATABASE_URL_SUSPECT) {
  console.warn('Configuracao suspeita: DATABASE_URL parece usar JWT/token como senha. Use a senha do banco (Database Password), nao service_role JWT.');
  if (isProductionEnv) {
    throw new Error('DATABASE_URL invalido em producao: detectado token JWT como senha. Configure a senha real do banco.');
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  query_timeout: 10000,
  keepAlive: true
});

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'ordo-archive').trim();
const SUPABASE_ENCRYPTION_KEY = String(process.env.SUPABASE_ENCRYPTION_KEY || '').trim();

const supabaseStorageClient = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
const MERCADO_PAGO_WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET || '';
const API_PUBLIC_BASE_URL = String(process.env.API_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const FRONTEND_PUBLIC_BASE_URL =
  process.env.FRONTEND_PUBLIC_BASE_URL || 'http://localhost:3000/frontend/html';
const APP_PREFERENCES_VERSION = process.env.APP_PREFERENCES_VERSION || '2026.04';
const TERMO_PRIVACIDADE_VERSAO = process.env.TERMO_PRIVACIDADE_VERSAO || '2026.04';
const JWT_SECRET = String(process.env.JWT_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.IT_SESSION_SECRET || '').trim();
const ADMIN_AREA_SHARED_PASSCODE = String(process.env.ADMIN_AREA_SHARED_PASSCODE || '').trim();
const BOOTSTRAP_ADMIN_CAIO_EMAIL = String(process.env.BOOTSTRAP_ADMIN_CAIO_EMAIL || 'contatocaiozanoni@gmail.com').trim().toLowerCase();
const BOOTSTRAP_ADMIN_DAYENNE_EMAIL = String(process.env.BOOTSTRAP_ADMIN_DAYENNE_EMAIL || 'dayeekennedy@gmail.com').trim().toLowerCase();
const BOOTSTRAP_TI_EMAIL = String(process.env.BOOTSTRAP_TI_EMAIL || 'g.lima.rocha90@gmail.com').trim().toLowerCase();

if (!JWT_SECRET) {
  throw new Error('Configuracao insegura: JWT_SECRET obrigatorio para iniciar o servidor.');
}

const SESSION_CONFIG = {
  persistent: { jwtExpiresIn: '30d', maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  session: { jwtExpiresIn: '12h', maxAgeMs: 12 * 60 * 60 * 1000 }
};

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_REFRESH_TOKEN = String(process.env.GOOGLE_REFRESH_TOKEN || '').trim();
const GOOGLE_CALENDAR_ACCESS_TOKEN = String(process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || '').trim();
const GOOGLE_CALENDAR_ID = String(process.env.GOOGLE_CALENDAR_ID || 'primary').trim();
const GOOGLE_DRIVE_SHARED_FOLDER_ID = String(process.env.GOOGLE_DRIVE_SHARED_FOLDER_ID || '').trim();
const STORAGE_PREFER_GOOGLE_DRIVE = String(process.env.STORAGE_PREFER_GOOGLE_DRIVE || 'true').trim().toLowerCase() !== 'false';
const GOOGLE_OAUTH_REDIRECT_URI = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
const APPLE_CLIENT_ID = String(process.env.APPLE_CLIENT_ID || '').trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || '').trim();
const APPLE_KEY_ID = String(process.env.APPLE_KEY_ID || '').trim();
const APPLE_PRIVATE_KEY = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const APPLE_OAUTH_REDIRECT_URI = String(process.env.APPLE_OAUTH_REDIRECT_URI || '').trim();
const DAILY_API_KEY = String(process.env.DAILY_API_KEY || '').trim();
const DAILY_DOMAIN = String(process.env.DAILY_DOMAIN || '').trim().replace(/\/+$/, '');
const AWS_S3_PREFIX = String(process.env.AWS_S3_PREFIX || 'uploads').trim().replace(/^\/+|\/+$/g, '');

const CANONICAL_HOST = String(process.env.CANONICAL_HOST || 'www.ordocaoti.com.br').trim().toLowerCase();
const ADDITIONAL_PUBLIC_DOMAINS = (process.env.ADDITIONAL_PUBLIC_DOMAINS || 'ordocaoti.com.br,ordocaoti.com,ordocaoti.us,ordocaoti.eu')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const NIVEL_HIERARCHY = [
  'neofito', 'mago_n1', 'mago_n2', 'mago_n3', 'mentor', 'sabio', 'mestre', 'mestre_fundador', 'ti'
];

const NIVEL_RANKING = Object.freeze(
  Object.fromEntries(NIVEL_HIERARCHY.map((nivel, index) => [nivel, index + 1]))
);


const FOUNDERS_EMAILS = new Set([
  BOOTSTRAP_ADMIN_CAIO_EMAIL,
  BOOTSTRAP_ADMIN_DAYENNE_EMAIL
]);

const SAGE_EMAILS = new Set([
  'victor.gante@ordocaoti.com.br'
]);

function getRequiredBootstrapPassword(envVarName) {
  return String(process.env[envVarName] || '').trim();
}

function getCoreBootstrapUsers(overrides = {}) {
  const caioEmail = String(overrides.BOOTSTRAP_ADMIN_CAIO_EMAIL || process.env.BOOTSTRAP_ADMIN_CAIO_EMAIL || 'contatocaiozanoni@gmail.com').trim().toLowerCase();
  const dayenneEmail = String(overrides.BOOTSTRAP_ADMIN_DAYENNE_EMAIL || process.env.BOOTSTRAP_ADMIN_DAYENNE_EMAIL || 'dayeekennedy@gmail.com').trim().toLowerCase();
  const tiEmail = String(overrides.BOOTSTRAP_TI_EMAIL || process.env.BOOTSTRAP_TI_EMAIL || 'g.lima.rocha90@gmail.com').trim().toLowerCase();

  const caioPass = String(overrides.BOOTSTRAP_ADMIN_CAIO_PASSWORD || process.env.BOOTSTRAP_ADMIN_CAIO_PASSWORD || '').trim();
  const dayennePass = String(overrides.BOOTSTRAP_ADMIN_DAYENNE_PASSWORD || process.env.BOOTSTRAP_ADMIN_DAYENNE_PASSWORD || '').trim();
  const tiPass = String(overrides.BOOTSTRAP_TI_PASSWORD || process.env.BOOTSTRAP_TI_PASSWORD || '').trim();

  return [
    {
      nome: 'Caio Zanoni',
      email: caioEmail,
      senha: caioPass,
      senha_env: 'BOOTSTRAP_ADMIN_CAIO_PASSWORD',
      tipo_usuario: 'admin',
      nivel_codigo: 'mestre_fundador',
      registro_academico: 'MFOCAI001',
      papeis: ['admin', 'mestre']
    },
    {
      nome: 'Dayenne Kennedy',
      email: dayenneEmail,
      senha: dayennePass,
      senha_env: 'BOOTSTRAP_ADMIN_DAYENNE_PASSWORD',
      tipo_usuario: 'admin',
      nivel_codigo: 'mestre_fundador',
      registro_academico: 'MFDAYE001',
      papeis: ['admin', 'mestre']
    },
    {
      nome: 'Gabriel Lima Rocha',
      email: tiEmail,
      senha: tiPass,
      senha_env: 'BOOTSTRAP_TI_PASSWORD',
      tipo_usuario: 'ti',
      nivel_codigo: 'ti',
      registro_academico: 'TIGAB001',
      papeis: ['ti', 'Neófito', 'mago_n1']
    }
  ];
}

const MAX_BOOTSTRAP_PRIVILEGED_USERS = 3;
const BOOTSTRAP_FOUNDERS_ENABLED = String(process.env.BOOTSTRAP_FOUNDERS_ENABLED || 'false').trim().toLowerCase() === 'true';

function getBootstrapGateSecrets(overrides = {}) {
  const secrets = new Set();
  if (ADMIN_AREA_SHARED_PASSCODE) {
    secrets.add(ADMIN_AREA_SHARED_PASSCODE);
  }
  const users = getCoreBootstrapUsers(overrides);
  users.forEach((user) => {
    if (user?.senha) {
      secrets.add(String(user.senha));
    }
  });
  return Array.from(secrets);
}

function isBootstrapGatePasscodeValid(passcode, overrides = {}) {
  const provided = String(passcode || '').trim();
  if (!provided) return false;
  const knownSecrets = getBootstrapGateSecrets(overrides);
  return knownSecrets.some((candidate) => safeEqualsSecret(provided, candidate));
}

const RATE_LIMIT_RULES = {
  globalTraffic: { windowMs: 60 * 1000, max: 900, keyPrefix: 'global_traffic' },
  login: { windowMs: 15 * 60 * 1000, max: 40, keyPrefix: 'login' },
  passwordRecovery: { windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'password_recovery' },
  passwordReset: { windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'password_reset' },
  webhook: { windowMs: 60 * 1000, max: 300, keyPrefix: 'webhook_orders' }
};

const LOGIN_FAILURE_RULE = Object.freeze({
  windowMs: 15 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
  maxAttempts: 8
});

function resolveSessionType(rawType) {
  return String(rawType || '').trim().toLowerCase() === 'session' ? 'session' : 'persistent';
}

function getCookieOptions(maxAgeMs) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: maxAgeMs
  };
}

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return { ok: false, erro: 'Senha deve ter no minimo 8 caracteres.' };
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, erro: 'Senha deve conter letras maiusculas, minusculas e numeros.' };
  }
  return { ok: true };
}

const mercadoPagoOrderClient = MERCADO_PAGO_ACCESS_TOKEN
  ? createOrderClient(MERCADO_PAGO_ACCESS_TOKEN)
  : null;

function requireMercadoPagoOrderClient() {
  if (!mercadoPagoOrderClient) {
    throw new Error(
      'Integracao Mercado Pago indisponivel: configure MERCADO_PAGO_ACCESS_TOKEN no ambiente.'
    );
  }
  return mercadoPagoOrderClient;
}

const MAINTENANCE_BYPASS_PREFIXES = [
  '/css',
  '/img',
  '/js',
  '/i18n',
  '/uploads',
  '/frontend',
  '/manifest.webmanifest',
  '/sw.js',
  '/offline',
  '/legal',
  '/login',
  '/dashboard-TI',
  '/dashboard-ti',
  '/manutencao-ti',
  '/ti/',
  '/api/recuperar-senha',
  '/api/redefinir-senha',
  '/redefinir-senha',
  '/manutencao/status'
];

function shouldBypassMaintenance(pathname) {
  if (pathname === '/' || pathname === '/index.html' || pathname === '/src/index.html') {
    return true;
  }
  return MAINTENANCE_BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function normalizeNivelCodigo(value) {
  return String(value || '').trim().toLowerCase();
}

function getNivelRank(value) {
  const normalized = normalizeNivelCodigo(value);
  return NIVEL_RANKING[normalized] || 0;
}

function isNivelAtLeast(currentNivel, minNivel) {
  return getNivelRank(currentNivel) >= getNivelRank(minNivel);
}

function isFounderEmail(email) {
  return FOUNDERS_EMAILS.has(String(email || '').trim().toLowerCase());
}

function isSageEmail(email) {
  return SAGE_EMAILS.has(String(email || '').trim().toLowerCase());
}

async function getRequesterUserType(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  try {
    const { id, jti } = jwt.verify(token, JWT_SECRET);

    if (jti) {
      const sessionResult = await pool.query(
        `
        SELECT id
        FROM usuario_sessoes
        WHERE usuario_id = $1
          AND jwt_id = $2
          AND revogado_em IS NULL
          AND expira_em > NOW()
        LIMIT 1
        `,
        [id, jti]
      );

      if (!sessionResult.rows.length) {
        return null;
      }
    }

    const { rows } = await pool.query('SELECT tipo_usuario FROM usuarios WHERE id = $1', [id]);
    return rows[0]?.tipo_usuario || null;
  } catch (_) {
    return null;
  }
}

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!host) return next();

  const allowed = new Set([CANONICAL_HOST, ...ADDITIONAL_PUBLIC_DOMAINS]);
  if (!allowed.has(host)) {
    return next();
  }

  if (host === CANONICAL_HOST) {
    return next();
  }

  const target = `https://${CANONICAL_HOST}${req.originalUrl || req.url || '/'}`;
  return res.redirect(301, target);
});

app.use(async (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  const pathname = req.path || '/';
  if (shouldBypassMaintenance(pathname)) {
    return next();
  }

  try {
    const requesterType = await getRequesterUserType(req);
    if (['admin', 'ti'].includes(requesterType)) {
      return next();
    }

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.titulo,
        m.descricao,
        m.motivo,
        m.inicio_em,
        m.previsao_retorno_em,
        m.motivo_extensao
      FROM manutencoes m
      JOIN manutencao_alvos ma ON ma.manutencao_id = m.id
      WHERE m.status = 'ativa'
        AND (ma.rota_alvo = $1 OR ma.rota_alvo = '*')
      ORDER BY m.inicio_em DESC
      LIMIT 1
      `,
      [pathname]
    );

    const maintenance = rows[0];
    if (!maintenance) {
      return next();
    }

    const payload = {
      erro: 'Pagina em manutencao.',
      manutencao: {
        id: maintenance.id,
        titulo: maintenance.titulo,
        descricao: maintenance.descricao,
        motivo: maintenance.motivo,
        inicio_em: maintenance.inicio_em,
        previsao_retorno_em: maintenance.previsao_retorno_em,
        motivo_extensao: maintenance.motivo_extensao
      }
    };

    if (pathname.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(503).json(payload);
    }

    const inicio = maintenance.inicio_em ? new Date(maintenance.inicio_em).toLocaleString('pt-BR') : '-';
    const previsao = maintenance.previsao_retorno_em ? new Date(maintenance.previsao_retorno_em).toLocaleString('pt-BR') : 'Sem previsao';

    return res.status(503).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Pagina em manutencao</title>
        <style>
          body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0e141c; color:#f2f5ff; font-family:Segoe UI, sans-serif; padding:20px; }
          .card { max-width:760px; width:100%; border:1px solid #2a3f58; border-radius:14px; background:#152234; padding:20px; }
          h1 { margin:0 0 10px; color:#f3be49; }
          p { color:#b6c8dd; line-height:1.5; }
          .meta { margin-top:12px; border:1px solid #304a68; border-radius:10px; background:#112034; padding:12px; }
        </style>
      </head>
      <body>
        <main class="card">
          <h1>Pagina em manutencao</h1>
          <p><strong>${maintenance.titulo}</strong></p>
          <p>${maintenance.descricao}</p>
          <div class="meta">
            <p><strong>Motivo:</strong> ${maintenance.motivo}</p>
            <p><strong>Inicio:</strong> ${inicio} (horario de Brasilia)</p>
            <p><strong>Previsao de retorno:</strong> ${previsao}</p>
            <p>O prazo pode ser estendido em caso de ajustes adicionais.</p>
          </div>
        </main>
      </body>
      </html>
    `);
  } catch (_) {
    return next();
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, FRONTEND_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${sanitizeStorageFileName(file.originalname)}`);
  }
});

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain'
]);

function validateUploadFile(file, callback) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(String(file?.mimetype || '').toLowerCase())) {
    return callback(new Error('Tipo de arquivo nao permitido. Envie PDF, documento, planilha, imagem ou texto.'));
  }
  return callback(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, callback) => validateUploadFile(file, callback)
});

function hasSupabaseStorageClient() {
  return !!supabaseStorageClient;
}

function getEncryptionKeyBuffer() {
  if (!SUPABASE_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(SUPABASE_ENCRYPTION_KEY).digest();
}

function encryptPayload(payload) {
  const key = getEncryptionKeyBuffer();
  const plaintext = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');

  if (!key) {
    return {
      encrypted: false,
      algorithm: 'plain-json',
      iv: null,
      authTag: null,
      payload: plaintext.toString('base64')
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    payload: encrypted.toString('base64')
  };
}

function decryptPayload(record) {
  if (!record) return null;
  if (!record.encrypted || record.algorithm === 'plain-json') {
    return JSON.parse(Buffer.from(String(record.payload || ''), 'base64').toString('utf8') || '{}');
  }

  const key = getEncryptionKeyBuffer();
  if (!key) return null;
  const iv = Buffer.from(String(record.iv || ''), 'base64');
  const authTag = Buffer.from(String(record.authTag || ''), 'base64');
  const encrypted = Buffer.from(String(record.payload || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8') || '{}');
}

async function ensureUniversalArchiveTable() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS armazenamento_universal (
      id SERIAL PRIMARY KEY,
      chave VARCHAR(180) NOT NULL UNIQUE,
      tipo_recurso VARCHAR(80) NOT NULL,
      subtipo VARCHAR(80),
      encrypted BOOLEAN NOT NULL DEFAULT true,
      algorithm VARCHAR(40) NOT NULL DEFAULT 'aes-256-gcm',
      iv TEXT,
      auth_tag TEXT,
      payload_base64 TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      supabase_bucket VARCHAR(120),
      supabase_path TEXT,
      criado_por_id INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_armazenamento_universal_tipo ON armazenamento_universal(tipo_recurso);
    CREATE INDEX IF NOT EXISTS idx_armazenamento_universal_criado_em ON armazenamento_universal(criado_em DESC);
    `
  );
}

async function saveUniversalArchive({ chave, tipoRecurso, subtipo, payload, metadata, userId, bucket, bucketPath }) {
  await ensureUniversalArchiveTable();
  const encrypted = encryptPayload(payload);

  const { rows } = await pool.query(
    `
    INSERT INTO armazenamento_universal
      (chave, tipo_recurso, subtipo, encrypted, algorithm, iv, auth_tag, payload_base64, metadata_json, supabase_bucket, supabase_path, criado_por_id, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, NOW())
    ON CONFLICT (chave)
    DO UPDATE SET
      tipo_recurso = EXCLUDED.tipo_recurso,
      subtipo = EXCLUDED.subtipo,
      encrypted = EXCLUDED.encrypted,
      algorithm = EXCLUDED.algorithm,
      iv = EXCLUDED.iv,
      auth_tag = EXCLUDED.auth_tag,
      payload_base64 = EXCLUDED.payload_base64,
      metadata_json = EXCLUDED.metadata_json,
      supabase_bucket = EXCLUDED.supabase_bucket,
      supabase_path = EXCLUDED.supabase_path,
      criado_por_id = EXCLUDED.criado_por_id,
      atualizado_em = NOW()
    RETURNING id, chave, tipo_recurso, subtipo, encrypted, algorithm, metadata_json, supabase_bucket, supabase_path, criado_em, atualizado_em
    `,
    [
      chave,
      tipoRecurso,
      subtipo || null,
      encrypted.encrypted,
      encrypted.algorithm,
      encrypted.iv,
      encrypted.authTag,
      encrypted.payload,
      JSON.stringify(metadata || {}),
      bucket || null,
      bucketPath || null,
      userId || null
    ]
  );

  return rows[0];
}

async function trySaveUniversalArchive(entry) {
  try {
    return await saveUniversalArchive(entry);
  } catch (error) {
    console.warn('Falha ao salvar no armazenamento universal:', error.message);
    return null;
  }
}

async function uploadBufferToSupabaseStorage({ bucket, path: storagePath, buffer, contentType, cacheControl }) {
  if (!supabaseStorageClient) {
    return null;
  }

  const uploadResult = await supabaseStorageClient.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType,
      cacheControl: cacheControl || '3600',
      upsert: true
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const { data } = supabaseStorageClient.storage.from(bucket).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

function safeJsonParse(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

const sendHtml = (res, fileName) => {
  res.sendFile(path.join(FRONTEND_HTML_DIR, fileName));
};

const normalizeAnswer = (value) => String(value || '').trim().toLowerCase();

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookieHeader = req.headers.cookie || '';
  const tokenCookie = cookieHeader
    .split(';')
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith('auth_token='));

  if (!tokenCookie) {
    return null;
  }

  return decodeURIComponent(tokenCookie.replace('auth_token=', ''));
};

function toNullableTrimmedString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function getWebhookDataId(req) {
  const queryId = toNullableTrimmedString(req.query?.['data.id'] || req.query?.data_id || req.query?.id);
  if (queryId) return queryId;
  return toNullableTrimmedString(req.body?.data?.id || req.body?.id || req.body?.resource?.id);
}

function getWebhookEventKey(req, dataId) {
  const topic = toNullableTrimmedString(req.body?.type || req.query?.type || req.query?.topic || 'unknown');
  const requestId = toNullableTrimmedString(req.headers['x-request-id'] || req.headers['x-idempotency-key'] || 'sem-request-id');
  const safeDataId = dataId || 'sem-data-id';
  return `${topic}:${safeDataId}:${requestId}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function sendApiInternalError(req, res, error, fallbackMessage) {
  const requestId = req?.requestId || createIdempotencyKey();
  const payload = {
    erro: fallbackMessage || 'Erro interno no servidor.',
    request_id: requestId
  };

  if (!isProductionEnv) {
    payload.detalhes = {
      mensagem: String(error?.message || 'erro_desconhecido'),
      codigo: String(error?.code || '') || null
    };
  }

  console.error(`[${requestId}]`, error);
  return res.status(500).json(payload);
}

function redactSensitiveFields(input, depth = 0) {
  if (depth > 3) return '[max_depth]';
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;

  const sensitiveKeys = new Set([
    'senha',
    'password',
    'token',
    'auth_token',
    'authorization',
    'access_token',
    'refresh_token',
    'qr_code',
    'qr_code_base64'
  ]);

  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => redactSensitiveFields(item, depth + 1));
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key).toLowerCase();
    if (sensitiveKeys.has(normalizedKey)) {
      output[key] = '[redacted]';
      continue;
    }
    output[key] = redactSensitiveFields(value, depth + 1);
  }
  return output;
}

function normalizeAcademicRegistration(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidAcademicRegistration(value) {
  const normalized = normalizeAcademicRegistration(value);
  return /^[A-Z0-9]{6,24}$/.test(normalized);
}

async function getUserAcademicRegistrationByUserId(userId) {
  const directResult = await pool.query(
    `
    SELECT ra_codigo
    FROM usuario_registros_academicos
    WHERE usuario_id = $1
      AND status = 'ativo'
    LIMIT 1
    `,
    [userId]
  );
  const directRa = normalizeAcademicRegistration(directResult.rows[0]?.ra_codigo || '');
  if (directRa) return directRa;

  const fallbackResult = await pool.query(
    `
    SELECT i.ra_codigo
    FROM usuarios u
    LEFT JOIN inscricoes i ON i.email = u.email
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );
  return normalizeAcademicRegistration(fallbackResult.rows[0]?.ra_codigo || '');
}

async function searchGoogleBooks(query) {
  const apiKey = String(process.env.GOOGLE_BOOKS_API_KEY || '').trim();
  const keyQuery = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10${keyQuery}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.slice(0, 10).map((item) => ({
    fonte: 'google_books',
    id_externo: item.id || null,
    titulo: item?.volumeInfo?.title || 'Sem titulo',
    autores: item?.volumeInfo?.authors || [],
    descricao: item?.volumeInfo?.description || '',
    url: item?.volumeInfo?.infoLink || null,
    capa: item?.volumeInfo?.imageLinks?.thumbnail || null
  }));
}

function getGoogleOAuthClientOrThrow() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google OAuth incompleto. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN.');
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

function isGoogleDriveStorageAvailable() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);
}

function sanitizeStorageFileName(fileName) {
  return String(fileName || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 140) || `arquivo-${Date.now()}`;
}

async function uploadBufferToGoogleDrive({ buffer, fileName, mimeType, folderId = null }) {
  const auth = getGoogleOAuthClientOrThrow();
  const drive = google.drive({ version: 'v3', auth });

  const upload = await drive.files.create({
    requestBody: {
      name: sanitizeStorageFileName(fileName),
      mimeType: String(mimeType || 'application/octet-stream'),
      parents: folderId ? [String(folderId)] : undefined
    },
    media: {
      mimeType: String(mimeType || 'application/octet-stream'),
      body: Readable.from(buffer)
    },
    fields: 'id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime'
  });

  const file = upload?.data || {};
  return {
    provider: 'google_drive',
    id: file.id ? String(file.id) : null,
    publicUrl: file.webViewLink || file.webContentLink || (file.id ? `https://drive.google.com/file/d/${file.id}/view` : null),
    path: file.id ? `google-drive:${file.id}` : null,
    metadata: {
      mime_type: file.mimeType || mimeType || null,
      size: file.size ? Number(file.size) : null,
      created_time: file.createdTime || null,
      modified_time: file.modifiedTime || null
    }
  };
}

function normalizeGoogleDriveMimeType(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (!value) return 'arquivo';
  if (value.includes('folder')) return 'pasta';
  if (value.includes('document')) return 'documento';
  if (value.includes('presentation')) return 'apresentacao';
  if (value.includes('spreadsheet')) return 'planilha';
  if (value.includes('pdf')) return 'pdf';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (value.startsWith('image/')) return 'imagem';
  return 'arquivo';
}

async function searchGoogleDriveFiles({ query, limit = 20, folderId = null }) {
  const auth = getGoogleOAuthClientOrThrow();
  const drive = google.drive({ version: 'v3', auth });

  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const searchQuery = String(query || '').trim();
  const qParts = ["trashed = false"];

  if (searchQuery) {
    qParts.push(`name contains '${searchQuery.replace(/'/g, "\\'")}'`);
  }
  if (folderId) {
    qParts.push(`'${String(folderId).replace(/'/g, "\\'")}' in parents`);
  }

  const response = await drive.files.list({
    pageSize: safeLimit,
    q: qParts.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink,webContentLink,createdTime,modifiedTime,size,owners(displayName,emailAddress))',
    orderBy: 'modifiedTime desc'
  });

  const files = Array.isArray(response?.data?.files) ? response.data.files : [];
  return files.map((file) => ({
    fonte: 'google_drive',
    id_externo: file.id ? String(file.id) : null,
    titulo: file.name || 'Sem titulo',
    tipo_recurso: normalizeGoogleDriveMimeType(file.mimeType),
    categoria: 'google-drive',
    descricao: `Arquivo Google Drive (${file.mimeType || 'desconhecido'})`,
    url_recurso: file.webViewLink || file.webContentLink || (file.id ? `https://drive.google.com/file/d/${file.id}/view` : null),
    metadata: {
      mime_type: file.mimeType || null,
      created_time: file.createdTime || null,
      modified_time: file.modifiedTime || null,
      size: file.size ? Number(file.size) : null,
      owners: Array.isArray(file.owners) ? file.owners : []
    }
  }));
}

async function listGoogleClassroomCourses({ limit = 30 }) {
  const auth = getGoogleOAuthClientOrThrow();
  const classroom = google.classroom({ version: 'v1', auth });
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));

  const response = await classroom.courses.list({
    teacherId: 'me',
    pageSize: safeLimit,
    courseStates: ['ACTIVE', 'PROVISIONED']
  });

  const courses = Array.isArray(response?.data?.courses) ? response.data.courses : [];
  return courses.map((course) => ({
    id: course.id ? String(course.id) : null,
    nome: course.name || 'Curso sem nome',
    secao: course.section || null,
    descricao: course.descriptionHeading || course.description || null,
    sala: course.room || null,
    status: course.courseState || null,
    alternate_link: course.alternateLink || null,
    created_at: course.creationTime || null,
    updated_at: course.updateTime || null
  }));
}

async function listGoogleClassroomCoursework({ courseId, limit = 30 }) {
  const auth = getGoogleOAuthClientOrThrow();
  const classroom = google.classroom({ version: 'v1', auth });
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));

  const response = await classroom.courses.courseWork.list({
    courseId: String(courseId),
    pageSize: safeLimit,
    orderBy: 'updateTime desc'
  });

  const work = Array.isArray(response?.data?.courseWork) ? response.data.courseWork : [];
  return work.map((item) => ({
    fonte: 'google_classroom',
    id_externo: item.id ? String(item.id) : null,
    titulo: item.title || 'Atividade sem titulo',
    tipo_recurso: 'texto',
    categoria: 'google-classroom',
    descricao: item.description || null,
    url_recurso: item.alternateLink || null,
    metadata: {
      course_id: String(courseId),
      state: item.state || null,
      work_type: item.workType || null,
      due_date: item.dueDate || null,
      due_time: item.dueTime || null,
      updated_time: item.updateTime || null
    }
  }));
}

async function importBibliotecaResources({ userId, items, gratuito = true }) {
  const imported = [];
  const skipped = [];

  for (const item of items) {
    const titulo = String(item?.titulo || '').trim();
    const urlRecurso = String(item?.url_recurso || '').trim();
    const fonte = String(item?.fonte || 'externo').trim().toLowerCase();
    const tipoRecurso = String(item?.tipo_recurso || 'outro').trim().toLowerCase();
    const categoria = String(item?.categoria || '').trim() || null;
    const descricao = String(item?.descricao || '').trim() || null;

    if (!titulo || !urlRecurso) {
      skipped.push({ titulo, motivo: 'titulo_ou_url_ausente' });
      continue;
    }

    const existingResult = await pool.query(
      `
      SELECT id
      FROM biblioteca_recursos
      WHERE fonte = $1
        AND url_recurso = $2
      LIMIT 1
      `,
      [fonte, urlRecurso]
    );

    if (existingResult.rows.length) {
      skipped.push({ titulo, motivo: 'ja_existente', id: existingResult.rows[0].id });
      continue;
    }

    const insertResult = await pool.query(
      `
      INSERT INTO biblioteca_recursos
        (titulo, tipo_recurso, categoria, descricao, url_recurso, fonte, gratuito, status, adicionado_por_id, criado_em, atualizado_em)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'ativo', $8, NOW(), NOW())
      RETURNING *
      `,
      [titulo, tipoRecurso, categoria, descricao, urlRecurso, fonte, gratuito, userId]
    );

    const row = insertResult.rows[0];
    await trySaveUniversalArchive({
      chave: `biblioteca:transicao:${fonte}:${item.id_externo || row.id}`,
      tipoRecurso: 'biblioteca',
      subtipo: 'transicao_google',
      payload: {
        recurso: row,
        origem: item
      },
      metadata: {
        origem: 'importacao_google',
        fonte,
        id_externo: item.id_externo || null,
        sem_duplicar_binario: true,
        estrategia_espaco: 'link-first'
      },
      userId,
      bucket: SUPABASE_STORAGE_BUCKET || null,
      bucketPath: null
    });

    imported.push(row);
  }

  return { imported, skipped };
}

async function searchOpenLibrary(query) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  const docs = Array.isArray(payload?.docs) ? payload.docs : [];
  return docs.slice(0, 10).map((doc) => ({
    fonte: 'open_library',
    id_externo: doc?.key || null,
    titulo: doc?.title || 'Sem titulo',
    autores: Array.isArray(doc?.author_name) ? doc.author_name : [],
    descricao: '',
    url: doc?.key ? `https://openlibrary.org${doc.key}` : null,
    capa: doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null
  }));
}

function buildPublicLibraryLinks(query) {
  const encoded = encodeURIComponent(query);
  return [
    {
      fonte: 'google_play_livros',
      id_externo: null,
      titulo: `Google Play Livros: ${query}`,
      autores: [],
      descricao: 'Busca externa para leitura/aquisicao legal no Google Play Livros.',
      url: `https://play.google.com/store/search?q=${encoded}&c=books`,
      capa: null
    },
    {
      fonte: 'kindle_store',
      id_externo: null,
      titulo: `Kindle Store: ${query}`,
      autores: [],
      descricao: 'Busca externa para leitura/aquisicao legal no Kindle Store.',
      url: `https://www.amazon.com.br/s?k=${encoded}&i=digital-text`,
      capa: null
    },
    {
      fonte: 'e_livros_info',
      id_externo: null,
      titulo: `e-livros.info: ${query}`,
      autores: [],
      descricao: 'Acesso externo sujeito a direitos autorais, termos do site e legislacao aplicavel.',
      url: `https://www.e-livros.info/?s=${encoded}`,
      capa: null
    }
  ];
}

function normalizeLiveProvider(value) {
  const normalized = String(value || 'interno').trim().toLowerCase();
  if (['interno', 'zoom', 'google_meet', 'microsoft_teams'].includes(normalized)) {
    return normalized;
  }
  return 'interno';
}

function buildInternalLiveLink() {
  return `/live/sala/${crypto.randomBytes(12).toString('hex')}`;
}

async function createZoomMeeting({ title, startDate, endDate }) {
  const token = String(process.env.ZOOM_SERVER_TO_SERVER_OAUTH_TOKEN || '').trim();
  if (!token) {
    throw new Error('Zoom token nao configurado.');
  }

  const start = startDate || new Date(Date.now() + 10 * 60 * 1000);
  const end = endDate || new Date(start.getTime() + 60 * 60 * 1000);
  const duration = Math.max(15, Math.ceil((end.getTime() - start.getTime()) / 60000));

  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic: title || 'Aula Ordo Caoti',
      type: 2,
      start_time: start.toISOString(),
      duration,
      timezone: 'America/Sao_Paulo',
      settings: {
        waiting_room: true,
        join_before_host: false,
        mute_upon_entry: true
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.join_url) {
    throw new Error(data?.message || 'Falha ao criar reuniao Zoom.');
  }

  return {
    provider: 'zoom',
    link: data.join_url,
    externalId: data.id ? String(data.id) : null,
    details: data
  };
}

async function createTeamsMeeting({ title, startDate, endDate }) {
  const token = String(process.env.MICROSOFT_GRAPH_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new Error('Microsoft Graph token nao configurado.');
  }

  const start = startDate || new Date(Date.now() + 10 * 60 * 1000);
  const end = endDate || new Date(start.getTime() + 60 * 60 * 1000);

  const response = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subject: title || 'Aula Ordo Caoti',
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString()
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.joinWebUrl) {
    throw new Error(data?.error?.message || 'Falha ao criar reuniao Teams.');
  }

  return {
    provider: 'microsoft_teams',
    link: data.joinWebUrl,
    externalId: data.id ? String(data.id) : null,
    details: data
  };
}

async function createGoogleMeetMeeting({ title, startDate, endDate }) {
  const start = startDate || new Date(Date.now() + 10 * 60 * 1000);
  const end = endDate || new Date(start.getTime() + 60 * 60 * 1000);

  const eventPayload = {
    summary: title || 'Aula Ordo Caoti',
    start: { dateTime: start.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
    conferenceData: {
      createRequest: {
        requestId: createIdempotencyKey(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  };

  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      conferenceDataVersion: 1,
      requestBody: eventPayload
    });

    const data = response?.data || {};
    const link = data?.hangoutLink || data?.conferenceData?.entryPoints?.[0]?.uri || null;
    if (!link) {
      throw new Error('Google Meet retornou evento sem link de conferencia.');
    }

    return {
      provider: 'google_meet',
      link,
      externalId: data?.id ? String(data.id) : null,
      details: data
    };
  }

  if (!GOOGLE_CALENDAR_ACCESS_TOKEN) {
    throw new Error('Google Meet nao configurado. Use GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN ou GOOGLE_CALENDAR_ACCESS_TOKEN.');
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventPayload)
    }
  );

  const data = await response.json().catch(() => ({}));
  const link = data?.hangoutLink || data?.conferenceData?.entryPoints?.[0]?.uri || null;
  if (!response.ok || !link) {
    throw new Error(data?.error?.message || 'Falha ao criar reuniao Google Meet.');
  }

  return {
    provider: 'google_meet',
    link,
    externalId: data?.id ? String(data.id) : null,
    details: data
  };
}

async function provisionLiveLink({ provider, title, startDate, endDate }) {
  const normalized = normalizeLiveProvider(provider);
  if (normalized === 'zoom') {
    try {
      return await createZoomMeeting({ title, startDate, endDate });
    } catch (error) {
      return {
        provider: 'interno',
        link: buildInternalLiveLink(),
        externalId: null,
        details: {
          provider_requested: 'zoom',
          fallback_reason: String(error?.message || 'Falha ao provisionar Zoom.')
        }
      };
    }
  }
  if (normalized === 'google_meet') {
    try {
      return await createGoogleMeetMeeting({ title, startDate, endDate });
    } catch (error) {
      return {
        provider: 'interno',
        link: buildInternalLiveLink(),
        externalId: null,
        details: {
          provider_requested: 'google_meet',
          fallback_reason: String(error?.message || 'Falha ao provisionar Google Meet.')
        }
      };
    }
  }
  if (normalized === 'microsoft_teams') {
    try {
      return await createTeamsMeeting({ title, startDate, endDate });
    } catch (error) {
      return {
        provider: 'interno',
        link: buildInternalLiveLink(),
        externalId: null,
        details: {
          provider_requested: 'microsoft_teams',
          fallback_reason: String(error?.message || 'Falha ao provisionar Microsoft Teams.')
        }
      };
    }
  }
  return {
    provider: 'interno',
    link: buildInternalLiveLink(),
    externalId: null,
    details: {}
  };
}

async function sendWhatsAppNotification({ to, message }) {
  const webhookUrl = String(process.env.WHATSAPP_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    throw new Error('WHATSAPP_WEBHOOK_URL nao configurado.');
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.erro || 'Falha no envio WhatsApp.');
  }
  return data;
}

async function sendEmailNotification({ to, subject, message }) {
  // Simulação de envio de e-mail conforme padrão do projeto
  console.log(`\n[EMAIL SIMULADO] Para: ${to}`);
  console.log(`[EMAIL SIMULADO] Assunto: ${subject}`);
  console.log(`[EMAIL SIMULADO] Mensagem: ${message}\n`);
  
  // Aqui futuramente você integrará com Nodemailer ou SendGrid
  return { ok: true };
}

const memoryRateLimitStore = new Map();
const loginFailureStore = new Map();

function getLoginFailureKey(email, ip) {
  return `${String(email || '').trim().toLowerCase()}|${String(ip || '').trim()}`;
}

function cleanupExpiredLoginFailures(now = Date.now()) {
  if (loginFailureStore.size > 10000) {
    for (const [key, value] of loginFailureStore.entries()) {
      if (!value) {
        loginFailureStore.delete(key);
        continue;
      }
      if (now >= (value.expiresAt || 0) && now >= (value.lockedUntil || 0)) {
        loginFailureStore.delete(key);
      }
    }
  }
}

function getLoginFailureState(email, ip) {
  const now = Date.now();
  cleanupExpiredLoginFailures(now);
  const key = getLoginFailureKey(email, ip);
  const state = loginFailureStore.get(key);
  if (!state) return { key, isLocked: false, retryAfterSeconds: 0 };

  if (state.lockedUntil && now < state.lockedUntil) {
    return {
      key,
      isLocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil - now) / 1000))
    };
  }

  if (state.expiresAt && now >= state.expiresAt) {
    loginFailureStore.delete(key);
    return { key, isLocked: false, retryAfterSeconds: 0 };
  }

  return { key, isLocked: false, retryAfterSeconds: 0 };
}

function registerLoginFailure(email, ip) {
  const now = Date.now();
  const key = getLoginFailureKey(email, ip);
  const current = loginFailureStore.get(key);

  if (!current || now >= (current.expiresAt || 0)) {
    loginFailureStore.set(key, {
      attempts: 1,
      expiresAt: now + LOGIN_FAILURE_RULE.windowMs,
      lockedUntil: 0
    });
    return { locked: false, attempts: 1, retryAfterSeconds: 0 };
  }

  const attempts = Number(current.attempts || 0) + 1;
  const nextState = {
    attempts,
    expiresAt: current.expiresAt,
    lockedUntil: current.lockedUntil || 0
  };

  if (attempts >= LOGIN_FAILURE_RULE.maxAttempts) {
    nextState.lockedUntil = now + LOGIN_FAILURE_RULE.lockMs;
  }

  loginFailureStore.set(key, nextState);
  const retryAfterSeconds =
    nextState.lockedUntil && now < nextState.lockedUntil
      ? Math.max(1, Math.ceil((nextState.lockedUntil - now) / 1000))
      : 0;

  return {
    locked: retryAfterSeconds > 0,
    attempts,
    retryAfterSeconds
  };
}

function clearLoginFailures(email, ip) {
  const key = getLoginFailureKey(email, ip);
  loginFailureStore.delete(key);
}

function createMemoryRateLimiter(rule) {
  return (req, res, next) => {
    const now = Date.now();
    if (memoryRateLimitStore.size > 5000) {
      for (const [staleKey, value] of memoryRateLimitStore.entries()) {
        if (!value || now >= value.resetAt) {
          memoryRateLimitStore.delete(staleKey);
        }
      }
    }

    const ip = getClientIp(req) || 'unknown-ip';
    const key = `${rule.keyPrefix}:${ip}`;
    const current = memoryRateLimitStore.get(key);

    if (!current || now >= current.resetAt) {
      memoryRateLimitStore.set(key, {
        count: 1,
        resetAt: now + rule.windowMs
      });
      return next();
    }

    current.count += 1;
    memoryRateLimitStore.set(key, current);

    if (current.count > rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        erro: 'Muitas requisicoes. Tente novamente em instantes.',
        retry_after_seconds: retryAfterSeconds
      });
    }

    return next();
  };
}

const loginRateLimiter = createMemoryRateLimiter(RATE_LIMIT_RULES.login);
const passwordRecoveryRateLimiter = createMemoryRateLimiter(RATE_LIMIT_RULES.passwordRecovery);
const passwordResetRateLimiter = createMemoryRateLimiter(RATE_LIMIT_RULES.passwordReset);
const webhookRateLimiter = createMemoryRateLimiter(RATE_LIMIT_RULES.webhook);
const globalTrafficRateLimiter = createMemoryRateLimiter(RATE_LIMIT_RULES.globalTraffic);

app.use((req, res, next) => {
  if (
    req.path.startsWith('/css/')
    || req.path.startsWith('/js/')
    || req.path.startsWith('/img/')
    || req.path.startsWith('/i18n/')
    || req.path.startsWith('/frontend/')
    || req.path.startsWith('/uploads/')
  ) {
    return next();
  }
  return globalTrafficRateLimiter(req, res, next);
});

function mapPedidoStatusToAssinaturaStatus(pedidoStatus) {
  const normalized = String(pedidoStatus || '').trim().toLowerCase();
  if (normalized === 'pago') return 'ativa';
  if (normalized === 'cancelado') return 'cancelada';
  return 'pendente';
}

async function upsertAssinaturaFromPedido({ pedidoId, pedidoStatus, valorMensal }) {
  if (!pedidoId) return;

  const assinaturaStatus = mapPedidoStatusToAssinaturaStatus(pedidoStatus);
  const inicio = assinaturaStatus === 'ativa' ? new Date() : null;
  const proximaCobranca =
    assinaturaStatus === 'ativa' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;

  await pool.query(
    `
    INSERT INTO usuario_assinaturas
      (usuario_id, plano_codigo, status, valor_mensal, moeda, ciclo_dias, inicio_em, proxima_cobranca_em, origem_pedido_id, atualizado_em)
    SELECT
      p.usuario_id,
      'membro_base',
      $2,
      $3,
      'BRL',
      30,
      $4,
      $5,
      p.id,
      NOW()
    FROM pedidos p
    WHERE p.id = $1
    ON CONFLICT (usuario_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      valor_mensal = EXCLUDED.valor_mensal,
      inicio_em = COALESCE(EXCLUDED.inicio_em, usuario_assinaturas.inicio_em),
      proxima_cobranca_em = EXCLUDED.proxima_cobranca_em,
      origem_pedido_id = EXCLUDED.origem_pedido_id,
      atualizado_em = NOW()
    `,
    [pedidoId, assinaturaStatus, Number(valorMensal || 0), inicio, proximaCobranca]
  );
}

const MATERIAL_FILE_RULES = {
  video: {
    exts: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
    mimePrefixes: ['video/']
  },
  foto: {
    exts: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimePrefixes: ['image/']
  },
  texto: {
    exts: ['.txt', '.md', '.pdf', '.doc', '.docx', '.odt'],
    mimeExact: [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text'
    ],
    mimePrefixes: ['text/']
  },
  arquivo: {
    exts: ['.pdf', '.doc', '.docx', '.odt', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar', '.7z', '.txt', '.csv'],
    mimeExact: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'text/plain',
      'text/csv'
    ],
    mimePrefixes: ['application/', 'text/']
  }
};

function isFileAllowedByRule(file, rule) {
  if (!file || !rule) return false;

  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();

  const extOk = rule.exts.includes(ext);
  const exactOk = rule.mimeExact ? rule.mimeExact.includes(mime) : false;
  const prefixOk = rule.mimePrefixes ? rule.mimePrefixes.some((prefix) => mime.startsWith(prefix)) : false;

  return extOk && (exactOk || prefixOk);
}

function validateMaterialPayload(tipoMaterial, file, conteudoTexto) {
  if (!['video', 'foto', 'texto', 'arquivo'].includes(tipoMaterial)) {
    return { ok: false, erro: 'tipo_material invalido.' };
  }

  const precisaArquivo = ['video', 'foto', 'arquivo'].includes(tipoMaterial);
  if (precisaArquivo && !file) {
    return { ok: false, erro: 'Arquivo obrigatorio para este tipo de material.' };
  }

  if (tipoMaterial === 'texto' && !file && !String(conteudoTexto || '').trim()) {
    return { ok: false, erro: 'Material de texto exige conteudo digitado ou arquivo anexado.' };
  }

  if (file) {
    const rule = MATERIAL_FILE_RULES[tipoMaterial];
    if (!isFileAllowedByRule(file, rule)) {
      return { ok: false, erro: 'Tipo de arquivo ou extensao invalida para o tipo de material.' };
    }
  }

  return { ok: true };
}

const requireAdmin = (req, res, next) => {
  if (req.user?.tipo_usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado. Perfil admin obrigatorio.' });
  }
  next();
};

const requireFounderSupremo = (req, res, next) => {
  if (req.user?.tipo_usuario !== 'admin' || req.user?.is_founder !== true) {
    return res.status(403).json({
      erro: 'Acesso restrito a Area Suprema dos Mestres Fundadores.'
    });
  }
  next();
};

const requireLojista = (req, res, next) => {
  const nivelCodigo = normalizeNivelCodigo(req.user?.nivel?.nivel_codigo || 'neofito');
  const isPrivileged = ['admin', 'ti'].includes(req.user?.tipo_usuario);

  if (!isPrivileged && !canUseLojistaProfileByNivel(nivelCodigo)) {
    return res.status(403).json({ erro: 'Perfil lojista exige nivel minimo mago_n1.' });
  }

  if (!req.user?.roles.includes('lojista') && !['admin', 'ti'].includes(req.user?.tipo_usuario)) {
    return res.status(403).json({ erro: 'Acesso negado. Perfil lojista obrigatorio.' });
  }
  next();
};

const requireProfessor = async (req, res, next) => {
  if (req.user?.tipo_usuario !== 'professor') {
    return res.status(403).json({ erro: 'Acesso negado. Perfil professor obrigatorio.' });
  }

  const nivelCodigo = normalizeNivelCodigo(req.user?.nivel?.nivel_codigo);
  if (requiresProfessorAuthorizationByNivel(nivelCodigo)) {
    const status = await getProfessorAuthorizationStatus(req.user.id);
    if (!(status.has_admin && status.has_sabio && status.has_fundador)) {
      return res.status(403).json({
        erro: 'Perfil professor pendente de autorizacao completa (admin + sabio + fundador).',
        autorizacao_professor: status
      });
    }
  }

  next();
};

const requireAluno = (req, res, next) => {
  if (req.user?.tipo_usuario !== 'aluno') {
    return res.status(403).json({ erro: 'Acesso negado. Perfil aluno obrigatorio.' });
  }
  next();
};

const requireProfessorOrAdmin = async (req, res, next) => {
  if (!['professor', 'admin'].includes(req.user?.tipo_usuario)) {
    return res.status(403).json({ erro: 'Acesso negado. Perfil professor ou admin obrigatorio.' });
  }

  if (req.user?.tipo_usuario === 'professor') {
    const nivelCodigo = normalizeNivelCodigo(req.user?.nivel?.nivel_codigo);
    if (requiresProfessorAuthorizationByNivel(nivelCodigo)) {
      const status = await getProfessorAuthorizationStatus(req.user.id);
      if (!(status.has_admin && status.has_sabio && status.has_fundador)) {
        return res.status(403).json({
          erro: 'Perfil professor pendente de autorizacao completa (admin + sabio + fundador).',
          autorizacao_professor: status
        });
      }
    }
  }

  next();
};

const requireAdminOrTi = (req, res, next) => {
  if (!['admin', 'ti'].includes(req.user?.tipo_usuario)) {
    return res.status(403).json({ erro: 'Acesso negado. Perfil admin ou ti obrigatorio.' });
  }
  next();
};

function hasAuditViewPermission(user) {
  if (!user) return false;
  if (['admin', 'ti'].includes(user.tipo_usuario)) return true;
  if (isFounderEmail(user.email)) return true;
  if (isSageEmail(user.email)) return true;
  if (isNivelAtLeast(user?.nivel?.nivel_codigo, 'sabio')) return true;
  if (Array.isArray(user.roles) && user.roles.some((role) => ['sabio', 'mestre'].includes(role))) return true;
  return false;
}

const requireAuditoria = (req, res, next) => {
  if (!hasAuditViewPermission(req.user)) {
    return res.status(403).json({ erro: 'Acesso negado. Perfil auditor obrigatorio.' });
  }
  next();
};

const PERFIS_HIERARQUIA = [
  'neofito',
  'mago_n1',
  'mago_n2',
  'mago_n3',
  'mentor',
  'sabio',
  'mestre',
  'ti'
];

const PAPEIS_SISTEMA = ['aluno', 'professor', 'admin', 'lojista', 'ti', 'mentor', 'sabio', 'mestre'];

const DEFAULT_ROLE_PERMISSIONS = {
  aluno: [
    'dashboard.aluno.ver',
    'aluno.turmas.ver',
    'aluno.materias.ver',
    'aluno.financeiro.ver',
    'aluno.faltas.justificar',
    'aluno.live.entrar'
  ],
  professor: [
    'dashboard.professor.ver',
    'professor.materias.ver',
    'professor.materiais.publicar',
    'professor.avaliacoes.criar',
    'professor.live.gerir',
    'professor.faltas.aprovar'
  ],
  admin: [
    'dashboard.admin.ver',
    'admin.inscricoes.aprovar',
    'admin.financeiro.gerir',
    'admin.moderacao.gerir',
    'admin.live.aprovar_agenda',
    'admin.faltas.aprovar',
    'admin.rbac.gerir',
    'admin.manutencao.ver_historico'
  ],
  lojista: [
    'lojista.dashboard.ver',
    'lojista.produtos.gerir',
    'lojista.pedidos.gerir'
  ],
  mentor: [
    'mentor.dashboard.ver',
    'mentor.conteudo.ver',
    'mentor.aulas.ver'
  ],
  sabio: [
    'sabio.dashboard.ver',
    'sabio.inscricoes.reprovar',
    'sabio.materiais.reprovar'
  ],
  mestre: [
    'mestre.dashboard.ver',
    'mestre.admin.parcial.ver'
  ],
  ti: [
    'ti.dashboard.ver',
    'ti.manutencao.gerir',
    'ti.auditoria.ver',
    'ti.sistema.configurar'
  ]
};

async function ensureDisciplineSchema() {
  const query = `
    CREATE TABLE IF NOT EXISTS acoes_disciplinares (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES usuarios(id),
      aplicado_por_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('advertencia', 'suspensao', 'expulsao')),
      motivo TEXT NOT NULL,
      data_inicio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_fim TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('aplicada', 'ativa', 'revogada', 'expirada')),
      revogado_por_id INTEGER REFERENCES usuarios(id),
      revogado_em TIMESTAMP,
      motivo_revogacao TEXT,
      ativo_anterior BOOLEAN,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_acoes_disciplinares_aluno ON acoes_disciplinares(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_acoes_disciplinares_status ON acoes_disciplinares(status);
    ALTER TABLE acoes_disciplinares ADD COLUMN IF NOT EXISTS ativo_anterior BOOLEAN;
  `;

  await pool.query(query);
}

async function ensureAcademicSchema() {
  const query = `
    CREATE TABLE IF NOT EXISTS materias (
      id SERIAL PRIMARY KEY,
      turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES usuarios(id),
      nome VARCHAR(120) NOT NULL,
      descricao TEXT,
      tipo_materia VARCHAR(20) NOT NULL CHECK (tipo_materia IN ('obrigatoria', 'isolada')),
      ativa BOOLEAN NOT NULL DEFAULT true,
      data_criacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS materiais_materia (
      id SERIAL PRIMARY KEY,
      materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
      titulo VARCHAR(180) NOT NULL,
      descricao TEXT,
      tipo_material VARCHAR(20) NOT NULL CHECK (tipo_material IN ('video', 'foto', 'texto', 'arquivo')),
      conteudo_texto TEXT,
      arquivo_url TEXT,
      arquivo_nome VARCHAR(255),
      mime_type VARCHAR(120),
      extensao VARCHAR(20),
      status_moderacao VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status_moderacao IN ('pendente', 'aprovado', 'reprovado')),
      autor_id INTEGER NOT NULL REFERENCES usuarios(id),
      aprovado_por_id INTEGER REFERENCES usuarios(id),
      data_aprovacao TIMESTAMP,
      comentario_moderacao TEXT,
      data_criacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_atualizacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS avaliacoes_v2 (
      id SERIAL PRIMARY KEY,
      materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo_avaliacao VARCHAR(20) NOT NULL CHECK (tipo_avaliacao IN ('teste', 'exercicio', 'avaliacao')),
      titulo VARCHAR(180) NOT NULL,
      descricao TEXT,
      data_limite TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'publicada' CHECK (status IN ('publicada', 'arquivada')),
      data_criacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS avaliacoes_v2_questoes (
      id SERIAL PRIMARY KEY,
      avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes_v2(id) ON DELETE CASCADE,
      enunciado TEXT NOT NULL,
      tipo_questao VARCHAR(20) NOT NULL CHECK (tipo_questao IN ('objetiva', 'discursiva')),
      opcoes_json JSONB,
      resposta_correta TEXT,
      peso DECIMAL(6,2) NOT NULL DEFAULT 1.00,
      ordem INTEGER,
      data_criacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS avaliacoes_v2_submissoes (
      id SERIAL PRIMARY KEY,
      avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes_v2(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES usuarios(id),
      status VARCHAR(20) NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada', 'corrigida')),
      nota_objetiva DECIMAL(6,2),
      nota_discursiva DECIMAL(6,2),
      nota_final DECIMAL(6,2),
      feedback_geral TEXT,
      corrigido_por_id INTEGER REFERENCES usuarios(id),
      data_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_correcao TIMESTAMP,
      UNIQUE(avaliacao_id, aluno_id)
    );

    CREATE TABLE IF NOT EXISTS avaliacoes_v2_respostas (
      id SERIAL PRIMARY KEY,
      submissao_id INTEGER NOT NULL REFERENCES avaliacoes_v2_submissoes(id) ON DELETE CASCADE,
      questao_id INTEGER NOT NULL REFERENCES avaliacoes_v2_questoes(id) ON DELETE CASCADE,
      resposta_texto TEXT,
      correta BOOLEAN,
      nota_discursiva DECIMAL(6,2),
      comentario_professor TEXT,
      UNIQUE(submissao_id, questao_id)
    );

    CREATE INDEX IF NOT EXISTS idx_materias_turma ON materias(turma_id);
    CREATE INDEX IF NOT EXISTS idx_materias_professor ON materias(professor_id);
    CREATE INDEX IF NOT EXISTS idx_materiais_materia_status ON materiais_materia(materia_id, status_moderacao);
    CREATE INDEX IF NOT EXISTS idx_avaliacoes_v2_materia ON avaliacoes_v2(materia_id);
    CREATE INDEX IF NOT EXISTS idx_avaliacoes_v2_submissoes_aluno ON avaliacoes_v2_submissoes(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_avaliacoes_v2_respostas_submissao ON avaliacoes_v2_respostas(submissao_id);
  `;

  await pool.query(query);
}

async function ensureUserTypeSchema() {
  const query = `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'
      ) THEN
        ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check;
        ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_usuario_check
          CHECK (tipo_usuario IN ('aluno', 'admin', 'professor', 'lojista', 'ti', 'cliente'));
      END IF;
    END
    $$;
  `;

  await pool.query(query);
}

async function ensurePlatformSchema() {
  const query = `
    CREATE TABLE IF NOT EXISTS papel_permissoes (
      id SERIAL PRIMARY KEY,
      papel VARCHAR(30) NOT NULL,
      permissao VARCHAR(120) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(papel, permissao)
    );

    CREATE TABLE IF NOT EXISTS usuario_papeis (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      papel VARCHAR(30) NOT NULL,
      concedido_por_id INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, papel)
    );

    CREATE TABLE IF NOT EXISTS usuario_identidades_oauth (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      provedor VARCHAR(20) NOT NULL CHECK (provedor IN ('google', 'apple')),
      assunto_provedor VARCHAR(255) NOT NULL,
      email_verificado VARCHAR(180),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ultimo_login_em TIMESTAMP,
      UNIQUE(provedor, assunto_provedor),
      UNIQUE(usuario_id, provedor)
    );

    CREATE TABLE IF NOT EXISTS usuario_niveis (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      nivel_codigo VARCHAR(30) NOT NULL DEFAULT 'neofito',
      observacao TEXT,
      atualizado_por_id INTEGER REFERENCES usuarios(id),
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id)
    );

    CREATE TABLE IF NOT EXISTS ranking_snapshots (
      id SERIAL PRIMARY KEY,
      tipo_ranking VARCHAR(50) NOT NULL,
      referencia VARCHAR(80),
      dados_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS aulas_ao_vivo (
      id SERIAL PRIMARY KEY,
      turma_id INTEGER REFERENCES turmas(id),
      materia_id INTEGER REFERENCES materias(id),
      criado_por_id INTEGER REFERENCES usuarios(id),
      professor_id INTEGER REFERENCES usuarios(id),
      titulo VARCHAR(180) NOT NULL,
      descricao TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('rascunho', 'pendente', 'aprovada', 'rejeitada', 'agendada', 'ao_vivo', 'encerrada', 'cancelada', 'realizada')),
      inicio_previsto TIMESTAMP,
      fim_previsto TIMESTAMP,
      inicio_real TIMESTAMP,
      fim_real TIMESTAMP,
      duracao_segundos INTEGER,
      precisa_aprovacao BOOLEAN NOT NULL DEFAULT true,
      aprovado_por_id INTEGER REFERENCES usuarios(id),
      aprovado_em TIMESTAMP,
      motivo_rejeicao TEXT,
      link_sala TEXT,
      conteudo_aprovado BOOLEAN NOT NULL DEFAULT false,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS aula_participantes (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      papel_na_aula VARCHAR(20) NOT NULL DEFAULT 'aluno'
        CHECK (papel_na_aula IN ('professor', 'aluno', 'admin', 'ti', 'sabio', 'mentor')),
      entrou_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      saiu_em TIMESTAMP,
      microfone_liberado BOOLEAN NOT NULL DEFAULT true,
      camera_liberada BOOLEAN NOT NULL DEFAULT true,
      tela_liberada BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(aula_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS aula_chat_msgs (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      mensagem TEXT NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS aula_lousa_eventos (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      tipo_evento VARCHAR(40) NOT NULL,
      dados_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS aula_gravacoes (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      arquivo_url TEXT,
      titulo VARCHAR(180),
      descricao TEXT,
      inicio_real TIMESTAMP,
      fim_real TIMESTAMP,
      duracao_segundos INTEGER,
      status_legenda VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status_legenda IN ('pendente', 'aprovada', 'reprovada')),
      legenda_texto TEXT,
      legenda_aprovada_por_id INTEGER REFERENCES usuarios(id),
      legenda_aprovada_em TIMESTAMP,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS aula_presencas (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      presenca_status VARCHAR(20) NOT NULL DEFAULT 'falta'
        CHECK (presenca_status IN ('presente', 'falta', 'justificada', 'abonada')),
      computado_por_id INTEGER REFERENCES usuarios(id),
      motivo TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(aula_id, aluno_id)
    );

    CREATE TABLE IF NOT EXISTS faltas_justificativas (
      id SERIAL PRIMARY KEY,
      presenca_id INTEGER NOT NULL REFERENCES aula_presencas(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      tipo_justificativa VARCHAR(20) NOT NULL CHECK (tipo_justificativa IN ('atestado', 'motivo', 'ambos')),
      texto_motivo TEXT,
      atestado_url TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'em_analise', 'aprovado_duplo', 'reprovado')),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS faltas_aprovacoes (
      id SERIAL PRIMARY KEY,
      justificativa_id INTEGER NOT NULL REFERENCES faltas_justificativas(id) ON DELETE CASCADE,
      aprovador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      papel_aprovador VARCHAR(20) NOT NULL CHECK (papel_aprovador IN ('professor', 'admin')),
      decisao VARCHAR(20) NOT NULL CHECK (decisao IN ('aprovado', 'reprovado')),
      comentario TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(justificativa_id, papel_aprovador)
    );

    CREATE TABLE IF NOT EXISTS aula_replay_progresso (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      progresso_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      ultimo_segundo INTEGER NOT NULL DEFAULT 0,
      assistido_completo BOOLEAN NOT NULL DEFAULT false,
      bloqueado_por_seek BOOLEAN NOT NULL DEFAULT false,
      velocidade_atual NUMERIC(4,2) NOT NULL DEFAULT 1.0,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(aula_id, aluno_id)
    );

    CREATE TABLE IF NOT EXISTS aula_legendas (
      id SERIAL PRIMARY KEY,
      aula_id INTEGER NOT NULL REFERENCES aulas_ao_vivo(id) ON DELETE CASCADE,
      texto_transcrito TEXT,
      texto_revisado TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'reprovada')),
      aprovado_por_id INTEGER REFERENCES usuarios(id),
      aprovado_em TIMESTAMP,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(aula_id)
    );

    CREATE TABLE IF NOT EXISTS inscricao_tentativas (
      id SERIAL PRIMARY KEY,
      inscricao_id INTEGER REFERENCES inscricoes(id) ON DELETE SET NULL,
      email VARCHAR(100) NOT NULL,
      nome VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'pendente',
      data_tentativa TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      observacao TEXT
    );

    CREATE TABLE IF NOT EXISTS candidato_acompanhamento (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL,
      token_acompanhamento VARCHAR(120) UNIQUE NOT NULL,
      status_atual VARCHAR(30) NOT NULL DEFAULT 'em_analise',
      ra_codigo VARCHAR(40),
      tentativas_total INTEGER NOT NULL DEFAULT 0,
      ultima_atualizacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS ra_codigo VARCHAR(40);
    ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS data_reprovacao TIMESTAMP;

    CREATE TABLE IF NOT EXISTS manutencoes (
      id SERIAL PRIMARY KEY,
      criado_por_id INTEGER REFERENCES usuarios(id),
      titulo VARCHAR(180) NOT NULL,
      descricao TEXT NOT NULL,
      motivo TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
      inicio_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      previsao_retorno_em TIMESTAMP,
      encerrada_em TIMESTAMP,
      motivo_extensao TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS manutencao_alvos (
      id SERIAL PRIMARY KEY,
      manutencao_id INTEGER NOT NULL REFERENCES manutencoes(id) ON DELETE CASCADE,
      rota_alvo VARCHAR(255) NOT NULL,
      html_alvo VARCHAR(255),
      UNIQUE(manutencao_id, rota_alvo)
    );

    CREATE TABLE IF NOT EXISTS carrinhos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
      moeda VARCHAR(10) NOT NULL DEFAULT 'BRL',
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS carrinho_itens (
      id SERIAL PRIMARY KEY,
      carrinho_id INTEGER NOT NULL REFERENCES carrinhos(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      tipo_item VARCHAR(20) NOT NULL DEFAULT 'produto' CHECK (tipo_item IN ('produto', 'servico')),
      quantidade INTEGER NOT NULL DEFAULT 1,
      preco_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
      descricao_servico TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pedidos_entrega (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      tipo_frete VARCHAR(60),
      servico_frete VARCHAR(120),
      codigo_rastreio VARCHAR(120),
      endereco_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status_entrega VARCHAR(30) NOT NULL DEFAULT 'preparando',
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS frete_cotacoes (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      provedor VARCHAR(80) NOT NULL,
      servico VARCHAR(80),
      valor DECIMAL(12,2) NOT NULL DEFAULT 0,
      prazo_dias INTEGER,
      moeda VARCHAR(10) NOT NULL DEFAULT 'BRL',
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pagamentos_transacoes (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      metodo VARCHAR(40) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pendente',
      valor DECIMAL(12,2) NOT NULL DEFAULT 0,
      moeda VARCHAR(10) NOT NULL DEFAULT 'BRL',
      comprovante_url TEXT,
      data_pagamento_agendada DATE,
      hash_referencia VARCHAR(120),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS payment_id VARCHAR(120);
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mercado_external_reference VARCHAR(120);
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS mercado_order_id VARCHAR(120);
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS mercado_transaction_id VARCHAR(120);
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS mercado_status VARCHAR(60);
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS detalhes_gateway JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE pagamentos_transacoes ADD COLUMN IF NOT EXISTS ultima_atualizacao_gateway TIMESTAMP;
    ALTER TABLE aulas_ao_vivo ADD COLUMN IF NOT EXISTS provedor_sala VARCHAR(30) NOT NULL DEFAULT 'interno';
    ALTER TABLE aulas_ao_vivo ADD COLUMN IF NOT EXISTS sala_externa_id VARCHAR(120);
    ALTER TABLE aulas_ao_vivo ADD COLUMN IF NOT EXISTS detalhes_provedor_json JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS vendedor_produtos (
      id SERIAL PRIMARY KEY,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      vendedor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(produto_id, vendedor_id)
    );

    CREATE TABLE IF NOT EXISTS pedido_solicitacoes (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('reembolso', 'troca', 'cancelamento')),
      motivo TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'cancelada')),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pagamento_preferencias (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      dia_pagamento INTEGER NOT NULL CHECK (dia_pagamento BETWEEN 1 AND 28),
      data_vigencia DATE NOT NULL,
      mensagem_alerta TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id)
    );

    CREATE TABLE IF NOT EXISTS loja_clientes_perfis (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
      cpf VARCHAR(20),
      nascimento DATE,
      telefone VARCHAR(30),
      endereco_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      contato_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      preferencias_pagamento_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      termos_aceitos_em TIMESTAMP,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS status_moderacao VARCHAR(20) NOT NULL DEFAULT 'pendente';
    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aprovado_admin_id INTEGER REFERENCES usuarios(id);
    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMP;
    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comentario_moderacao TEXT;
    ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_status_moderacao_check;
    ALTER TABLE produtos ADD CONSTRAINT produtos_status_moderacao_check CHECK (status_moderacao IN ('pendente', 'aprovado', 'reprovado'));

    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login_em TIMESTAMP;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login_ip VARCHAR(80);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login_user_agent TEXT;

    CREATE TABLE IF NOT EXISTS usuario_sessoes (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      jwt_id VARCHAR(120) UNIQUE NOT NULL,
      session_type VARCHAR(20) NOT NULL DEFAULT 'persistent' CHECK (session_type IN ('persistent', 'session')),
      ip_origem VARCHAR(80),
      user_agent TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NOT NULL,
      revogado_em TIMESTAMP,
      revogado_por_id INTEGER REFERENCES usuarios(id),
      motivo_revogacao TEXT
    );

    CREATE TABLE IF NOT EXISTS usuario_app_preferencias (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      idioma VARCHAR(20) NOT NULL DEFAULT 'pt-BR',
      acessibilidade_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      tema VARCHAR(30) NOT NULL DEFAULT 'sistema',
      ultima_origem VARCHAR(40),
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id)
    );

    CREATE TABLE IF NOT EXISTS usuario_assinaturas (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      plano_codigo VARCHAR(40) NOT NULL DEFAULT 'membro_base',
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('ativa', 'inativa', 'suspensa', 'cancelada', 'pendente')),
      valor_mensal DECIMAL(12,2) NOT NULL DEFAULT 0,
      moeda VARCHAR(10) NOT NULL DEFAULT 'BRL',
      ciclo_dias INTEGER NOT NULL DEFAULT 30,
      inicio_em TIMESTAMP,
      proxima_cobranca_em TIMESTAMP,
      origem_pedido_id INTEGER REFERENCES pedidos(id),
      observacao TEXT,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id)
    );

    CREATE TABLE IF NOT EXISTS professor_autorizacoes (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      aprovado_admin_id INTEGER REFERENCES usuarios(id),
      aprovado_admin_em TIMESTAMP,
      aprovado_sabio_id INTEGER REFERENCES usuarios(id),
      aprovado_sabio_em TIMESTAMP,
      aprovado_fundador_id INTEGER REFERENCES usuarios(id),
      aprovado_fundador_em TIMESTAMP,
      observacao TEXT,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id)
    );

    CREATE TABLE IF NOT EXISTS usuario_registros_academicos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      ra_codigo VARCHAR(40) NOT NULL,
      tipo_registro VARCHAR(40) NOT NULL DEFAULT 'membro',
      status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
      observacao TEXT,
      atualizado_por_id INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id),
      UNIQUE(ra_codigo)
    );

    CREATE TABLE IF NOT EXISTS biblioteca_recursos (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(220) NOT NULL,
      tipo_recurso VARCHAR(30) NOT NULL
        CHECK (tipo_recurso IN ('site', 'texto', 'citacao', 'livro', 'artigo', 'filme', 'serie', 'outro')),
      categoria VARCHAR(80),
      descricao TEXT,
      url_recurso TEXT NOT NULL,
      fonte VARCHAR(80) NOT NULL DEFAULT 'interno',
      gratuito BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
      adicionado_por_id INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS biblioteca_autorizacoes (
      id SERIAL PRIMARY KEY,
      recurso_id INTEGER NOT NULL REFERENCES biblioteca_recursos(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      ra_codigo VARCHAR(40) NOT NULL,
      autorizado_por_id INTEGER REFERENCES usuarios(id),
      status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'revogado')),
      observacao TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(recurso_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS biblioteca_temas (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(100) NOT NULL UNIQUE,
      descricao TEXT,
      ordem_exibicao INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS biblioteca_livros (
      id SERIAL PRIMARY KEY,
      isbn VARCHAR(30) UNIQUE,
      titulo VARCHAR(255) NOT NULL,
      autor VARCHAR(255) NOT NULL,
      editora VARCHAR(150),
      ano_publicacao INTEGER,
      edicao VARCHAR(50),
      idioma VARCHAR(30) NOT NULL DEFAULT 'pt-BR',
      descricao TEXT,
      temas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      nivel_minimo_acesso VARCHAR(30) NOT NULL DEFAULT 'neofito',
      url_acesso TEXT,
      url_mercado_livre TEXT,
      url_amazon TEXT,
      url_fnac TEXT,
      url_openlibrary TEXT,
      url_google_books TEXT,
      nota_acesso TEXT,
      paginas INTEGER,
      categoria VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
      adicionado_por_id INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS biblioteca_livro_temas (
      livro_id INTEGER NOT NULL REFERENCES biblioteca_livros(id) ON DELETE CASCADE,
      tema_id INTEGER NOT NULL REFERENCES biblioteca_temas(id) ON DELETE CASCADE,
      PRIMARY KEY (livro_id, tema_id)
    );

    CREATE TABLE IF NOT EXISTS biblioteca_leituras_usuario (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      livro_id INTEGER NOT NULL REFERENCES biblioteca_livros(id) ON DELETE CASCADE,
      status VARCHAR(30) NOT NULL DEFAULT 'para_ler' CHECK (status IN ('para_ler', 'lendo', 'lido', 'abandonado')),
      paginas_lidas INTEGER DEFAULT 0,
      nota_pessoal NUMERIC(3, 1),
      comentario TEXT,
      iniciado_em TIMESTAMP,
      finalizado_em TIMESTAMP,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, livro_id)
    );

    CREATE TABLE IF NOT EXISTS diarios_pessoais (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo VARCHAR(180),
      conteudo_texto TEXT,
      sentimento VARCHAR(40),
      desenho_url TEXT,
      visivel_para_supervisao BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS diarios_comentarios (
      id SERIAL PRIMARY KEY,
      diario_id INTEGER NOT NULL REFERENCES diarios_pessoais(id) ON DELETE CASCADE,
      comentado_por_id INTEGER NOT NULL REFERENCES usuarios(id),
      comentario TEXT NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS grimorio_pessoal (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo VARCHAR(180),
      tipo_registro VARCHAR(40) NOT NULL DEFAULT 'anotacao'
        CHECK (tipo_registro IN ('anotacao', 'ritual', 'estudo', 'referencia')),
      conteudo_texto TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      visivel_para_supervisao BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS atividade_logs (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER REFERENCES usuarios(id),
      tipo_usuario VARCHAR(30),
      nivel_codigo VARCHAR(30),
      metodo VARCHAR(10),
      rota VARCHAR(255),
      status_http INTEGER,
      request_id VARCHAR(120),
      ip_origem VARCHAR(80),
      user_agent TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS atividade_logs_comentarios (
      id SERIAL PRIMARY KEY,
      atividade_id INTEGER NOT NULL REFERENCES atividade_logs(id) ON DELETE CASCADE,
      comentado_por_id INTEGER NOT NULL REFERENCES usuarios(id),
      comentario TEXT NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER REFERENCES usuarios(id),
      acao VARCHAR(80) NOT NULL,
      recurso VARCHAR(120),
      tabela_ref VARCHAR(80),
      registro_id VARCHAR(80),
      detalhes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_origem VARCHAR(80),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS consentimento_versoes (
      id SERIAL PRIMARY KEY,
      versao VARCHAR(30) UNIQUE NOT NULL,
      descricao TEXT,
      obrigatorio BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usuario_consentimento_log (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      versao_id INTEGER NOT NULL REFERENCES consentimento_versoes(id) ON DELETE CASCADE,
      aceito BOOLEAN NOT NULL DEFAULT true,
      ip_origem VARCHAR(80),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS consentimentos_lgpd_publico (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(160),
      email VARCHAR(160),
      versao_termo VARCHAR(30) NOT NULL,
      aceito BOOLEAN NOT NULL DEFAULT true,
      origem VARCHAR(80) NOT NULL DEFAULT 'site',
      ip_origem VARCHAR(80),
      user_agent TEXT,
      idioma VARCHAR(20),
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mercado_webhook_eventos (
      id SERIAL PRIMARY KEY,
      event_key VARCHAR(180) UNIQUE NOT NULL,
      topic VARCHAR(80),
      action VARCHAR(120),
      data_id VARCHAR(120),
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status_processamento VARCHAR(20) NOT NULL DEFAULT 'recebido'
        CHECK (status_processamento IN ('recebido', 'processado', 'ignorado', 'falha')),
      erro TEXT,
      recebido_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processado_em TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_usuario_papeis_usuario ON usuario_papeis(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_usuario_identidades_oauth_usuario ON usuario_identidades_oauth(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_usuario_niveis_usuario ON usuario_niveis(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_aulas_ao_vivo_status ON aulas_ao_vivo(status);
    CREATE INDEX IF NOT EXISTS idx_aulas_ao_vivo_turma ON aulas_ao_vivo(turma_id);
    CREATE INDEX IF NOT EXISTS idx_aula_presencas_aluno ON aula_presencas(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_faltas_justificativas_aluno ON faltas_justificativas(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_inscricao_tentativas_email ON inscricao_tentativas(email);
    CREATE INDEX IF NOT EXISTS idx_candidato_acompanhamento_email ON candidato_acompanhamento(email);
    CREATE INDEX IF NOT EXISTS idx_manutencoes_status ON manutencoes(status);
    CREATE INDEX IF NOT EXISTS idx_carrinhos_usuario_status ON carrinhos(usuario_id, status);
    CREATE INDEX IF NOT EXISTS idx_pagamentos_transacoes_usuario ON pagamentos_transacoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_pagamentos_transacoes_order_id ON pagamentos_transacoes(mercado_order_id);
    CREATE INDEX IF NOT EXISTS idx_pagamentos_transacoes_pedido_id ON pagamentos_transacoes(pedido_id);
    CREATE INDEX IF NOT EXISTS idx_mercado_webhook_eventos_data_id ON mercado_webhook_eventos(data_id);
    CREATE INDEX IF NOT EXISTS idx_consentimentos_lgpd_publico_email ON consentimentos_lgpd_publico(email);
    CREATE INDEX IF NOT EXISTS idx_usuario_sessoes_usuario ON usuario_sessoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_usuario_sessoes_expira_em ON usuario_sessoes(expira_em);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario ON audit_logs(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_atividade_logs_usuario ON atividade_logs(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_atividade_logs_rota ON atividade_logs(rota);
    CREATE INDEX IF NOT EXISTS idx_produtos_status_moderacao ON produtos(status_moderacao);
    CREATE INDEX IF NOT EXISTS idx_loja_clientes_perfis_usuario ON loja_clientes_perfis(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_usuario_registros_academicos_ra ON usuario_registros_academicos(ra_codigo);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_status ON biblioteca_recursos(status);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_autorizacoes_usuario ON biblioteca_autorizacoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_livros_isbn ON biblioteca_livros(isbn);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_livros_status ON biblioteca_livros(status);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_livros_nivel_minimo ON biblioteca_livros(nivel_minimo_acesso);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_livros_autor ON biblioteca_livros(autor);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_livro_temas_tema_id ON biblioteca_livro_temas(tema_id);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_leituras_usuario ON biblioteca_leituras_usuario(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_leituras_livro ON biblioteca_leituras_usuario(livro_id);
    CREATE INDEX IF NOT EXISTS idx_biblioteca_leituras_status ON biblioteca_leituras_usuario(status);
    CREATE INDEX IF NOT EXISTS idx_diarios_usuario ON diarios_pessoais(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_grimorio_usuario ON grimorio_pessoal(usuario_id);
  `;

  await pool.query(query);

  for (const papel of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
    for (const permissao of DEFAULT_ROLE_PERMISSIONS[papel]) {
      await pool.query(
        `
        INSERT INTO papel_permissoes (papel, permissao, ativo)
        VALUES ($1, $2, true)
        ON CONFLICT (papel, permissao) DO NOTHING
        `,
        [papel, permissao]
      );
    }
  }

  await pool.query(
    "CREATE EXTENSION IF NOT EXISTS pgcrypto"
  );

  await pool.query(
    `
    INSERT INTO consentimento_versoes (versao, descricao, obrigatorio)
    VALUES ('2026.03', 'Termo base de privacidade e tratamento de dados.', true)
    ON CONFLICT (versao) DO NOTHING
    `
  );

  await pool.query(
    `
    INSERT INTO usuario_assinaturas
      (usuario_id, plano_codigo, status, valor_mensal, moeda, ciclo_dias, atualizado_em, observacao)
    SELECT
      u.id,
      'membro_base',
      'pendente',
      80.00,
      'BRL',
      30,
      NOW(),
      'Inicializacao automatica de assinatura.'
    FROM usuarios u
    WHERE u.tipo_usuario = 'aluno'
      AND NOT EXISTS (
        SELECT 1 FROM usuario_assinaturas a WHERE a.usuario_id = u.id
      )
    `
  );
}

async function ensureCoreSystemUsers(overrides = {}) {
  let privilegedUsersTotal = 0;
  try {
    const privilegedUsersCount = await pool.query(
      "SELECT COUNT(*)::int AS total FROM usuarios WHERE tipo_usuario IN ('admin', 'ti')"
    );
    privilegedUsersTotal = Number(privilegedUsersCount.rows[0]?.total || 0);
  } catch (_error) {
    privilegedUsersTotal = 0;
  }

  for (const seedUser of getCoreBootstrapUsers(overrides)) {
    const email = String(seedUser.email || '').trim().toLowerCase();
    const senha = String(seedUser.senha || '');
    if (!email || !senha) {
      console.warn(
        `[bootstrap] Usuario ${seedUser.nome} ignorado por falta de senha em ${seedUser.senha_env || 'ENV_NAO_INFORMADA'}.`
      );
      continue;
    }

    const existingUserResult = await pool.query(
      'SELECT id, senha_hash, tipo_usuario FROM usuarios WHERE lower(email) = lower($1) LIMIT 1',
      [email]
    );
    const existingUser = existingUserResult.rows[0] || null;
    const isPrivilegedSeedUser = ['admin', 'ti'].includes(seedUser.tipo_usuario);

    if (!existingUser && isPrivilegedSeedUser && privilegedUsersTotal >= MAX_BOOTSTRAP_PRIVILEGED_USERS) {
      console.warn(`[bootstrap] Limite de ${MAX_BOOTSTRAP_PRIVILEGED_USERS} contas privilegiadas atingido. Usuario ${seedUser.email} ignorado.`);
      continue;
    }

    if (
      existingUser
      && !['admin', 'ti'].includes(existingUser.tipo_usuario)
      && isPrivilegedSeedUser
      && privilegedUsersTotal >= MAX_BOOTSTRAP_PRIVILEGED_USERS
    ) {
      console.warn(`[bootstrap] Limite de ${MAX_BOOTSTRAP_PRIVILEGED_USERS} contas privilegiadas atingido. Elevacao ignorada em ${seedUser.email}.`);
      continue;
    }

    let userId = existingUser?.id || null;

    if (!userId) {
      const senhaHash = await bcrypt.hash(senha, 10);
      const created = await pool.query(
        `
        INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
        VALUES ($1, $2, $3, $4, true, NOW())
        RETURNING id
        `,
        [seedUser.nome, email, senhaHash, seedUser.tipo_usuario]
      );
      userId = created.rows[0].id;
      if (isPrivilegedSeedUser) {
        privilegedUsersTotal += 1;
      }
    } else {
      await pool.query(
        `
        UPDATE usuarios
        SET nome = COALESCE($2, nome),
            tipo_usuario = $3,
            ativo = true
        WHERE id = $1
        `,
        [userId, seedUser.nome, seedUser.tipo_usuario]
      );

      if (!['admin', 'ti'].includes(existingUser?.tipo_usuario) && isPrivilegedSeedUser) {
        privilegedUsersTotal += 1;
      }
    }

    await pool.query(
      `
      INSERT INTO usuario_niveis (usuario_id, nivel_codigo, observacao, atualizado_em)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (usuario_id)
      DO UPDATE SET
        nivel_codigo = EXCLUDED.nivel_codigo,
        observacao = EXCLUDED.observacao,
        atualizado_em = NOW()
      `,
      [userId, seedUser.nivel_codigo, 'Bootstrap inicial de governanca da ordem.']
    );

    for (const papel of seedUser.papeis || []) {
      await pool.query(
        `
        INSERT INTO usuario_papeis (usuario_id, papel, criado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (usuario_id, papel) DO NOTHING
        `,
        [userId, papel]
      );
    }

    const registroAcademico = normalizeAcademicRegistration(seedUser.registro_academico);
    if (isValidAcademicRegistration(registroAcademico)) {
      await pool.query(
        `
        INSERT INTO usuario_registros_academicos
          (usuario_id, ra_codigo, tipo_registro, status, observacao, atualizado_por_id, criado_em, atualizado_em)
        VALUES
          ($1, $2, $3, 'ativo', $4, $1, NOW(), NOW())
        ON CONFLICT (usuario_id)
        DO UPDATE SET
          ra_codigo = EXCLUDED.ra_codigo,
          tipo_registro = EXCLUDED.tipo_registro,
          status = 'ativo',
          observacao = EXCLUDED.observacao,
          atualizado_por_id = EXCLUDED.atualizado_por_id,
          atualizado_em = NOW()
        `,
        [
          userId,
          registroAcademico,
          seedUser.nivel_codigo || 'membro',
          'Registro academico bootstrap'
        ]
      );
    }
  }
}

async function initializeBibliotecaTemas() {
  // Temas principais da biblioteca esotérica
  const temas = [
    { nome: 'Ocultismo', descricao: 'Conhecimento oculto e secreto', ordem: 1 },
    { nome: 'Magia do Caos', descricao: 'Magia moderna e adaptativa', ordem: 2 },
    { nome: 'Astrologia', descricao: 'Estudo dos astros e influências celestes', ordem: 3 },
    { nome: 'Tarot', descricao: 'Divinação com cartas', ordem: 4 },
    { nome: 'Alquimia', descricao: 'Transformação e transmutação', ordem: 5 },
    { nome: 'Kabbalah', descricao: 'Tradição mística judaica', ordem: 6 },
    { nome: 'Hermetismo', descricao: 'Filosofia hermética - "Como acima, assim abaixo"', ordem: 7 },
    { nome: 'Wicca', descricao: 'Bruxaria moderna e paganismo', ordem: 8 },
    { nome: 'Xamanismo', descricao: 'Práticas espirituais ancestrais', ordem: 9 },
    { nome: 'Hinduismo & Budismo', descricao: 'Tradições espirituais orientais', ordem: 10 },
    { nome: 'Mitologia', descricao: 'Mitos e lendas de culturas antigas', ordem: 11 },
    { nome: 'História das Culturas', descricao: 'Antropologia e história comparada', ordem: 12 },
    { nome: 'Anatomia Esotérica', descricao: 'Corpos etéreos e energia vital', ordem: 13 },
    { nome: 'Fitoterapia & Aromaterapia', descricao: 'Plantas medicinais e óleos essenciais', ordem: 14 },
    { nome: 'Cristaloterapia', descricao: 'Poderes curativos dos cristais', ordem: 15 },
    { nome: 'Psicologia', descricao: 'Psique humana e desenvolvimento', ordem: 16 },
    { nome: 'Reiki & Terapias Energéticas', descricao: 'Práticas de cura energética', ordem: 17 },
    { nome: 'Numerologia', descricao: 'Significado oculto dos números', ordem: 18 },
    { nome: 'Runas', descricao: 'Alfabeto mágico nórdico', ordem: 19 },
    { nome: 'Grimórios', descricao: 'Livros de magia e conjuros', ordem: 20 },
    { nome: 'Magia Cerimonial', descricao: 'Rituais e cerimônias sagradas', ordem: 21 },
    { nome: 'Enochiano', descricao: 'Magia dos anjos de Enoch', ordem: 22 },
    { nome: 'Satanismo & Luciferianismo', descricao: 'Filosofias da autonomia e poder pessoal', ordem: 23 },
    { nome: 'Voodoo & Hoodoo', descricao: 'Tradições afro-caribenhas', ordem: 24 },
    { nome: 'Filosofia', descricao: 'Pensamento filosófico e metafísica', ordem: 25 },
    { nome: 'Semiótica & Linguagem', descricao: 'Signos, símbolos e significado', ordem: 26 }
  ];

  for (const tema of temas) {
    await pool.query(
      'INSERT INTO biblioteca_temas (nome, descricao, ordem_exibicao, ativo, criado_em) VALUES (\$1, \$2, \$3, true, NOW()) ON CONFLICT (nome) DO NOTHING',
      [tema.nome, tema.descricao, tema.ordem]
    );
  }

  console.log('[INIT] Temas da biblioteca inicializados.');
}

async function initializeBibliotecaLivros() {
  const livros = [
    // Livros em Português - Magia do Caos
    {
      isbn: '978-8591257508',
      titulo: 'Liber Null & Psychonaut',
      autor: 'Peter J. Carroll',
      editora: 'Penumbra Livros',
      ano_publicacao: 2025,
      idioma: 'pt-BR',
      descricao: 'Considerado a "bíblia" do Caos e da magia moderna. Uma obra fundamental para compreender os princípios da magia caótica.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Ocultismo', 'Filosofia'],
    },
    {
      isbn: '978-8591257515',
      titulo: 'Liber Kaos: Chaos Magic for the Pandaemonaeon',
      autor: 'Peter J. Carroll',
      editora: 'Penumbra Livros',
      ano_publicacao: 2023,
      idioma: 'pt-BR',
      descricao: 'Continuação avançada de Liber Null, aprofundando técnicas e filosofia da magia caótica.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Ocultismo'],
    },
    {
      isbn: '978-6588801109',
      titulo: 'Caos e Além',
      autor: 'Phil Hine',
      editora: 'Devir Editora',
      ano_publicacao: 2022,
      idioma: 'pt-BR',
      descricao: 'Exploração prática de técnicas de magia caótica com foco em resultados tangíveis.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Magia Cerimonial'],
    },
    {
      isbn: '978-6588801048',
      titulo: 'Arte, Magia Do Caos',
      autor: 'Austin Osman Spare',
      editora: 'Devir Editora',
      ano_publicacao: 2021,
      idioma: 'pt-BR',
      descricao: 'Clássico raro que influenciou todo o sistema moderno de magia caótica. Sigils e sigilização.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Arte', 'Ocultismo'],
    },
    {
      isbn: '978-9893771960',
      titulo: 'Magia do Caos Decifrada',
      autor: 'Asamod Ka',
      editora: 'Caminho Editorial',
      ano_publicacao: 2021,
      idioma: 'pt-BR',
      descricao: 'Guia prático e didático para iniciantes em magia caótica com exercícios progressivos.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Hermetismo'],
    },
    // Livros em Inglês
    {
      isbn: '978-1578637669',
      titulo: 'Liber Null & Psychonaut (Edição Revisada)',
      autor: 'Peter J. Carroll',
      ano_publicacao: 2014,
      idioma: 'en',
      descricao: 'Edição revisada e ampliada em inglês. Referência fundamental na magia contemporânea.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Ocultismo'],
    },
    {
      isbn: '978-1578638048',
      titulo: 'Liber Kaos: Chaos Magic for the Pandaemonaeon',
      autor: 'Peter J. Carroll',
      ano_publicacao: 2016,
      idioma: 'en',
      descricao: 'Versão em inglês. Aprofundamento em técnicas avançadas de magia caótica.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos'],
    },
    {
      isbn: '978-1935150664',
      titulo: 'Condensed Chaos: An Introduction to Chaos Magic',
      autor: 'Phil Hine',
      ano_publicacao: 2004,
      idioma: 'en',
      descricao: 'Introdução clara e prática aos princípios da magia caótica.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Magia Cerimonial'],
    },
    {
      isbn: '978-1561841332',
      titulo: 'Prime Chaos: Adventures in Chaos Magic',
      autor: 'Phil Hine',
      ano_publicacao: 2002,
      idioma: 'en',
      descricao: 'Narrativas experimentais e técnicas avançadas de magia caótica.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Ocultismo'],
    },
    {
      isbn: '978-1935150701',
      titulo: 'The Book of Results (O Livro dos Resultados)',
      autor: 'Ray Sherwin',
      ano_publicacao: 1997,
      idioma: 'en',
      descricao: 'Trabalho prático focado em obtenção de resultados através de magia caótica.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Magia Cerimonial'],
    },
    {
      isbn: '978-0738715070',
      titulo: 'Hands-On Chaos Magic: Reality Manipulation',
      autor: 'Andrieh Vitimus',
      ano_publicacao: 2008,
      idioma: 'en',
      descricao: 'Guia prático com exercícios diretos para manipulação de realidade.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Filosofia'],
    },
    {
      isbn: '978-1904658069',
      titulo: 'Chaotopia!: Sorcery and Ecstasy in the Fifth Aeon',
      autor: 'Dave Lee',
      ano_publicacao: 2000,
      idioma: 'en',
      descricao: 'Exploração poética e filosófica da magia caótica num contexto contemporâneo.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Filosofia'],
    },
    {
      isbn: '978-0994132437',
      titulo: 'The Chaos Protocols',
      autor: 'Gordon White',
      ano_publicacao: 2016,
      idioma: 'en',
      descricao: 'Protocolos modernos de magia caótica aplicada ao ambiente digital.',
      nivel_minimo_acesso: 'mago_n2',
      temas: ['Magia do Caos', 'Enochiano'],
    },
    {
      isbn: '978-0738712796',
      titulo: 'Postmodern Magic: The Art of Magic in the Information Age',
      autor: 'Patrick Dunn',
      ano_publicacao: 2005,
      idioma: 'en',
      descricao: 'Magia para a era da informação. Síntese entre tradicionalismo e modernidade.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia do Caos', 'Filosofia'],
    },
    {
      isbn: '978-1803418728',
      titulo: 'Pagan Portals - Chaos Magic: A Complete Beginner\'s Guide',
      autor: 'Ivy Corvus',
      ano_publicacao: 2021,
      idioma: 'en',
      descricao: 'Guia completo para iniciantes com estrutura progressiva e clara.',
      nivel_minimo_acesso: 'neofito',
      temas: ['Magia do Caos', 'Wicca'],
    },
    // Clássicos do Ocultismo
    {
      titulo: 'O Tratado de Magia Prática',
      autor: 'Papus (Gérard Encausse)',
      ano_publicacao: 1891,
      idioma: 'pt-BR',
      descricao: 'Clássico fundamental do século XIX sobre magia cerimonial e aplicada.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia Cerimonial', 'Ocultismo', 'Hermetismo'],
    },
    {
      titulo: 'Magick in Theory and Practice',
      autor: 'Aleister Crowley',
      ano_publicacao: 1912,
      idioma: 'en',
      descricao: 'Obra magnum de Crowley sistematizando toda a magia ocidental.',
      nivel_minimo_acesso: 'mago_n2',
      temas: ['Magia Cerimonial', 'Kabbalah', 'Ocultismo'],
    },
    {
      titulo: 'Initiation, Human and Solar',
      autor: 'Alice A. Bailey',
      ano_publicacao: 1922,
      idioma: 'en',
      descricao: 'Exploração teosófica de iniciação e desenvolvimento espiritual.',
      nivel_minimo_acesso: 'mago_n2',
      temas: ['Filosofia', 'Espiritismo', 'Ocultismo'],
    },
    {
      titulo: 'The Secret Doctrine',
      autor: 'Helena Petrovna Blavatsky',
      ano_publicacao: 1888,
      idioma: 'en',
      descricao: 'Obra fundamental da Teosofia e conhecimento esotérico ocidental.',
      nivel_minimo_acesso: 'sabio',
      temas: ['Teologia', 'Filosofia', 'Ocultismo'],
    },
    {
      titulo: 'Practical Magic',
      autor: 'Franz Bardon',
      ano_publicacao: 1956,
      idioma: 'pt-BR',
      descricao: 'Etapas práticas do desenvolvimento mágico pessoal.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Magia Cerimonial', 'Hermetismo'],
    },
    {
      titulo: 'The Kybalion',
      autor: 'The Three Initiates',
      ano_publicacao: 1912,
      idioma: 'en',
      descricao: 'Princípios Herméticos fundamentais - "Como acima, assim abaixo".',
      nivel_minimo_acesso: 'neofito',
      temas: ['Hermetismo', 'Filosofia'],
    },
    {
      titulo: 'O Tarot dos Alquimistas',
      autor: 'Eliphas Levi',
      ano_publicacao: 1854,
      idioma: 'pt-BR',
      descricao: 'Interpretação alquímica do Tarot e simbologia oculta.',
      nivel_minimo_acesso: 'mago_n1',
      temas: ['Tarot', 'Alquimia', 'Ocultismo'],
    },
    {
      titulo: 'Gramática de Alquimia',
      autor: 'Ahmed Kaplan',
      ano_publicacao: 1970,
      idioma: 'pt-BR',
      descricao: 'Fundamentos alquímicos da transformação espiritual.',
      nivel_minimo_acesso: 'mago_n2',
      temas: ['Alquimia', 'Filosofia'],
    },
    {
      titulo: 'A Kabbalah Prática',
      autor: 'Frater Achad',
      ano_publicacao: 1916,
      idioma: 'en',
      descricao: 'Aplicação prática da Kabbalah no desenvolvimento espiritual.',
      nivel_minimo_acesso: 'mago_n2',
      temas: ['Kabbalah', 'Magia Cerimonial'],
    },
  ];

  for (const livro of livros) {
    try {
      const temas_text = livro.temas || [];
      const { rows: temaRows } = await pool.query(
        'SELECT id FROM biblioteca_temas WHERE nome = ANY($1::text[])',
        [temas_text]
      );
      
      const tema_ids = temaRows.map(r => r.id);

      const { rows: livroRows } = await pool.query(
        `INSERT INTO biblioteca_livros 
          (isbn, titulo, autor, editora, ano_publicacao, idioma, descricao, 
           nivel_minimo_acesso, adicionado_por_id, criado_em, atualizado_em)
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW(), NOW())
        ON CONFLICT (isbn) DO NOTHING
        RETURNING id`,
        [livro.isbn || null, livro.titulo, livro.autor, livro.editora || null, 
         livro.ano_publicacao || null, livro.idioma || 'pt-BR', livro.descricao || null,
         livro.nivel_minimo_acesso || 'neofito']
      );

      if (livroRows.length > 0 && tema_ids.length > 0) {
        const livroId = livroRows[0].id;
        for (const temaId of tema_ids) {
          await pool.query(
            'INSERT INTO biblioteca_livro_temas (livro_id, tema_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [livroId, temaId]
          );
        }
      }
    } catch (error) {
      console.warn(`[WARN] Erro ao inserir livro ${livro.titulo}:`, error.message);
    }
  }

  console.log('[INIT] Livros esotéricos adicionados à biblioteca.');
}

async function logAudit(req, acao, recurso, tabelaRef, registroId, detalhes = {}) {
  try {
    await pool.query(
      `
      INSERT INTO audit_logs
        (usuario_id, acao, recurso, tabela_ref, registro_id, detalhes_json, ip_origem)
      VALUES
        ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        req.userId || null,
        acao,
        recurso || null,
        tabelaRef || null,
        registroId ? String(registroId) : null,
        JSON.stringify(detalhes || {}),
        req.ip || null
      ]
    );
  } catch (error) {
    console.error('Falha ao gravar audit log:', error.message);
  }
}

async function logSecurityEvent(req, acao, detalhes = {}) {
  try {
    await pool.query(
      `
      INSERT INTO audit_logs
        (usuario_id, acao, recurso, tabela_ref, registro_id, detalhes_json, ip_origem)
      VALUES
        (NULL, $1, 'seguranca', 'auth', NULL, $2::jsonb, $3)
      `,
      [acao, JSON.stringify(detalhes || {}), getClientIp(req)]
    );
  } catch (_) {
    // Non-blocking security telemetry.
  }
}

async function getUserRoles(userId, tipoUsuario) {
  const roles = new Set();
  if (tipoUsuario) roles.add(tipoUsuario);

  const { rows } = await pool.query('SELECT papel FROM usuario_papeis WHERE usuario_id = $1', [userId]);
  rows.forEach((row) => roles.add(row.papel));

  return Array.from(roles);
}

async function getUserNivel(userId) {
  const { rows } = await pool.query(
    `
    SELECT nivel_codigo, observacao, atualizado_em
    FROM usuario_niveis
    WHERE usuario_id = $1
    `,
    [userId]
  );

  if (!rows.length) {
    return { nivel_codigo: 'neofito', observacao: null, atualizado_em: null };
  }

  return rows[0];
}

const LOGIN_PROFILE_ORDER = [
  'ti',
  'admin',
  'mestre',
  'sabio',
  'professor',
  'lojista',
  'mago_n2',
  'mago_n1',
  'neofito',
  'cliente'
];

function normalizeLoginProfile(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

  if (!normalized) return '';
  if (normalized === 'mago_nivel_1' || normalized === 'mago1') return 'mago_n1';
  if (normalized === 'mago_nivel_2' || normalized === 'mago2') return 'mago_n2';
  if (normalized === 'sabio') return 'sabio';
  if (normalized === 'mestre_fundador') return 'mestre';
  return normalized;
}

function canUseLojistaProfileByNivel(nivelCodigo) {
  return isNivelAtLeast(normalizeNivelCodigo(nivelCodigo || 'neofito'), 'mago_n1');
}

function computeLoginProfiles({ tipoUsuario, nivelCodigo, roles }) {
  const profiles = new Set();
  const tipo = String(tipoUsuario || '').trim().toLowerCase();
  const nivel = normalizeNivelCodigo(nivelCodigo || 'neofito');
  const normalizedRoles = new Set((Array.isArray(roles) ? roles : []).map((role) => String(role || '').trim().toLowerCase()));
  const shouldIncludeAcademicProfiles = ['aluno', 'admin', 'professor', 'ti'].includes(tipo)
    || normalizedRoles.has('sabio')
    || normalizedRoles.has('mestre')
    || normalizedRoles.has('professor')
    || ['mago_n1', 'mago_n2', 'sabio', 'mestre', 'mestre_fundador'].includes(nivel);

  if (tipo) {
    profiles.add(tipo);
  }

  if (tipo === 'ti') {
    profiles.add('ti');
    profiles.add('admin');
    profiles.add('mestre');
    profiles.add('sabio');
  }

  if (tipo === 'admin') {
    profiles.add('admin');
    profiles.add('mestre');
    profiles.add('sabio');
    profiles.add('cliente');
  }

  if (tipo === 'professor') {
    profiles.add('professor');
    profiles.add('cliente');
  }

  if (tipo === 'lojista') {
    if (canUseLojistaProfileByNivel(nivel)) {
      profiles.add('lojista');
    }
    profiles.add('cliente');
  }

  if (tipo === 'aluno') {
    profiles.add('cliente');
  }

  if (normalizedRoles.has('mestre') || ['mestre', 'mestre_fundador'].includes(nivel)) {
    profiles.add('mestre');
    profiles.add('sabio');
  }

  if (normalizedRoles.has('sabio') || nivel === 'sabio') {
    profiles.add('sabio');
  }

  if (normalizedRoles.has('lojista') && canUseLojistaProfileByNivel(nivel)) {
    profiles.add('lojista');
  }

  if (shouldIncludeAcademicProfiles) {
    if (isNivelAtLeast(nivel, 'mago_n2')) {
      profiles.add('mago_n2');
      profiles.add('mago_n1');
      profiles.add('neofito');
    } else if (isNivelAtLeast(nivel, 'mago_n1')) {
      profiles.add('mago_n1');
      profiles.add('neofito');
    } else {
      profiles.add('neofito');
    }
  }

  if (!profiles.size) {
    profiles.add('cliente');
  }

  return LOGIN_PROFILE_ORDER.filter((profile) => profiles.has(profile));
}

function resolveHomeRouteByProfile(profile, { tipoUsuario, nivelCodigo, roles }) {
  const normalizedProfile = normalizeLoginProfile(profile);
  const tipo = String(tipoUsuario || '').trim().toLowerCase();
  const nivel = normalizeNivelCodigo(nivelCodigo || 'neofito');
  const normalizedRoles = new Set((Array.isArray(roles) ? roles : []).map((role) => String(role || '').trim().toLowerCase()));
  const hasAdminPrivileges = ['admin', 'ti'].includes(tipo) || normalizedRoles.has('mestre') || ['mestre', 'mestre_fundador'].includes(nivel);

  if (normalizedProfile === 'ti') return '/dashboard-TI';
  if (normalizedProfile === 'admin') return '/admin/master';
  if (normalizedProfile === 'mestre') return hasAdminPrivileges ? '/admin/master' : '/dashboard-professor';
  if (normalizedProfile === 'sabio') {
    if (hasAdminPrivileges) return '/admin/master';
    if (tipo === 'professor') return '/dashboard-professor';
    return '/dashboard-aluno';
  }
  if (normalizedProfile === 'professor') return '/dashboard-professor';
  if (normalizedProfile === 'lojista') return '/dashboard-lojista';
  if (['mago_n2', 'mago_n1', 'neofito'].includes(normalizedProfile)) return '/dashboard-aluno';
  if (normalizedProfile === 'cliente') return '/dashboard-cliente';
  if (tipo === 'professor') return '/dashboard-professor';
  if (tipo === 'aluno') return '/dashboard-aluno';
  return '/dashboard';
}

function resolveLoginProfile({
  requestedProfile,
  tipoUsuario,
  nivelCodigo,
  roles
}) {
  const availableProfiles = computeLoginProfiles({ tipoUsuario, nivelCodigo, roles });
  const preferredProfile = normalizeLoginProfile(requestedProfile);
  const selectedProfile = preferredProfile && availableProfiles.includes(preferredProfile)
    ? preferredProfile
    : availableProfiles[0] || 'cliente';
  const homeRoute = resolveHomeRouteByProfile(selectedProfile, { tipoUsuario, nivelCodigo, roles });

  return {
    selectedProfile,
    availableProfiles,
    homeRoute
  };
}

function requiresProfessorAuthorizationByNivel(nivelCodigo) {
  const nivel = normalizeNivelCodigo(nivelCodigo);
  return ['mago_n1', 'mago_n2'].includes(nivel);
}

async function getProfessorAuthorizationStatus(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      usuario_id,
      aprovado_admin_id,
      aprovado_admin_em,
      aprovado_sabio_id,
      aprovado_sabio_em,
      aprovado_fundador_id,
      aprovado_fundador_em
    FROM professor_autorizacoes
    WHERE usuario_id = $1
    LIMIT 1
    `,
    [userId]
  );

  const row = rows[0];
  return {
    has_admin: Boolean(row?.aprovado_admin_id),
    has_sabio: Boolean(row?.aprovado_sabio_id),
    has_fundador: Boolean(row?.aprovado_fundador_id),
    row: row || null
  };
}

async function getPermissionsByRoles(roles) {
  if (!roles.length) return [];

  const { rows } = await pool.query(
    `
    SELECT DISTINCT permissao
    FROM papel_permissoes
    WHERE papel = ANY($1::text[])
      AND ativo = true
    ORDER BY permissao
    `,
    [roles]
  );

  return rows.map((row) => row.permissao);
}

function canUserManageLojista(tipoUsuario, nivelCodigo) {
  if (['admin', 'mestre', 'ti'].includes(tipoUsuario)) return true;
  return ['mago_n1', 'mago_n2', 'mago_n3', 'mentor', 'sabio', 'mestre'].includes(nivelCodigo);
}

function safeEqualsSecret(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function addBusinessDays(baseDate, amount) {
  const date = new Date(baseDate);
  let remaining = amount;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return date;
}

async function markExpiredDisciplinaryActions(alunoId = null) {
  if (alunoId) {
    await pool.query(
      `
      UPDATE acoes_disciplinares
      SET status = 'expirada', atualizado_em = NOW()
      WHERE aluno_id = $1
        AND tipo = 'suspensao'
        AND status = 'ativa'
        AND revogado_em IS NULL
        AND data_fim IS NOT NULL
        AND data_fim <= NOW()
      `,
      [alunoId]
    );

    return;
  }

  await pool.query(`
    UPDATE acoes_disciplinares
    SET status = 'expirada', atualizado_em = NOW()
    WHERE tipo = 'suspensao'
      AND status = 'ativa'
      AND revogado_em IS NULL
      AND data_fim IS NOT NULL
      AND data_fim <= NOW()
  `);
}

async function getActiveBlockingAction(alunoId) {
  const { rows } = await pool.query(
    `
    SELECT id, tipo, motivo, data_inicio, data_fim
    FROM acoes_disciplinares
    WHERE aluno_id = $1
      AND status = 'ativa'
      AND revogado_em IS NULL
      AND (
        tipo = 'expulsao'
        OR (tipo = 'suspensao' AND data_inicio <= NOW() AND (data_fim IS NULL OR data_fim > NOW()))
      )
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [alunoId]
  );

  return rows[0] || null;
}

function disciplinaryBlockMessage(action) {
  if (action.tipo === 'expulsao') {
    return 'Acesso bloqueado por expulsao disciplinar.';
  }

  if (action.tipo === 'suspensao') {
    const fim = action.data_fim ? new Date(action.data_fim).toLocaleString('pt-BR') : 'prazo indeterminado';
    return `Acesso suspenso ate ${fim}.`;
  }

  return 'Acesso bloqueado por medida disciplinar.';
}

async function materiaDoProfessor(materiaId, professorId) {
  const { rows } = await pool.query(
    `
    SELECT m.*, t.nome AS turma_nome
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    WHERE m.id = $1
      AND m.professor_id = $2
      AND m.ativa = true
    `,
    [materiaId, professorId]
  );

  return rows[0] || null;
}

async function materiaAcessivelAluno(materiaId, alunoId) {
  const { rows } = await pool.query(
    `
    SELECT m.id, m.nome, m.tipo_materia, m.turma_id, t.nome AS turma_nome
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    JOIN alunos_turmas at ON at.turma_id = m.turma_id
    WHERE m.id = $1
      AND m.ativa = true
      AND at.aluno_id = $2
      AND at.status = 'ativo'
    LIMIT 1
    `,
    [materiaId, alunoId]
  );

  return rows[0] || null;
}

async function avaliacaoAcessivelAluno(avaliacaoId, alunoId) {
  const { rows } = await pool.query(
    `
    SELECT a.id, a.materia_id, a.titulo, a.tipo_avaliacao, a.data_limite
    FROM avaliacoes_v2 a
    JOIN materias m ON m.id = a.materia_id
    JOIN alunos_turmas at ON at.turma_id = m.turma_id
    WHERE a.id = $1
      AND a.status = 'publicada'
      AND m.ativa = true
      AND at.aluno_id = $2
      AND at.status = 'ativo'
    LIMIT 1
    `,
    [avaliacaoId, alunoId]
  );

  return rows[0] || null;
}

const auth = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ erro: 'Token ausente.' });
    }

    const { id, jti } = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, nome, email, tipo_usuario, ativo FROM usuarios WHERE id = $1',
      [id]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ erro: 'Usuario nao encontrado.' });
    }

    if (!user.ativo) {
      return res.status(403).json({ erro: 'Usuario bloqueado.' });
    }

    if (user.tipo_usuario === 'aluno') {
      await markExpiredDisciplinaryActions(user.id);
      const activeBlock = await getActiveBlockingAction(user.id);

      if (activeBlock) {
        return res.status(403).json({
          erro: disciplinaryBlockMessage(activeBlock),
          bloqueio: activeBlock
        });
      }
    }

    if (!jti) {
      return res.status(401).json({ erro: 'Sessao sem identificador. Faca login novamente.' });
    }

    const sessionResult = await pool.query(
      `
      SELECT id, session_type, expira_em, revogado_em
      FROM usuario_sessoes
      WHERE usuario_id = $1
        AND jwt_id = $2
      LIMIT 1
      `,
      [id, jti]
    );

    const activeSession = sessionResult.rows[0];
    if (!activeSession || activeSession.revogado_em || new Date(activeSession.expira_em) <= new Date()) {
      return res.status(401).json({ erro: 'Sessao expirada ou revogada. Faca login novamente.' });
    }

    req.userId = user.id;
    req.user = user;
    req.sessionJwtId = jti;
    req.sessionType = activeSession.session_type;
    req.user.roles = await getUserRoles(user.id, user.tipo_usuario);
    req.user.nivel = await getUserNivel(user.id);
    req.user.permissoes = await getPermissionsByRoles(req.user.roles);
    req.user.is_founder = isFounderEmail(req.user.email);
    req.user.is_sage = isSageEmail(req.user.email) || req.user.roles.includes('sabio');
    const resolvedLoginProfile = resolveLoginProfile({
      requestedProfile: req.user?.perfil_login,
      tipoUsuario: req.user.tipo_usuario,
      nivelCodigo: req.user?.nivel?.nivel_codigo,
      roles: req.user.roles
    });
    req.user.perfil_login = resolvedLoginProfile.selectedProfile;
    req.user.perfis_disponiveis = resolvedLoginProfile.availableProfiles;
    req.user.home_route = resolvedLoginProfile.homeRoute;

    if (!req._activityTrackerAttached) {
      req._activityTrackerAttached = true;
      res.on('finish', () => {
        if (!req.userId) return;
        if (String(req.path || '').startsWith('/css/')) return;
        if (String(req.path || '').startsWith('/js/')) return;
        if (String(req.path || '').startsWith('/img/')) return;
        if (String(req.path || '').startsWith('/i18n/')) return;
        if (String(req.path || '').startsWith('/frontend/')) return;
        if (String(req.path || '').startsWith('/uploads/')) return;

        const safePayload = redactSensitiveFields(req.body || {});
        const responseSummary = {
          status_code: res.statusCode,
          content_type: res.getHeader('content-type') || null
        };

        pool.query(
          `
          INSERT INTO atividade_logs
            (usuario_id, tipo_usuario, nivel_codigo, metodo, rota, status_http, request_id, ip_origem, user_agent, payload_json, response_json, criado_em)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, NOW())
          `,
          [
            req.userId,
            req.user?.tipo_usuario || null,
            req.user?.nivel?.nivel_codigo || null,
            req.method,
            req.originalUrl || req.path || null,
            res.statusCode,
            req.requestId || null,
            getClientIp(req),
            req.headers['user-agent'] || null,
            JSON.stringify(safePayload || {}),
            JSON.stringify(responseSummary)
          ]
        ).catch(() => {});
      });
    }
    next();
  } catch (error) {
    res.status(401).json({ erro: 'Token invalido.' });
  }
};

app.post('/inscricao', upload.fields([{ name: 'comprovante' }, { name: 'termo' }]), async (req, res) => {
  try {
    const {
      nome,
      email,
      telefone,
      respostas,
      tipo_logradouro,
      logradouro,
      numero,
      complemento,
      municipio,
      estado,
      pais,
      cep
    } = req.body;

    const emailNormalizado = String(email || '').trim().toLowerCase();
    if (!nome || !emailNormalizado) {
      return res.status(400).json({ erro: 'Nome e email sao obrigatorios.' });
    }

    const comprovanteUrl = req.files?.comprovante?.[0]
      ? `/uploads/${req.files.comprovante[0].filename}`
      : null;
    const termoUrl = req.files?.termo?.[0]
      ? `/uploads/${req.files.termo[0].filename}`
      : null;

    const existingResult = await pool.query(
      `
      SELECT id, status, data_reprovacao, data_inscricao
      FROM inscricoes
      WHERE email = $1
      LIMIT 1
      `,
      [emailNormalizado]
    );

    let inscricaoId;
    let wasRetry = false;

    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      if (existing.status === 'pendente') {
        return res.status(409).json({ erro: 'Inscricao ja esta em analise para este email.' });
      }

      if (existing.status === 'aprovado') {
        return res.status(409).json({ erro: 'Este email ja possui inscricao aprovada.' });
      }

      if (existing.status === 'negado' && existing.data_reprovacao) {
        const dataReprovacao = new Date(existing.data_reprovacao);
        const dataMinima = new Date(dataReprovacao);
        dataMinima.setDate(dataMinima.getDate() + 14);

        if (new Date() < dataMinima) {
          const diasRestantes = Math.ceil((dataMinima - new Date()) / (1000 * 60 * 60 * 24));
          return res.status(429).json({
            erro: `Nova tentativa liberada em ${diasRestantes} dia(s).`
          });
        }
      }

      const updateResult = await pool.query(
        `
        UPDATE inscricoes
        SET
          nome = $1,
          telefone = $2,
          respostas = $3,
          tipo_logradouro = $4,
          logradouro = $5,
          numero = $6,
          complemento = $7,
          municipio = $8,
          estado = $9,
          pais = $10,
          cep = $11,
          comprovante_url = COALESCE($12, comprovante_url),
          termo_assinado_url = COALESCE($13, termo_assinado_url),
          status = 'pendente',
          data_inscricao = NOW()
        WHERE id = $14
        RETURNING id
        `,
        [
          nome,
          telefone,
          respostas,
          tipo_logradouro,
          logradouro,
          numero,
          complemento,
          municipio,
          estado,
          pais,
          cep,
          comprovanteUrl,
          termoUrl,
          existing.id
        ]
      );

      inscricaoId = updateResult.rows[0].id;
      wasRetry = true;
    } else {
      const insertResult = await pool.query(
        `
        INSERT INTO inscricoes
        (
          nome,
          email,
          telefone,
          respostas,
          tipo_logradouro,
          logradouro,
          numero,
          complemento,
          municipio,
          estado,
          pais,
          cep,
          comprovante_url,
          termo_assinado_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
        `,
        [
          nome,
          emailNormalizado,
          telefone,
          respostas,
          tipo_logradouro,
          logradouro,
          numero,
          complemento,
          municipio,
          estado,
          pais,
          cep,
          comprovanteUrl,
          termoUrl
        ]
      );
      inscricaoId = insertResult.rows[0].id;
    }

    const candidateResult = await pool.query(
      `
      SELECT id, token_acompanhamento, tentativas_total
      FROM candidato_acompanhamento
      WHERE email = $1
      LIMIT 1
      `,
      [emailNormalizado]
    );

    let tokenAcompanhamento;
    if (!candidateResult.rows.length) {
      tokenAcompanhamento = crypto.randomBytes(20).toString('hex');
      await pool.query(
        `
        INSERT INTO candidato_acompanhamento
          (email, token_acompanhamento, status_atual, tentativas_total, ultima_atualizacao)
        VALUES ($1, $2, 'em_analise', 1, NOW())
        `,
        [emailNormalizado, tokenAcompanhamento]
      );
    } else {
      const candidate = candidateResult.rows[0];
      tokenAcompanhamento = candidate.token_acompanhamento;
      await pool.query(
        `
        UPDATE candidato_acompanhamento
        SET
          status_atual = 'em_analise',
          tentativas_total = $2,
          ultima_atualizacao = NOW()
        WHERE id = $1
        `,
        [candidate.id, Number(candidate.tentativas_total || 0) + 1]
      );
    }

    await pool.query(
      `
      INSERT INTO inscricao_tentativas
        (inscricao_id, email, nome, status, observacao)
      VALUES
        ($1, $2, $3, 'pendente', $4)
      `,
      [inscricaoId, emailNormalizado, nome, wasRetry ? 'Reenvio apos reprovacao.' : 'Primeira tentativa.']
    );

    await trySaveUniversalArchive({
      chave: `inscricao:${inscricaoId}:${Date.now()}`,
      tipoRecurso: 'inscricao',
      subtipo: wasRetry ? 'retry' : 'create',
      payload: {
        inscricao_id: inscricaoId,
        was_retry: wasRetry,
        nome,
        email: emailNormalizado,
        telefone,
        respostas,
        endereco: {
          tipo_logradouro,
          logradouro,
          numero,
          complemento,
          municipio,
          estado,
          pais,
          cep
        },
        comprovante_url: comprovanteUrl,
        termo_url: termoUrl
      },
      metadata: { origem: 'route:/inscricao' },
      userId: req.userId || null,
      bucket: SUPABASE_STORAGE_BUCKET || null,
      bucketPath: null
    });

    res.json({
      ok: true,
      id: inscricaoId,
      token_acompanhamento: tokenAcompanhamento,
      mensagem: wasRetry
        ? 'Nova tentativa registrada com sucesso.'
        : 'Inscricao enviada com sucesso.'
    });
  } catch (error) {
    return sendApiInternalError(req, res, error, 'Erro ao salvar inscricao.');
  }
});

app.post('/api/acompanhamento', async (req, res) => {
  const { email } = req.body;
  const { rows } = await pool.query('SELECT nome, status, data_inscricao FROM inscricoes WHERE email = $1', [email]);

  if (!rows.length) {
    return res.status(404).json({ erro: 'Inscricao nao encontrada.' });
  }

  res.json(rows[0]);
});

app.get('/candidato/acompanhamento', async (req, res) => {
  const email = String(req.query?.email || '').trim().toLowerCase();
  const token = String(req.query?.token || '').trim();

  if (!email || !token) {
    return res.status(400).json({ erro: 'email e token sao obrigatorios.' });
  }

  const { rows } = await pool.query(
    `
    SELECT
      c.email,
      c.status_atual,
      c.ra_codigo,
      c.tentativas_total,
      c.ultima_atualizacao,
      i.status AS status_inscricao,
      i.data_inscricao
    FROM candidato_acompanhamento c
    LEFT JOIN inscricoes i ON i.email = c.email
    WHERE c.email = $1
      AND c.token_acompanhamento = $2
    LIMIT 1
    `,
    [email, token]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Acompanhamento nao encontrado.' });
  }

  res.json(rows[0]);
});

function createOAuthState({ provider, requestedProfile, sessionType }) {
  const payload = Buffer.from(JSON.stringify({
    provider,
    requested_profile: normalizeLoginProfile(requestedProfile),
    session_type: resolveSessionType(sessionType),
    exp: Date.now() + (10 * 60 * 1000),
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readOAuthState(rawState, expectedProvider) {
  const [payload, providedSignature] = String(rawState || '').split('.');
  if (!payload || !providedSignature) return null;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  const received = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (state.provider !== expectedProvider || Number(state.exp || 0) < Date.now()) return null;
    return state;
  } catch (_) {
    return null;
  }
}

async function findOrCreateOAuthUser({ provider, subject, email, name }) {
  await ensurePlatformSchema();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!subject || !normalizedEmail) throw new Error('Identidade OAuth sem email verificavel.');

  const existingIdentity = await pool.query(
    `SELECT u.* FROM usuario_identidades_oauth i JOIN usuarios u ON u.id = i.usuario_id
     WHERE i.provedor = $1 AND i.assunto_provedor = $2 LIMIT 1`,
    [provider, subject]
  );
  if (existingIdentity.rows[0]) {
    await pool.query('UPDATE usuario_identidades_oauth SET ultimo_login_em = NOW(), email_verificado = $3 WHERE provedor = $1 AND assunto_provedor = $2', [provider, subject, normalizedEmail]);
    return existingIdentity.rows[0];
  }

  let userResult = await pool.query('SELECT * FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [normalizedEmail]);
  let user = userResult.rows[0];
  if (!user) {
    const generatedSecret = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);
    userResult = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
       VALUES ($1, $2, $3, 'cliente', true, NOW()) RETURNING *`,
      [String(name || normalizedEmail.split('@')[0]).slice(0, 160), normalizedEmail, generatedSecret]
    );
    user = userResult.rows[0];
  }

  await pool.query(
    `INSERT INTO usuario_identidades_oauth (usuario_id, provedor, assunto_provedor, email_verificado, ultimo_login_em)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (provedor, assunto_provedor)
     DO UPDATE SET ultimo_login_em = NOW(), email_verificado = EXCLUDED.email_verificado`,
    [user.id, provider, subject, normalizedEmail]
  );
  return user;
}

async function createSessionForUser(req, user, requestedProfile, sessionType) {
  if (!user?.ativo) throw new Error('Conta bloqueada. Contate a administracao.');
  const resolvedSessionType = resolveSessionType(sessionType);
  const config = SESSION_CONFIG[resolvedSessionType];
  const roles = await getUserRoles(user.id, user.tipo_usuario);
  const nivel = await getUserNivel(user.id);
  const profile = resolveLoginProfile({ requestedProfile, tipoUsuario: user.tipo_usuario, nivelCodigo: nivel?.nivel_codigo, roles });
  const jwtId = createIdempotencyKey();
  const token = jwt.sign({ id: user.id, jti: jwtId, session_type: resolvedSessionType }, JWT_SECRET, { expiresIn: config.jwtExpiresIn });
  const expiresAt = new Date(Date.now() + config.maxAgeMs);
  await pool.query(
    `INSERT INTO usuario_sessoes (usuario_id, jwt_id, session_type, ip_origem, user_agent, criado_em, expira_em)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
    [user.id, jwtId, resolvedSessionType, getClientIp(req), req.headers['user-agent'] || null, expiresAt]
  );
  await pool.query('UPDATE usuarios SET ultimo_login_em = NOW(), ultimo_login_ip = $2, ultimo_login_user_agent = $3 WHERE id = $1', [user.id, getClientIp(req), req.headers['user-agent'] || null]);
  return {
    token,
    expiresAt,
    user: {
      id: user.id, nome: user.nome, email: user.email, tipo: user.tipo_usuario, tipo_usuario: user.tipo_usuario,
      nivel, nivel_codigo: nivel?.nivel_codigo || 'neofito', roles,
      perfil_login: profile.selectedProfile, perfis_disponiveis: profile.availableProfiles, home_route: profile.homeRoute
    }
  };
}

function sendOAuthLoginResult(res, session) {
  const loginUrl = new URL('login.html', `${FRONTEND_PUBLIC_BASE_URL.replace(/\/+$/, '')}/`);
  const origin = loginUrl.origin;
  const message = { type: 'ordo-oauth-result', token: session.token, user: session.user, expires_at: session.expiresAt.toISOString() };
  const serialized = JSON.stringify(message).replace(/</g, '\\u003c');
  res.type('html').send(`<!doctype html><html><body><script>const payload=${serialized};if(window.opener){window.opener.postMessage(payload,${JSON.stringify(origin)});window.close();}else{location.replace(${JSON.stringify(loginUrl.toString())}+'#oauth='+encodeURIComponent(btoa(JSON.stringify(payload))));}</script></body></html>`);
}

app.get('/auth/google/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) return res.status(503).json({ erro: 'Login Google indisponivel.' });
  const state = createOAuthState({ provider: 'google', requestedProfile: req.query?.perfil_login, sessionType: req.query?.session_type });
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI);
  res.redirect(client.generateAuthUrl({ access_type: 'online', prompt: 'select_account', scope: ['openid', 'email', 'profile'], state }));
});

app.get('/auth/google/callback', async (req, res) => {
  const state = readOAuthState(req.query?.state, 'google');
  if (!state || !req.query?.code) return res.status(400).send('Autorizacao Google invalida ou expirada.');
  try {
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI);
    const { tokens } = await client.getToken(String(req.query.code));
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email || payload.email_verified !== true) throw new Error('Email Google nao verificado.');
    const user = await findOrCreateOAuthUser({ provider: 'google', subject: payload.sub, email: payload.email, name: payload.name });
    const session = await createSessionForUser(req, user, state.requested_profile, state.session_type);
    res.cookie('auth_token', session.token, getCookieOptions(SESSION_CONFIG[resolveSessionType(state.session_type)].maxAgeMs));
    await logSecurityEvent(req, 'login_google_sucesso', { usuario_id: user.id });
    sendOAuthLoginResult(res, session);
  } catch (_) {
    res.status(401).send('Nao foi possivel concluir o login Google.');
  }
});

app.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    const requestedProfile = normalizeLoginProfile(req.body?.perfil_login || req.body?.profile || req.body?.tipo || '');
    const sessionType = resolveSessionType(req.body?.session_type);
    const sessionConfig = SESSION_CONFIG[sessionType];
    const ip = getClientIp(req);

    if (!email || !senha) {
      await logSecurityEvent(req, 'login_rejeitado_payload_invalido', { email_presente: !!email });
      return res.status(400).json({ erro: 'Email e senha sao obrigatorios.' });
    }

    const lockState = getLoginFailureState(email, ip);
    if (lockState.isLocked) {
      res.setHeader('Retry-After', String(lockState.retryAfterSeconds));
      await logSecurityEvent(req, 'login_bloqueio_forca_bruta', {
        email,
        retry_after_seconds: lockState.retryAfterSeconds
      });
      return res.status(429).json({
        erro: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
        retry_after_seconds: lockState.retryAfterSeconds
      });
    }

    const { rows } = await pool.query('SELECT * FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [email]);
    const user = rows[0];

    if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
      const failure = registerLoginFailure(email, ip);
      await logSecurityEvent(req, 'login_falha_credenciais', { email });
      if (failure.locked) {
        res.setHeader('Retry-After', String(failure.retryAfterSeconds));
      }
      return res.status(401).json({ erro: 'Email ou senha invalidos.' });
    }

    clearLoginFailures(email, ip);

    if (!user.ativo) {
      await logSecurityEvent(req, 'login_falha_usuario_inativo', { usuario_id: user.id, email });
      return res.status(403).json({ erro: 'Conta bloqueada. Contate a administracao.' });
    }

    if (user.tipo_usuario === 'aluno') {
      await markExpiredDisciplinaryActions(user.id);
      const activeBlock = await getActiveBlockingAction(user.id);

      if (activeBlock) {
        return res.status(403).json({ erro: disciplinaryBlockMessage(activeBlock) });
      }
    }

    const userRoles = await getUserRoles(user.id, user.tipo_usuario);
    const userNivel = await getUserNivel(user.id);
    const resolvedProfile = resolveLoginProfile({
      requestedProfile,
      tipoUsuario: user.tipo_usuario,
      nivelCodigo: userNivel?.nivel_codigo,
      roles: userRoles
    });

    if (requestedProfile && !resolvedProfile.availableProfiles.includes(requestedProfile)) {
      await logSecurityEvent(req, 'login_rejeitado_perfil_nao_autorizado', {
        usuario_id: user.id,
        email,
        perfil_solicitado: requestedProfile,
        perfis_disponiveis: resolvedProfile.availableProfiles
      });
      return res.status(403).json({
        erro: `Perfil de acesso "${requestedProfile}" indisponivel para este usuario.`,
        perfis_disponiveis: resolvedProfile.availableProfiles
      });
    }

    const jwtId = createIdempotencyKey();
    const token = jwt.sign(
      { id: user.id, jti: jwtId, session_type: sessionType },
      JWT_SECRET,
      { expiresIn: sessionConfig.jwtExpiresIn }
    );
    const expiraEm = new Date(Date.now() + sessionConfig.maxAgeMs);

    await pool.query(
      `
      INSERT INTO usuario_sessoes (usuario_id, jwt_id, session_type, ip_origem, user_agent, criado_em, expira_em)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      `,
      [user.id, jwtId, sessionType, getClientIp(req), req.headers['user-agent'] || null, expiraEm]
    );

    await pool.query(
      `
      UPDATE usuarios
      SET
        ultimo_login_em = NOW(),
        ultimo_login_ip = $2,
        ultimo_login_user_agent = $3
      WHERE id = $1
      `,
      [user.id, getClientIp(req), req.headers['user-agent'] || null]
    );

    await pool.query(
      `
      INSERT INTO audit_logs
        (usuario_id, acao, recurso, tabela_ref, registro_id, detalhes_json, ip_origem)
      VALUES
        ($1, 'login_sucesso', 'auth', 'usuario_sessoes', $2, $3::jsonb, $4)
      `,
      [
        user.id,
        user.id ? String(user.id) : null,
        JSON.stringify({
          session_type: sessionType,
          jwt_id: jwtId,
          perfil_login: resolvedProfile.selectedProfile
        }),
        getClientIp(req)
      ]
    );

    res.cookie('auth_token', token, getCookieOptions(sessionConfig.maxAgeMs));

    return res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo_usuario,
        tipo_usuario: user.tipo_usuario,
        nivel: userNivel,
        nivel_codigo: userNivel?.nivel_codigo || 'neofito',
        roles: userRoles,
        perfil_login: resolvedProfile.selectedProfile,
        perfis_disponiveis: resolvedProfile.availableProfiles,
        home_route: resolvedProfile.homeRoute
      },
      session: {
        session_type: sessionType,
        expires_at: expiraEm.toISOString()
      }
    });
  } catch (error) {
    return sendApiInternalError(req, res, error, 'Falha ao autenticar no momento.');
  }
});

app.post('/logout', auth, async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE usuario_sessoes
      SET revogado_em = NOW(), revogado_por_id = $2, motivo_revogacao = 'logout'
      WHERE usuario_id = $1
        AND jwt_id = $3
        AND revogado_em IS NULL
      `,
      [req.userId, req.userId, req.sessionJwtId]
    );

    await logAudit(req, 'logout', 'auth', 'usuario_sessoes', req.userId, {
      session_jwt_id: req.sessionJwtId
    });
  } catch (error) {
    console.error(error);
  }

  res.cookie('auth_token', '', {
    ...getCookieOptions(0),
    maxAge: 0
  });

  res.json({ ok: true });
});

app.post('/auth/admin-gate', loginRateLimiter, async (req, res) => {
  const passcode = String(req.body?.senha_acesso || '').trim();

  if (!ADMIN_AREA_SHARED_PASSCODE) {
    return res.status(503).json({
      erro: 'Gate administrativo nao configurado. Defina ADMIN_AREA_SHARED_PASSCODE no ambiente.'
    });
  }

  if (!passcode) {
    return res.status(400).json({ erro: 'senha_acesso obrigatoria.' });
  }

  if (!safeEqualsSecret(passcode, ADMIN_AREA_SHARED_PASSCODE)) {
    await logSecurityEvent(req, 'admin_gate_rejeitado', { motivo: 'senha_invalida' });
    return res.status(401).json({ erro: 'Senha de acesso administrativo invalida.' });
  }

  await logSecurityEvent(req, 'admin_gate_liberado', {});
  return res.json({ ok: true });
});

app.get('/auth/sessoes', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      session_type,
      ip_origem,
      user_agent,
      criado_em,
      expira_em,
      revogado_em,
      (jwt_id = $2) AS atual
    FROM usuario_sessoes
    WHERE usuario_id = $1
    ORDER BY criado_em DESC
    LIMIT 20
    `,
    [req.userId, req.sessionJwtId]
  );

  res.json({ usuario_id: req.userId, sessoes: rows });
});

app.post('/auth/sessoes/:id/revogar', auth, async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ erro: 'ID de sessao invalido.' });
  }

  const result = await pool.query(
    `
    UPDATE usuario_sessoes
    SET revogado_em = NOW(), revogado_por_id = $2, motivo_revogacao = COALESCE($3, 'revogada pelo usuario')
    WHERE id = $1
      AND usuario_id = $2
      AND revogado_em IS NULL
    RETURNING id
    `,
    [sessionId, req.userId, toNullableTrimmedString(req.body?.motivo)]
  );

  if (!result.rows.length) {
    return res.status(404).json({ erro: 'Sessao nao encontrada para revogacao.' });
  }

  res.json({ ok: true, sessao_id: sessionId });
});

app.get('/perfil/preferencias-app', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT usuario_id, idioma, acessibilidade_json, tema, ultima_origem, atualizado_em
    FROM usuario_app_preferencias
    WHERE usuario_id = $1
    `,
    [req.userId]
  );

  res.json({
    usuario_id: req.userId,
    preferencias: rows[0] || {
      usuario_id: req.userId,
      idioma: 'pt-BR',
      acessibilidade_json: {},
      tema: 'sistema',
      ultima_origem: null,
      atualizado_em: null
    }
  });
});

app.post('/perfil/preferencias-app', auth, async (req, res) => {
  const idioma = String(req.body?.idioma || 'pt-BR').trim() || 'pt-BR';
  const tema = String(req.body?.tema || 'sistema').trim() || 'sistema';
  const origem = String(req.body?.origem || 'site').trim() || 'site';
  const acessibilidadeJson = req.body?.acessibilidade && typeof req.body.acessibilidade === 'object'
    ? req.body.acessibilidade
    : {};

  const { rows } = await pool.query(
    `
    INSERT INTO usuario_app_preferencias
      (usuario_id, idioma, acessibilidade_json, tema, ultima_origem, atualizado_em)
    VALUES
      ($1, $2, $3::jsonb, $4, $5, NOW())
    ON CONFLICT (usuario_id)
    DO UPDATE SET
      idioma = EXCLUDED.idioma,
      acessibilidade_json = EXCLUDED.acessibilidade_json,
      tema = EXCLUDED.tema,
      ultima_origem = EXCLUDED.ultima_origem,
      atualizado_em = NOW()
    RETURNING *
    `,
    [req.userId, idioma, JSON.stringify(acessibilidadeJson), tema, origem]
  );

  await logAudit(req, 'atualizar_preferencias_app', 'perfil', 'usuario_app_preferencias', req.userId, {
    idioma,
    tema,
    origem
  });

  res.json({ ok: true, preferencias: rows[0] });
});

app.get('/assinatura/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      usuario_id,
      plano_codigo,
      status,
      valor_mensal,
      moeda,
      ciclo_dias,
      inicio_em,
      proxima_cobranca_em,
      origem_pedido_id,
      observacao,
      atualizado_em
    FROM usuario_assinaturas
    WHERE usuario_id = $1
    `,
    [req.userId]
  );

  res.json({
    usuario_id: req.userId,
    assinatura: rows[0] || null
  });
});

app.get('/auth/memoria', auth, async (req, res) => {
  const [sessoesResult, preferenciasAppResult, assinaturaResult, preferenciaPagamentoResult] = await Promise.all([
    pool.query(
      `
      SELECT id, session_type, ip_origem, criado_em, expira_em, revogado_em
      FROM usuario_sessoes
      WHERE usuario_id = $1
      ORDER BY criado_em DESC
      LIMIT 10
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT idioma, acessibilidade_json, tema, ultima_origem, atualizado_em
      FROM usuario_app_preferencias
      WHERE usuario_id = $1
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT plano_codigo, status, valor_mensal, moeda, ciclo_dias, inicio_em, proxima_cobranca_em, atualizado_em
      FROM usuario_assinaturas
      WHERE usuario_id = $1
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT dia_pagamento, data_vigencia, mensagem_alerta, atualizado_em
      FROM pagamento_preferencias
      WHERE usuario_id = $1
      `,
      [req.userId]
    )
  ]);

  res.json({
    usuario: {
      id: req.user.id,
      nome: req.user.nome,
      email: req.user.email,
      tipo_usuario: req.user.tipo_usuario
    },
    memoria: {
      sessoes: sessoesResult.rows,
      preferencias_app: preferenciasAppResult.rows[0] || null,
      assinatura: assinaturaResult.rows[0] || null,
      preferencia_pagamento: preferenciaPagamentoResult.rows[0] || null
    }
  });
});

app.post('/concluir-cadastro', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const nome = String(req.body?.nome || '').trim();
  const senha = String(req.body?.senha || '');

  if (!email || !nome || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha sao obrigatorios.' });
  }

  try {
    const { rows: inscricao } = await pool.query(
      "SELECT id FROM inscricoes WHERE lower(email) = lower($1) AND status = 'aprovado'",
      [email]
    );

    if (!inscricao.length) {
      return res.status(403).json({ erro: 'Email sem inscricao aprovada.' });
    }

    const { rows: usuarioExistente } = await pool.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [email]);

    if (usuarioExistente.length) {
      return res.status(400).json({ erro: 'Usuario ja cadastrado.' });
    }

    const passwordCheck = validatePasswordStrength(senha);
    if (!passwordCheck.ok) {
      return res.status(400).json({ erro: passwordCheck.erro });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    await pool.query(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario) VALUES ($1, $2, $3, 'aluno')",
      [nome, email, senhaHash]
    );

    await pool.query(
      `
      INSERT INTO usuario_assinaturas
        (usuario_id, plano_codigo, status, valor_mensal, moeda, ciclo_dias, atualizado_em, observacao)
      SELECT id, 'membro_base', 'pendente', 80.00, 'BRL', 30, NOW(), 'Cadastro concluido aguardando primeiro pagamento.'
      FROM usuarios
      WHERE lower(email) = lower($1)
      ON CONFLICT (usuario_id) DO NOTHING
      `,
      [email]
    );

    res.json({ ok: true });
  } catch (error) {
    return sendApiInternalError(req, res, error, 'Erro interno ao criar usuario.');
  }
});

app.get('/produtos', async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM produtos
    WHERE ativo = true
      AND deleted_at IS NULL
      AND status_moderacao = 'aprovado'
    ORDER BY id DESC
    `
  );
  res.json(rows);
});

// --- ÁREA DO LOJISTA ---

app.get('/lojista/meus-produtos', auth, requireLojista, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM produtos WHERE vendedor_id = $1 AND deleted_at IS NULL ORDER BY id DESC',
    [req.userId]
  );
  res.json(rows);
});

app.post('/lojista/produtos', auth, requireLojista, async (req, res) => {
  const { nome, preco, descricao, tipo, estoque, url_contato_direto } = req.body;

  if (!nome || !preco || !tipo) {
    return res.status(400).json({ erro: 'Nome, preço e tipo são obrigatórios.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO produtos (nome, preco, descricao, tipo, estoque, vendedor_id, url_contato_direto, ativo, status_moderacao, aprovado_admin_id, aprovado_em, comentario_moderacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'pendente', NULL, NULL, NULL) RETURNING *`,
    [nome, preco, descricao, tipo, estoque || 0, req.userId, url_contato_direto]
  );

  await logAudit(req, 'cadastrar_produto_lojista', 'loja', 'produtos', rows[0].id);
  await trySaveUniversalArchive({
    chave: `produto:${rows[0].id}:${Date.now()}`,
    tipoRecurso: 'loja',
    subtipo: 'produto_criado',
    payload: rows[0],
    metadata: { origem: 'route:/lojista/produtos' },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });
  res.status(201).json(rows[0]);
});

app.put('/lojista/produtos/:id', auth, requireLojista, async (req, res) => {
  const { id } = req.params;
  const { nome, preco, descricao, tipo, estoque, url_contato_direto } = req.body;

  const { rows } = await pool.query(
    `UPDATE produtos SET 
      nome = COALESCE($1, nome),
      preco = COALESCE($2, preco),
      descricao = COALESCE($3, descricao),
      tipo = COALESCE($4, tipo),
      estoque = COALESCE($5, estoque),
      url_contato_direto = COALESCE($6, url_contato_direto),
      ativo = false,
      status_moderacao = 'pendente',
      aprovado_admin_id = NULL,
      aprovado_em = NULL,
      comentario_moderacao = NULL
     WHERE id = $8 AND vendedor_id = $9 RETURNING *`,
    [nome, preco, descricao, tipo, estoque, url_contato_direto, id, req.userId]
  );

  if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado ou sem permissão.' });
  await trySaveUniversalArchive({
    chave: `produto:${id}:${Date.now()}`,
    tipoRecurso: 'loja',
    subtipo: 'produto_atualizado',
    payload: rows[0],
    metadata: { origem: 'route:PUT /lojista/produtos/:id' },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });
  res.json(rows[0]);
});

app.delete('/lojista/produtos/:id', auth, requireLojista, async (req, res) => {
  const { id } = req.params;
  await pool.query(
    'UPDATE produtos SET deleted_at = NOW(), ativo = false WHERE id = $1 AND vendedor_id = $2',
    [id, req.userId]
  );
  await trySaveUniversalArchive({
    chave: `produto:${id}:${Date.now()}`,
    tipoRecurso: 'loja',
    subtipo: 'produto_excluido',
    payload: { produto_id: Number(id), deleted_at: new Date().toISOString(), ativo: false },
    metadata: { origem: 'route:DELETE /lojista/produtos/:id' },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });
  res.json({ ok: true });
});

app.get('/admin/loja/produtos-pendentes', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.tipo,
      p.estoque,
      p.descricao,
      p.url_contato_direto,
      p.status_moderacao,
      p.ativo,
      p.vendedor_id,
      p.comentario_moderacao,
      u.nome AS vendedor_nome,
      u.email AS vendedor_email
    FROM produtos p
    LEFT JOIN usuarios u ON u.id = p.vendedor_id
    WHERE p.deleted_at IS NULL
      AND p.status_moderacao = 'pendente'
    ORDER BY p.id DESC
    LIMIT 500
    `
  );

  res.json(rows);
});

app.post('/admin/loja/produtos/:id/aprovar', auth, requireAdmin, async (req, res) => {
  const produtoId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!produtoId) {
    return res.status(400).json({ erro: 'ID do produto invalido.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE produtos
    SET
      status_moderacao = 'aprovado',
      ativo = true,
      aprovado_admin_id = $2,
      aprovado_em = NOW(),
      comentario_moderacao = $3
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING *
    `,
    [produtoId, req.userId, comentario]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Produto nao encontrado.' });
  }

  await logAudit(req, 'aprovar_produto_lojista', 'loja', 'produtos', produtoId, {});
  res.json({ ok: true, produto: rows[0] });
});

app.post('/admin/loja/produtos/:id/reprovar', auth, requireAdmin, async (req, res) => {
  const produtoId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || 'Produto reprovado pela administracao.';

  if (!produtoId) {
    return res.status(400).json({ erro: 'ID do produto invalido.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE produtos
    SET
      status_moderacao = 'reprovado',
      ativo = false,
      aprovado_admin_id = $2,
      aprovado_em = NOW(),
      comentario_moderacao = $3
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING *
    `,
    [produtoId, req.userId, comentario]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Produto nao encontrado.' });
  }

  await logAudit(req, 'reprovar_produto_lojista', 'loja', 'produtos', produtoId, { comentario });
  res.json({ ok: true, produto: rows[0] });
});

// --- SISTEMA DE NOTIFICAÇÕES ---

async function enviarNotificacaoCompra(pedidoId, usuarioId) {
  try {
    const { rows } = await pool.query(
      `SELECT u.nome, u.email, i.telefone, p.total 
       FROM pedidos p 
       JOIN usuarios u ON u.id = p.usuario_id 
       LEFT JOIN inscricoes i ON i.email = u.email
       WHERE p.id = $1`,
      [pedidoId]
    );
    
    const dados = rows[0];
    if (!dados) return;

    const mensagem = `Olá ${dados.nome}, sua compra na Ordo Caoti no valor de R$ ${dados.total} foi registrada! Status: Pendente.`;

    // Notificação WhatsApp
    if (dados.telefone) {
      await sendWhatsAppNotification({ to: dados.telefone, message });
    }

    // Notificação E-mail
    await sendEmailNotification({ 
      to: dados.email, 
      subject: 'Pedido Recebido - Ordo Caoti', 
      message 
    });

    await pool.query(
      "INSERT INTO notifications (usuario_id, tipo, mensagem, canal, enviado) VALUES ($1, 'compra', $2, 'multichannel', true)",
      [usuarioId, mensagem]
    );
  } catch (err) {
    console.error('Erro ao enviar notificações de compra:', err.message);
  }
}

app.get('/api/search', async (req, res) => {
  const query = String(req.query?.q || '').trim();
  const scope = String(req.query?.scope || req.query?.tipo || 'all').trim().toLowerCase();
  const limit = Math.min(30, Math.max(1, Number(req.query?.limit || 12)));

  if (query.length < 2) {
    return res.json({
      q: query,
      scope,
      total: 0,
      results: []
    });
  }

  const like = `%${query.replace(/\s+/g, '%')}%`;
  const results = [];

  try {
    if (['all', 'produtos', 'loja', 'shop'].includes(scope)) {
      const produtosResult = await pool.query(
        `
        SELECT
          id,
          nome AS titulo,
          COALESCE(descricao, '') AS descricao,
          'produto'::text AS categoria,
          '/loja'::text AS rota,
          preco::text AS valor
        FROM produtos
        WHERE ativo = true
          AND (nome ILIKE $1 OR COALESCE(descricao, '') ILIKE $1)
        ORDER BY nome ASC
        LIMIT $2
        `,
        [like, limit]
      );
      results.push(...produtosResult.rows);
    }

    if (['all', 'escola', 'conteudo', 'materias'].includes(scope)) {
      const materiasResult = await pool.query(
        `
        SELECT
          m.id,
          m.nome AS titulo,
          COALESCE(m.descricao, '') AS descricao,
          'materia'::text AS categoria,
          '/dashboard-aluno'::text AS rota,
          NULL::text AS valor
        FROM materias m
        WHERE m.ativa = true
          AND (m.nome ILIKE $1 OR COALESCE(m.descricao, '') ILIKE $1)
        ORDER BY m.data_criacao DESC
        LIMIT $2
        `,
        [like, limit]
      );

      const turmasResult = await pool.query(
        `
        SELECT
          t.id,
          t.nome AS titulo,
          'Turma ativa da escola Ordo Caoti.'::text AS descricao,
          'turma'::text AS categoria,
          '/dashboard-aluno'::text AS rota,
          NULL::text AS valor
        FROM turmas t
        WHERE t.nome ILIKE $1
        ORDER BY t.nome ASC
        LIMIT $2
        `,
        [like, Math.max(1, Math.floor(limit / 2))]
      );

      results.push(...materiasResult.rows, ...turmasResult.rows);
    }

    const normalizedQuery = query.toLowerCase();
    const ordered = results
      .map((row) => {
        const titulo = String(row.titulo || '').toLowerCase();
        const descricao = String(row.descricao || '').toLowerCase();
        const score = (titulo.startsWith(normalizedQuery) ? 5 : 0)
          + (titulo.includes(normalizedQuery) ? 3 : 0)
          + (descricao.includes(normalizedQuery) ? 1 : 0);
        return { ...row, score };
      })
      .sort((a, b) => b.score - a.score || String(a.titulo).localeCompare(String(b.titulo)))
      .slice(0, limit)
      .map(({ score, ...row }) => row);

    return res.json({
      q: query,
      scope,
      total: ordered.length,
      results: ordered
    });
  } catch (error) {
    return res.status(500).json({ erro: 'Falha ao executar busca.' });
  }
});

app.post('/compra', auth, async (req, res) => {
  const { produto_id } = req.body;
  const { rows: produtos } = await pool.query('SELECT preco FROM produtos WHERE id = $1', [produto_id]);

  if (!produtos.length) {
    return res.status(404).json({ erro: 'Produto nao encontrado.' });
  }

  await pool.query('INSERT INTO pedidos (usuario_id, total) VALUES ($1, $2)', [req.userId, produtos[0].preco]);
  
  // Gatilho de notificação automática
  enviarNotificacaoCompra(req.userId, produtos[0].preco); // Exemplo simplificado
  res.json({ ok: true });
});

app.get('/minhas-turmas', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT at.*, t.nome, t.conteudo_aprovado
    FROM alunos_turmas at
    JOIN turmas t ON at.turma_id = t.id
    WHERE at.aluno_id = $1 AND at.status = 'ativo'
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/api/financeiro', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT p.id, p.total, p.status, p.data_pedido, prod.nome AS descricao
    FROM pedidos p
    LEFT JOIN produtos prod ON p.total = prod.preco
    WHERE p.usuario_id = $1
    ORDER BY p.data_pedido DESC
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/api/boletim', auth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT s.nota_final, p.titulo AS prova, t.nome AS turma
    FROM submissoes_avaliacoes s
    JOIN provas p ON s.prova_id = p.id
    JOIN turmas t ON p.turma_id = t.id
    WHERE s.aluno_id = $1 AND s.status = 'corrigida'
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/api/materias-disponiveis', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM turmas WHERE id NOT IN (SELECT turma_id FROM alunos_turmas WHERE aluno_id = $1)',
    [req.userId]
  );

  res.json(rows);
});

app.get('/rbac/me', auth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      nome: req.user.nome,
      email: req.user.email,
      tipo_usuario: req.user.tipo_usuario
    },
    nivel: req.user.nivel,
    roles: req.user.roles,
    permissoes: req.user.permissoes
  });
});

app.get('/rbac/permissoes', auth, requireAdminOrTi, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT papel, permissao, ativo
    FROM papel_permissoes
    ORDER BY papel, permissao
    `
  );

  res.json(rows);
});

const USER_TYPES = ['aluno', 'admin', 'professor', 'lojista', 'ti', 'cliente'];

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'sim', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'não', 'no'].includes(normalized)) return false;
  return null;
}

app.get('/admin/usuarios', auth, requireAdminOrTi, async (req, res) => {
  const search = String(req.query?.search || '').trim();
  const tipoUsuario = String(req.query?.tipo_usuario || '').trim().toLowerCase();
  const ativoFilter = parseOptionalBoolean(req.query?.ativo);
  const page = Math.max(1, Number(req.query?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 20));
  const offset = (page - 1) * limit;

  if (tipoUsuario && !USER_TYPES.includes(tipoUsuario)) {
    return res.status(400).json({ erro: 'tipo_usuario invalido.' });
  }

  const where = [];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    where.push(`(u.nome ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }

  if (tipoUsuario) {
    values.push(tipoUsuario);
    where.push(`u.tipo_usuario = $${values.length}`);
  }

  if (ativoFilter !== null) {
    values.push(ativoFilter);
    where.push(`u.ativo = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM usuarios u
    ${whereSql}
    `,
    values
  );

  values.push(limit, offset);
  const rowsResult = await pool.query(
    `
    SELECT
      u.id,
      u.nome,
      u.email,
      u.tipo_usuario,
      u.ativo,
      u.data_cadastro,
      un.nivel_codigo
    FROM usuarios u
    LEFT JOIN usuario_niveis un ON un.usuario_id = u.id
    ${whereSql}
    ORDER BY u.id DESC
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
    `,
    values
  );

  res.json({
    total: totalResult.rows[0]?.total || 0,
    page,
    limit,
    items: rowsResult.rows
  });
});

app.post('/admin/usuarios', auth, requireAdminOrTi, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const tipoUsuario = String(req.body?.tipo_usuario || '').trim().toLowerCase();
  const ativo = parseOptionalBoolean(req.body?.ativo);

  if (!nome || !email || !senha || !tipoUsuario) {
    return res.status(400).json({ erro: 'nome, email, senha e tipo_usuario sao obrigatorios.' });
  }

  if (!USER_TYPES.includes(tipoUsuario)) {
    return res.status(400).json({ erro: 'tipo_usuario invalido.' });
  }

  const passwordValidation = validatePasswordStrength(senha);
  if (!passwordValidation.ok) {
    return res.status(400).json({ erro: passwordValidation.erro });
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  try {
    const result = await pool.query(
      `
      INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
      VALUES ($1, $2, $3, $4, COALESCE($5, true), NOW())
      RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro
      `,
      [nome, email, senhaHash, tipoUsuario, ativo]
    );

    await logAudit(req, 'criar_usuario', 'usuarios', 'usuarios', result.rows[0].id, {
      email,
      tipo_usuario: tipoUsuario
    });

    return res.status(201).json({ ok: true, usuario: result.rows[0] });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ erro: 'Ja existe usuario com este email.' });
    }
    throw error;
  }
});

app.put('/admin/usuarios/:id', auth, requireAdminOrTi, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const nome = req.body?.nome === undefined ? undefined : String(req.body?.nome || '').trim();
  const email = req.body?.email === undefined ? undefined : String(req.body?.email || '').trim().toLowerCase();
  const senha = req.body?.senha === undefined ? undefined : String(req.body?.senha || '');
  const tipoUsuario = req.body?.tipo_usuario === undefined ? undefined : String(req.body?.tipo_usuario || '').trim().toLowerCase();
  const ativo = parseOptionalBoolean(req.body?.ativo);

  if (!usuarioId) {
    return res.status(400).json({ erro: 'usuario_id invalido.' });
  }

  if (nome !== undefined && !nome) {
    return res.status(400).json({ erro: 'nome nao pode ser vazio.' });
  }

  if (email !== undefined && !email) {
    return res.status(400).json({ erro: 'email nao pode ser vazio.' });
  }

  if (tipoUsuario !== undefined && !USER_TYPES.includes(tipoUsuario)) {
    return res.status(400).json({ erro: 'tipo_usuario invalido.' });
  }

  const updates = [];
  const values = [];

  if (nome !== undefined) {
    values.push(nome);
    updates.push(`nome = $${values.length}`);
  }

  if (email !== undefined) {
    values.push(email);
    updates.push(`email = $${values.length}`);
  }

  if (tipoUsuario !== undefined) {
    values.push(tipoUsuario);
    updates.push(`tipo_usuario = $${values.length}`);
  }

  if (req.body?.ativo !== undefined) {
    if (ativo === null) {
      return res.status(400).json({ erro: 'ativo deve ser booleano.' });
    }
    values.push(ativo);
    updates.push(`ativo = $${values.length}`);
  }

  if (senha !== undefined) {
    const passwordValidation = validatePasswordStrength(senha);
    if (!passwordValidation.ok) {
      return res.status(400).json({ erro: passwordValidation.erro });
    }
    const senhaHash = await bcrypt.hash(senha, 10);
    values.push(senhaHash);
    updates.push(`senha_hash = $${values.length}`);
  }

  if (!updates.length) {
    return res.status(400).json({ erro: 'Nenhum campo valido informado para atualizacao.' });
  }

  values.push(usuarioId);

  try {
    const result = await pool.query(
      `
      UPDATE usuarios
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro
      `,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    }

    await logAudit(req, 'atualizar_usuario', 'usuarios', 'usuarios', usuarioId, {
      campos: Object.keys(req.body || {})
    });

    return res.json({ ok: true, usuario: result.rows[0] });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ erro: 'Ja existe usuario com este email.' });
    }
    throw error;
  }
});

app.delete('/admin/usuarios/:id', auth, requireAdminOrTi, async (req, res) => {
  const usuarioId = Number(req.params.id);
  if (!usuarioId) {
    return res.status(400).json({ erro: 'usuario_id invalido.' });
  }

  if (Number(req.userId) === usuarioId) {
    return res.status(400).json({ erro: 'Nao e permitido excluir o proprio usuario autenticado.' });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM usuarios
      WHERE id = $1
      RETURNING id, nome, email, tipo_usuario
      `,
      [usuarioId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    }

    await logAudit(req, 'excluir_usuario', 'usuarios', 'usuarios', usuarioId, {
      email: result.rows[0].email,
      tipo_usuario: result.rows[0].tipo_usuario
    });

    return res.json({ ok: true, usuario: result.rows[0] });
  } catch (error) {
    if (error?.code === '23503') {
      return res.status(409).json({
        erro: 'Usuario vinculado a outros registros. Desative o usuario (ativo=false) em vez de excluir.'
      });
    }
    throw error;
  }
});

app.patch('/admin/usuarios/:id/nivel', auth, requireAdminOrTi, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const nivelCodigo = String(req.body?.nivel_codigo || '').trim().toLowerCase();
  const observacao = String(req.body?.observacao || '').trim() || null;

  if (!usuarioId || !PERFIS_HIERARQUIA.includes(nivelCodigo)) {
    return res.status(400).json({ erro: 'usuario_id e nivel_codigo valido sao obrigatorios.' });
  }

  const { rows: usuarioRows } = await pool.query('SELECT id, nome, tipo_usuario FROM usuarios WHERE id = $1', [usuarioId]);
  if (!usuarioRows.length) {
    return res.status(404).json({ erro: 'Usuario nao encontrado.' });
  }

  const result = await pool.query(
    `
    INSERT INTO usuario_niveis (usuario_id, nivel_codigo, observacao, atualizado_por_id, atualizado_em)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (usuario_id)
    DO UPDATE SET
      nivel_codigo = EXCLUDED.nivel_codigo,
      observacao = EXCLUDED.observacao,
      atualizado_por_id = EXCLUDED.atualizado_por_id,
      atualizado_em = NOW()
    RETURNING *
    `,
    [usuarioId, nivelCodigo, observacao, req.userId]
  );

  await logAudit(req, 'atualizar_nivel', 'rbac', 'usuario_niveis', usuarioId, { nivel_codigo: nivelCodigo });

  res.json({ ok: true, nivel: result.rows[0] });
});

app.post('/admin/usuarios/:id/permissoes', auth, requireAdminOrTi, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const papeis = Array.isArray(req.body?.papeis) ? req.body.papeis : [];

  if (!usuarioId || !papeis.length) {
    return res.status(400).json({ erro: 'usuario_id e papeis sao obrigatorios.' });
  }

  const normalized = [...new Set(papeis.map((p) => String(p).trim().toLowerCase()).filter(Boolean))];
  const invalid = normalized.filter((p) => !PAPEIS_SISTEMA.includes(p));
  if (invalid.length) {
    return res.status(400).json({ erro: `Papeis invalidos: ${invalid.join(', ')}` });
  }

  const usuarioResult = await pool.query(
    `
    SELECT u.id, u.tipo_usuario, un.nivel_codigo
    FROM usuarios u
    LEFT JOIN usuario_niveis un ON un.usuario_id = u.id
    WHERE u.id = $1
    LIMIT 1
    `,
    [usuarioId]
  );
  const usuarioAlvo = usuarioResult.rows[0];
  if (!usuarioAlvo) {
    return res.status(404).json({ erro: 'Usuario alvo nao encontrado.' });
  }

  const nivelCodigo = normalizeNivelCodigo(usuarioAlvo.nivel_codigo || 'neofito');
  if (normalized.includes('lojista') && !isNivelAtLeast(nivelCodigo, 'mago_n1')) {
    return res.status(400).json({
      erro: 'Perfil lojista exige nivel minimo mago_n1. Neofitos nao podem vender na loja.'
    });
  }

  if (normalized.includes('professor') && requiresProfessorAuthorizationByNivel(nivelCodigo)) {
    const autorizacao = await getProfessorAuthorizationStatus(usuarioId);
    if (!(autorizacao.has_admin && autorizacao.has_sabio && autorizacao.has_fundador)) {
      return res.status(400).json({
        erro: 'Professor mago_n1/mago_n2 exige autorizacao completa (admin + sabio + fundador).',
        autorizacao
      });
    }
  }

  await pool.query('DELETE FROM usuario_papeis WHERE usuario_id = $1', [usuarioId]);

  for (const papel of normalized) {
    await pool.query(
      `
      INSERT INTO usuario_papeis (usuario_id, papel, concedido_por_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (usuario_id, papel) DO NOTHING
      `,
      [usuarioId, papel, req.userId]
    );
  }

  await logAudit(req, 'atualizar_papeis', 'rbac', 'usuario_papeis', usuarioId, { papeis: normalized });
  res.json({ ok: true, usuario_id: usuarioId, papeis: normalized });
});

app.post('/admin/usuarios/:id/professor-autorizacao', auth, requireAuditoria, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const observacao = String(req.body?.observacao || '').trim() || null;

  if (!usuarioId) {
    return res.status(400).json({ erro: 'usuario_id invalido.' });
  }

  const usuarioTargetResult = await pool.query(
    `
    SELECT u.id, u.tipo_usuario, un.nivel_codigo
    FROM usuarios u
    LEFT JOIN usuario_niveis un ON un.usuario_id = u.id
    WHERE u.id = $1
    LIMIT 1
    `,
    [usuarioId]
  );

  const usuarioTarget = usuarioTargetResult.rows[0];
  if (!usuarioTarget) {
    return res.status(404).json({ erro: 'Usuario nao encontrado.' });
  }

  const nivelCodigo = normalizeNivelCodigo(usuarioTarget.nivel_codigo || 'neofito');
  if (!requiresProfessorAuthorizationByNivel(nivelCodigo)) {
    return res.status(400).json({ erro: 'Este nivel nao exige autorizacao adicional para professor.' });
  }

  const isAdminApprover = ['admin', 'ti'].includes(req.user.tipo_usuario);
  const isFounderApprover = req.user.is_founder === true;
  const isSabioApprover = req.user.is_sage === true || isNivelAtLeast(req.user?.nivel?.nivel_codigo, 'sabio');

  if (!isAdminApprover && !isFounderApprover && !isSabioApprover) {
    return res.status(403).json({ erro: 'Perfil sem permissao para aprovar professor.' });
  }

  const updateResult = await pool.query(
    `
    INSERT INTO professor_autorizacoes
      (
        usuario_id,
        aprovado_admin_id,
        aprovado_admin_em,
        aprovado_sabio_id,
        aprovado_sabio_em,
        aprovado_fundador_id,
        aprovado_fundador_em,
        observacao,
        atualizado_em
      )
    VALUES
      (
        $1,
        $2,
        CASE WHEN $2 IS NOT NULL THEN NOW() ELSE NULL END,
        $3,
        CASE WHEN $3 IS NOT NULL THEN NOW() ELSE NULL END,
        $4,
        CASE WHEN $4 IS NOT NULL THEN NOW() ELSE NULL END,
        $5,
        NOW()
      )
    ON CONFLICT (usuario_id)
    DO UPDATE SET
      aprovado_admin_id = COALESCE(EXCLUDED.aprovado_admin_id, professor_autorizacoes.aprovado_admin_id),
      aprovado_admin_em = COALESCE(EXCLUDED.aprovado_admin_em, professor_autorizacoes.aprovado_admin_em),
      aprovado_sabio_id = COALESCE(EXCLUDED.aprovado_sabio_id, professor_autorizacoes.aprovado_sabio_id),
      aprovado_sabio_em = COALESCE(EXCLUDED.aprovado_sabio_em, professor_autorizacoes.aprovado_sabio_em),
      aprovado_fundador_id = COALESCE(EXCLUDED.aprovado_fundador_id, professor_autorizacoes.aprovado_fundador_id),
      aprovado_fundador_em = COALESCE(EXCLUDED.aprovado_fundador_em, professor_autorizacoes.aprovado_fundador_em),
      observacao = COALESCE(EXCLUDED.observacao, professor_autorizacoes.observacao),
      atualizado_em = NOW()
    RETURNING *
    `,
    [
      usuarioId,
      isAdminApprover ? req.userId : null,
      isSabioApprover ? req.userId : null,
      isFounderApprover ? req.userId : null,
      observacao
    ]
  );

  const status = await getProfessorAuthorizationStatus(usuarioId);
  await logAudit(req, 'aprovar_professor', 'rbac', 'professor_autorizacoes', usuarioId, {
    admin: status.has_admin,
    sabio: status.has_sabio,
    fundador: status.has_fundador
  });

  res.json({
    ok: true,
    autorizacao: updateResult.rows[0],
    status
  });
});

app.get('/auditoria/atividades', auth, requireAuditoria, async (req, res) => {
  const limite = Math.min(400, Math.max(1, Number(req.query?.limite || 120)));
  const usuarioId = req.query?.usuario_id ? Number(req.query.usuario_id) : null;
  const rota = String(req.query?.rota || '').trim() || null;
  const metodo = String(req.query?.metodo || '').trim().toUpperCase() || null;

  const clauses = [];
  const params = [];
  let idx = 1;

  if (usuarioId) {
    clauses.push(`al.usuario_id = $${idx++}`);
    params.push(usuarioId);
  }
  if (rota) {
    clauses.push(`al.rota ILIKE $${idx++}`);
    params.push(`%${rota}%`);
  }
  if (metodo) {
    clauses.push(`al.metodo = $${idx++}`);
    params.push(metodo);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limite);

  const { rows } = await pool.query(
    `
    SELECT
      al.id,
      al.usuario_id,
      u.nome AS usuario_nome,
      u.email AS usuario_email,
      al.tipo_usuario,
      al.nivel_codigo,
      al.metodo,
      al.rota,
      al.status_http,
      al.request_id,
      al.ip_origem,
      al.payload_json,
      al.response_json,
      al.criado_em
    FROM atividade_logs al
    LEFT JOIN usuarios u ON u.id = al.usuario_id
    ${where}
    ORDER BY al.criado_em DESC
    LIMIT $${idx}
    `,
    params
  );

  res.json(rows);
});

app.get('/auditoria/atividades/:id/comentarios', auth, requireAuditoria, async (req, res) => {
  const atividadeId = Number(req.params.id);
  if (!atividadeId) {
    return res.status(400).json({ erro: 'atividade_id invalido.' });
  }

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.atividade_id,
      c.comentario,
      c.criado_em,
      u.id AS autor_id,
      u.nome AS autor_nome,
      u.email AS autor_email
    FROM atividade_logs_comentarios c
    JOIN usuarios u ON u.id = c.comentado_por_id
    WHERE c.atividade_id = $1
    ORDER BY c.criado_em DESC
    `,
    [atividadeId]
  );

  res.json(rows);
});

app.post('/auditoria/atividades/:id/comentarios', auth, requireAuditoria, async (req, res) => {
  const atividadeId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim();

  if (!atividadeId || !comentario) {
    return res.status(400).json({ erro: 'atividade_id e comentario sao obrigatorios.' });
  }

  const atividadeResult = await pool.query('SELECT id FROM atividade_logs WHERE id = $1', [atividadeId]);
  if (!atividadeResult.rows.length) {
    return res.status(404).json({ erro: 'Atividade nao encontrada.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO atividade_logs_comentarios
      (atividade_id, comentado_por_id, comentario, criado_em)
    VALUES ($1, $2, $3, NOW())
    RETURNING *
    `,
    [atividadeId, req.userId, comentario]
  );

  await logAudit(req, 'comentar_atividade', 'auditoria', 'atividade_logs_comentarios', atividadeId, {});
  res.status(201).json(rows[0]);
});

app.get('/admin/inscricoes-lista', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM inscricoes ORDER BY data_inscricao DESC');
  res.json(rows);
});

app.post('/admin/decisao-inscricao', auth, requireAdmin, async (req, res) => {
  const { id, status } = req.body;

  if (!['aprovado', 'negado', 'pendente'].includes(status)) {
    return res.status(400).json({ erro: 'Status invalido.' });
  }

  const { rows: inscricaoRows } = await pool.query('SELECT id, email, nome FROM inscricoes WHERE id = $1', [id]);
  if (!inscricaoRows.length) {
    return res.status(404).json({ erro: 'Inscricao nao encontrada.' });
  }

  const inscricao = inscricaoRows[0];
  await pool.query(
    `
    UPDATE inscricoes
    SET
      status = $1,
      data_reprovacao = CASE WHEN $1 = 'negado' THEN NOW() ELSE data_reprovacao END
    WHERE id = $2
    `,
    [status, id]
  );

  await pool.query(
    `
    UPDATE candidato_acompanhamento
    SET
      status_atual = CASE
        WHEN $1 = 'aprovado' THEN 'aprovada'
        WHEN $1 = 'negado' THEN 'reprovada'
        ELSE 'em_analise'
      END,
      ultima_atualizacao = NOW()
    WHERE email = $2
    `,
    [status, inscricao.email]
  );

  await pool.query(
    `
    INSERT INTO inscricao_tentativas (inscricao_id, email, nome, status, observacao)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [inscricao.id, inscricao.email, inscricao.nome, status, `Decisao administrativa: ${status}`]
  );

  await logAudit(req, 'decidir_inscricao', 'inscricao', 'inscricoes', id, { status });
  res.json({ ok: true });
});

app.post('/admin/inscricoes/:id/aprovar', auth, requireAdmin, async (req, res) => {
  const inscricaoId = Number(req.params.id);
  const { rows: inscricaoRows } = await pool.query('SELECT id, email, nome, ra_codigo FROM inscricoes WHERE id = $1', [inscricaoId]);
  if (!inscricaoRows.length) {
    return res.status(404).json({ erro: 'Inscricao nao encontrada.' });
  }

  const inscricao = inscricaoRows[0];
  let raCodigo = inscricao.ra_codigo;
  if (!raCodigo) {
    const baseAno = new Date().getFullYear();
    const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    raCodigo = `RA-${baseAno}-${String(inscricaoId).padStart(5, '0')}-${randomPart}`;
  }

  await pool.query(
    `
    UPDATE inscricoes
    SET status = 'aprovado', ra_codigo = $1
    WHERE id = $2
    `,
    [raCodigo, inscricaoId]
  );

  await pool.query(
    `
    UPDATE candidato_acompanhamento
    SET status_atual = 'aprovada', ra_codigo = $1, ultima_atualizacao = NOW()
    WHERE email = $2
    `,
    [raCodigo, inscricao.email]
  );

  await pool.query(
    `
    INSERT INTO inscricao_tentativas (inscricao_id, email, nome, status, observacao)
    VALUES ($1, $2, $3, 'aprovado', 'Aprovacao via endpoint dedicado')
    `,
    [inscricaoId, inscricao.email, inscricao.nome]
  );

  await logAudit(req, 'aprovar_inscricao', 'inscricao', 'inscricoes', inscricaoId, { ra_codigo: raCodigo });
  res.json({ ok: true, ra_codigo: raCodigo, inscricao_id: inscricaoId });
});

app.post('/admin/inscricoes/:id/reprovar', auth, requireAdmin, async (req, res) => {
  const inscricaoId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || 'Reprovada pela administracao.';

  const { rows: inscricaoRows } = await pool.query('SELECT id, email, nome FROM inscricoes WHERE id = $1', [inscricaoId]);
  if (!inscricaoRows.length) {
    return res.status(404).json({ erro: 'Inscricao nao encontrada.' });
  }

  const inscricao = inscricaoRows[0];
  await pool.query(
    `
    UPDATE inscricoes
    SET status = 'negado', data_reprovacao = NOW()
    WHERE id = $1
    `,
    [inscricaoId]
  );

  await pool.query(
    `
    UPDATE candidato_acompanhamento
    SET status_atual = 'reprovada', ultima_atualizacao = NOW()
    WHERE email = $1
    `,
    [inscricao.email]
  );

  await pool.query(
    `
    INSERT INTO inscricao_tentativas (inscricao_id, email, nome, status, observacao)
    VALUES ($1, $2, $3, 'negado', $4)
    `,
    [inscricaoId, inscricao.email, inscricao.nome, motivo]
  );

  await logAudit(req, 'reprovar_inscricao', 'inscricao', 'inscricoes', inscricaoId, { motivo });
  res.json({ ok: true, inscricao_id: inscricaoId });
});

app.post('/admin/inscricoes/:id/gerar-ra', auth, requireAdmin, async (req, res) => {
  const inscricaoId = Number(req.params.id);
  if (!inscricaoId) {
    return res.status(400).json({ erro: 'ID da inscricao invalido.' });
  }

  const { rows } = await pool.query('SELECT id, email, ra_codigo FROM inscricoes WHERE id = $1', [inscricaoId]);
  if (!rows.length) {
    return res.status(404).json({ erro: 'Inscricao nao encontrada.' });
  }

  let raCodigo = rows[0].ra_codigo;
  if (!raCodigo) {
    const baseAno = new Date().getFullYear();
    const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    raCodigo = `RA-${baseAno}-${String(inscricaoId).padStart(5, '0')}-${randomPart}`;
    await pool.query('UPDATE inscricoes SET ra_codigo = $1 WHERE id = $2', [raCodigo, inscricaoId]);
    await pool.query('UPDATE candidato_acompanhamento SET ra_codigo = $1, ultima_atualizacao = NOW() WHERE email = $2', [raCodigo, rows[0].email]);
  }

  await logAudit(req, 'gerar_ra', 'inscricao', 'inscricoes', inscricaoId, { ra_codigo: raCodigo });
  res.json({ ok: true, inscricao_id: inscricaoId, ra_codigo: raCodigo });
});

app.get('/admin/inscricoes/historico-tentativas', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      it.id,
      it.inscricao_id,
      it.email,
      it.nome,
      it.status,
      it.observacao,
      it.data_tentativa
    FROM inscricao_tentativas it
    ORDER BY it.data_tentativa DESC
    LIMIT 500
    `
  );

  res.json(rows);
});

app.get('/admin/financeiro/usuarios', auth, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT
        u.id,
        u.nome,
        u.email,
        u.data_cadastro,
        u.ativo,
        (
          SELECT p.status
          FROM pedidos p
          WHERE p.usuario_id = u.id
          ORDER BY p.data_pedido DESC
          LIMIT 1
        ) AS ultimo_status_pagamento,
        (
          SELECT p.data_pedido
          FROM pedidos p
          WHERE p.usuario_id = u.id
          ORDER BY p.data_pedido DESC
          LIMIT 1
        ) AS data_ultimo_pagamento
      FROM usuarios u
      WHERE u.tipo_usuario = 'aluno'
      ORDER BY u.nome
    `;

    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar dados financeiros.' });
  }
});

app.post('/admin/financeiro/alternar-acesso', auth, requireAdmin, async (req, res) => {
  const { usuario_id, novo_status } = req.body;
  await pool.query('UPDATE usuarios SET ativo = $1 WHERE id = $2', [novo_status, usuario_id]);
  res.json({ ok: true });
});

app.get('/admin/financeiro/historico/:usuario_id', auth, requireAdmin, async (req, res) => {
  const { usuario_id } = req.params;
  const { rows } = await pool.query('SELECT * FROM pedidos WHERE usuario_id = $1 ORDER BY data_pedido DESC', [usuario_id]);
  res.json(rows);
});

app.post('/admin/financeiro/gerar-cupom', auth, requireAdmin, async (req, res) => {
  const { valor, descricao, usuario_id } = req.body;
  const codigo = `BOLSA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const { rows } = await pool.query(
    'INSERT INTO cupons (codigo, valor_desconto, descricao, usuario_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [codigo, valor, descricao, usuario_id || null]
  );

  res.status(201).json(rows[0]);
});

app.get('/admin/master/resumo', auth, requireAdmin, async (req, res) => {
  await markExpiredDisciplinaryActions();

  const [
    inscricoesPendentes,
    pagamentosPendentes,
    alunosAtivos,
    alunosBloqueados,
    punicoesAtivas,
    filaInscricoes,
    filaPagamentos
  ] = await Promise.all([
    pool.query("SELECT COUNT(*)::INT AS total FROM inscricoes WHERE status = 'pendente'"),
    pool.query("SELECT COUNT(*)::INT AS total FROM pedidos WHERE status = 'pendente'"),
    pool.query("SELECT COUNT(*)::INT AS total FROM usuarios WHERE tipo_usuario = 'aluno' AND ativo = true"),
    pool.query("SELECT COUNT(*)::INT AS total FROM usuarios WHERE tipo_usuario = 'aluno' AND ativo = false"),
    pool.query(`
      SELECT COUNT(*)::INT AS total
      FROM acoes_disciplinares
      WHERE status = 'ativa'
        AND revogado_em IS NULL
        AND (
          tipo = 'expulsao'
          OR (tipo = 'suspensao' AND data_fim IS NOT NULL AND data_fim > NOW())
        )
    `),
    pool.query(`
      SELECT id, nome, email, data_inscricao
      FROM inscricoes
      WHERE status = 'pendente'
      ORDER BY data_inscricao ASC
      LIMIT 5
    `),
    pool.query(`
      SELECT p.id, p.total, p.data_pedido, u.nome AS aluno_nome
      FROM pedidos p
      JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.status = 'pendente'
      ORDER BY p.data_pedido ASC
      LIMIT 5
    `)
  ]);

  res.json({
    kpis: {
      inscricoes_pendentes: inscricoesPendentes.rows[0].total,
      pagamentos_pendentes: pagamentosPendentes.rows[0].total,
      alunos_ativos: alunosAtivos.rows[0].total,
      alunos_bloqueados: alunosBloqueados.rows[0].total,
      punicoes_ativas: punicoesAtivas.rows[0].total
    },
    pendencias: {
      inscricoes: filaInscricoes.rows,
      pagamentos: filaPagamentos.rows
    }
  });
});

app.get('/admin/suprema/painel', auth, requireFounderSupremo, async (req, res) => {
  await markExpiredDisciplinaryActions();

  const [
    kpisBase,
    filaInscricoes,
    filaPagamentos,
    tesouraria,
    secretaria,
    administrativa,
    membros,
    loja,
    rastreioResumo24h,
    rastreioEventos,
    sessoesAtivas,
    monitoramentoMembros
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        (SELECT COUNT(*)::INT FROM inscricoes WHERE status = 'pendente') AS inscricoes_pendentes,
        (SELECT COUNT(*)::INT FROM pedidos WHERE status = 'pendente') AS pagamentos_pendentes,
        (SELECT COUNT(*)::INT FROM usuarios WHERE tipo_usuario = 'aluno' AND ativo = true) AS alunos_ativos,
        (SELECT COUNT(*)::INT FROM usuarios WHERE tipo_usuario = 'aluno' AND ativo = false) AS alunos_bloqueados,
        (
          SELECT COUNT(*)::INT
          FROM acoes_disciplinares
          WHERE status = 'ativa'
            AND revogado_em IS NULL
            AND (
              tipo = 'expulsao'
              OR (tipo = 'suspensao' AND data_fim IS NOT NULL AND data_fim > NOW())
            )
        ) AS punicoes_ativas
      `
    ),
    pool.query(
      `
      SELECT id, nome, email, data_inscricao
      FROM inscricoes
      WHERE status = 'pendente'
      ORDER BY data_inscricao ASC
      LIMIT 5
      `
    ),
    pool.query(
      `
      SELECT p.id, p.total, p.data_pedido, u.nome AS aluno_nome
      FROM pedidos p
      JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.status = 'pendente'
      ORDER BY p.data_pedido ASC
      LIMIT 5
      `
    ),
    pool.query(
      `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE status = 'pago'), 0)::NUMERIC(12,2) AS receita_confirmada,
        COALESCE(SUM(total) FILTER (WHERE status = 'pendente'), 0)::NUMERIC(12,2) AS receita_pendente,
        COUNT(*) FILTER (WHERE status = 'pendente')::INT AS cobrancas_abertas,
        COUNT(*) FILTER (WHERE data_pedido >= NOW() - INTERVAL '30 days')::INT AS movimentacoes_30d
      FROM pedidos
      `
    ),
    pool.query(
      `
      SELECT
        (SELECT COUNT(*)::INT FROM inscricoes WHERE status = 'pendente') AS inscricoes_em_analise,
        (SELECT COUNT(*)::INT FROM inscricoes WHERE status = 'aprovado') AS inscricoes_aprovadas,
        (SELECT COUNT(*)::INT FROM inscricao_tentativas WHERE data_tentativa >= NOW() - INTERVAL '30 days') AS tentativas_30d,
        (SELECT COUNT(*)::INT FROM usuarios WHERE tipo_usuario = 'aluno' AND data_cadastro >= NOW() - INTERVAL '30 days') AS novos_membros_30d
      `
    ),
    pool.query(
      `
      SELECT
        COUNT(*)::INT AS total_usuarios,
        COUNT(*) FILTER (WHERE ativo = true)::INT AS usuarios_ativos,
        COUNT(*) FILTER (WHERE ativo = false)::INT AS usuarios_inativos,
        COUNT(*) FILTER (WHERE tipo_usuario = 'admin')::INT AS admins,
        COUNT(*) FILTER (WHERE tipo_usuario = 'ti')::INT AS ti
      FROM usuarios
      `
    ),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE tipo_usuario = 'aluno')::INT AS membros_total,
        COUNT(*) FILTER (WHERE tipo_usuario = 'aluno' AND ativo = true)::INT AS membros_ativos,
        COUNT(*) FILTER (WHERE tipo_usuario = 'aluno' AND ativo = false)::INT AS membros_bloqueados,
        (
          SELECT COUNT(*)::INT
          FROM acoes_disciplinares
          WHERE status = 'ativa'
            AND revogado_em IS NULL
            AND (
              tipo = 'expulsao'
              OR (tipo = 'suspensao' AND data_fim IS NOT NULL AND data_fim > NOW())
            )
        ) AS casos_disciplinares_ativos
      FROM usuarios
      `
    ),
    pool.query(
      `
      SELECT
        (SELECT COUNT(*)::INT FROM produtos WHERE ativo = true AND deleted_at IS NULL) AS produtos_ativos,
        (SELECT COUNT(*)::INT FROM pedidos WHERE data_pedido >= NOW() - INTERVAL '30 days') AS pedidos_30d,
        (SELECT COUNT(*)::INT FROM pedidos WHERE status = 'pendente') AS pedidos_pendentes,
        (SELECT COUNT(*)::INT FROM usuarios WHERE tipo_usuario = 'lojista' AND ativo = true) AS lojistas_ativos
      `
    ),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE acao = 'login_sucesso')::INT AS login_sucesso,
        COUNT(*) FILTER (WHERE acao = 'logout')::INT AS logout,
        COUNT(DISTINCT usuario_id)::INT AS usuarios_unicos
      FROM audit_logs
      WHERE criado_em >= NOW() - INTERVAL '24 hours'
        AND acao IN ('login_sucesso', 'logout')
      `
    ),
    pool.query(
      `
      SELECT
        al.id,
        al.criado_em,
        al.acao,
        al.ip_origem,
        u.id AS usuario_id,
        u.nome AS usuario_nome,
        u.email AS usuario_email,
        u.tipo_usuario AS usuario_tipo,
        COALESCE(al.detalhes_json ->> 'session_type', '-') AS session_type,
        COALESCE(al.detalhes_json ->> 'perfil_login', '-') AS perfil_login
      FROM audit_logs al
      LEFT JOIN usuarios u ON u.id = al.usuario_id
      WHERE al.acao IN ('login_sucesso', 'logout')
      ORDER BY al.criado_em DESC
      LIMIT 120
      `
    ),
    pool.query(
      `
      SELECT
        s.usuario_id,
        u.nome,
        u.email,
        u.tipo_usuario,
        s.session_type,
        s.criado_em,
        s.expira_em,
        s.ip_origem
      FROM usuario_sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.revogado_em IS NULL
        AND s.expira_em > NOW()
      ORDER BY s.criado_em DESC
      LIMIT 100
      `
    ),
    pool.query(
      `
      SELECT
        id,
        nome,
        email,
        tipo_usuario,
        ativo,
        data_cadastro,
        ultimo_login_em,
        ultimo_login_ip
      FROM usuarios
      WHERE tipo_usuario IN ('aluno', 'cliente', 'lojista', 'professor')
      ORDER BY COALESCE(ultimo_login_em, data_cadastro) DESC
      LIMIT 120
      `
    )
  ]);

  const kpis = kpisBase.rows[0] || {
    inscricoes_pendentes: 0,
    pagamentos_pendentes: 0,
    alunos_ativos: 0,
    alunos_bloqueados: 0,
    punicoes_ativas: 0
  };

  res.json({
    acesso: {
      modo: 'suprema_fundadores',
      usuario_autenticado: {
        id: req.user?.id,
        nome: req.user?.nome,
        email: req.user?.email
      }
    },
    kpis,
    pendencias: {
      inscricoes: filaInscricoes.rows,
      pagamentos: filaPagamentos.rows
    },
    setores: {
      tesouraria: tesouraria.rows[0] || {},
      secretaria: secretaria.rows[0] || {},
      administrativa: administrativa.rows[0] || {},
      membros: membros.rows[0] || {},
      loja: loja.rows[0] || {}
    },
    rastreio: {
      resumo_24h: rastreioResumo24h.rows[0] || {},
      eventos_login_logout: rastreioEventos.rows,
      sessoes_ativas: sessoesAtivas.rows
    },
    membros_monitoramento: monitoramentoMembros.rows
  });
});

app.get('/admin/disciplinar/alunos', auth, requireAdmin, async (req, res) => {
  await markExpiredDisciplinaryActions();

  const { rows } = await pool.query(`
    SELECT
      u.id,
      u.nome,
      u.email,
      u.ativo,
      u.data_cadastro,
      COALESCE(a.tipo, 'regular') AS status_disciplinar,
      a.data_fim AS bloqueio_ate
    FROM usuarios u
    LEFT JOIN LATERAL (
      SELECT ad.tipo, ad.data_fim
      FROM acoes_disciplinares ad
      WHERE ad.aluno_id = u.id
        AND ad.status = 'ativa'
        AND ad.revogado_em IS NULL
        AND (
          ad.tipo = 'expulsao'
          OR (ad.tipo = 'suspensao' AND ad.data_fim IS NOT NULL AND ad.data_fim > NOW())
        )
      ORDER BY ad.criado_em DESC
      LIMIT 1
    ) a ON true
    WHERE u.tipo_usuario = 'aluno'
    ORDER BY u.nome
  `);

  res.json(rows);
});

app.get('/admin/disciplinar/casos', auth, requireAdmin, async (req, res) => {
  await markExpiredDisciplinaryActions();

  const { rows } = await pool.query(`
    SELECT
      ad.id,
      ad.tipo,
      ad.motivo,
      ad.status,
      ad.data_inicio,
      ad.data_fim,
      ad.criado_em,
      ad.revogado_em,
      ad.motivo_revogacao,
      ad.aluno_id,
      aluno.nome AS aluno_nome,
      aluno.email AS aluno_email,
      aplicador.nome AS aplicado_por_nome,
      revogador.nome AS revogado_por_nome
    FROM acoes_disciplinares ad
    JOIN usuarios aluno ON aluno.id = ad.aluno_id
    JOIN usuarios aplicador ON aplicador.id = ad.aplicado_por_id
    LEFT JOIN usuarios revogador ON revogador.id = ad.revogado_por_id
    ORDER BY ad.criado_em DESC
    LIMIT 200
  `);

  res.json(rows);
});

app.post('/admin/disciplinar/aplicar', auth, requireAdmin, async (req, res) => {
  const { aluno_id, tipo, motivo, duracao_dias, data_fim } = req.body;

  if (!aluno_id || !tipo || !motivo || !String(motivo).trim()) {
    return res.status(400).json({ erro: 'aluno_id, tipo e motivo sao obrigatorios.' });
  }

  if (!['advertencia', 'suspensao', 'expulsao'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo disciplinar invalido.' });
  }

  const { rows: alunoRows } = await pool.query(
    "SELECT id, nome, email, ativo FROM usuarios WHERE id = $1 AND tipo_usuario = 'aluno'",
    [aluno_id]
  );

  const aluno = alunoRows[0];

  if (!aluno) {
    return res.status(404).json({ erro: 'Aluno nao encontrado.' });
  }

  await markExpiredDisciplinaryActions(aluno_id);

  if (tipo === 'suspensao' || tipo === 'expulsao') {
    const activeBlock = await getActiveBlockingAction(aluno_id);
    if (activeBlock) {
      return res.status(409).json({ erro: 'Aluno ja possui bloqueio disciplinar ativo.' });
    }
  }

  let dataFim = null;

  if (tipo === 'suspensao') {
    if (data_fim) {
      dataFim = new Date(data_fim);
      if (Number.isNaN(dataFim.getTime())) {
        return res.status(400).json({ erro: 'data_fim invalida.' });
      }
    } else {
      const dias = Number(duracao_dias);
      if (![3, 7, 30].includes(dias)) {
        return res.status(400).json({ erro: 'duracao_dias deve ser 3, 7 ou 30.' });
      }

      dataFim = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    }

    if (dataFim <= new Date()) {
      return res.status(400).json({ erro: 'A data final da suspensao deve estar no futuro.' });
    }
  }

  const status = tipo === 'advertencia' ? 'aplicada' : 'ativa';
  const ativoAnterior = tipo === 'expulsao' ? aluno.ativo : null;

  const { rows: insertedRows } = await pool.query(
    `
    INSERT INTO acoes_disciplinares
      (aluno_id, aplicado_por_id, tipo, motivo, data_inicio, data_fim, status, ativo_anterior)
    VALUES
      ($1, $2, $3, $4, NOW(), $5, $6, $7)
    RETURNING *
    `,
    [aluno_id, req.userId, tipo, String(motivo).trim(), dataFim, status, ativoAnterior]
  );

  if (tipo === 'expulsao') {
    await pool.query('UPDATE usuarios SET ativo = false WHERE id = $1', [aluno_id]);
    await pool.query("UPDATE alunos_turmas SET status = 'expulso' WHERE aluno_id = $1 AND status <> 'expulso'", [aluno_id]);
  }

  res.status(201).json({
    ok: true,
    acao: insertedRows[0],
    aluno: {
      id: aluno.id,
      nome: aluno.nome,
      email: aluno.email
    }
  });
});

app.post('/admin/disciplinar/revogar/:id', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const motivoRevogacao = String(req.body?.motivo_revogacao || '').trim();

  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ erro: 'ID invalido.' });
  }

  if (!motivoRevogacao) {
    return res.status(400).json({ erro: 'motivo_revogacao e obrigatorio.' });
  }

  const { rows } = await pool.query('SELECT * FROM acoes_disciplinares WHERE id = $1', [id]);
  const acao = rows[0];

  if (!acao) {
    return res.status(404).json({ erro: 'Acao disciplinar nao encontrada.' });
  }

  if (acao.status !== 'ativa') {
    return res.status(400).json({ erro: 'Somente acoes ativas podem ser revogadas.' });
  }

  await pool.query(
    `
    UPDATE acoes_disciplinares
    SET
      status = 'revogada',
      revogado_por_id = $1,
      revogado_em = NOW(),
      motivo_revogacao = $2,
      atualizado_em = NOW()
    WHERE id = $3
    `,
    [req.userId, motivoRevogacao, id]
  );

  if (acao.tipo === 'expulsao') {
    await pool.query('UPDATE usuarios SET ativo = $1 WHERE id = $2', [acao.ativo_anterior ?? true, acao.aluno_id]);
  }

  res.json({ ok: true });
});

app.get('/admin/professores', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT id, nome, email, ativo
    FROM usuarios
    WHERE tipo_usuario = 'professor'
    ORDER BY nome
    `
  );

  res.json(rows);
});

app.post('/admin/turmas', auth, requireAdmin, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const professorId = req.body?.professor_id ? Number(req.body.professor_id) : null;

  if (!nome) {
    return res.status(400).json({ erro: 'Nome da turma obrigatorio.' });
  }

  if (professorId) {
    const { rows: professorRows } = await pool.query(
      "SELECT id FROM usuarios WHERE id = $1 AND tipo_usuario = 'professor'",
      [professorId]
    );
    if (!professorRows.length) {
      return res.status(400).json({ erro: 'Professor informado nao existe.' });
    }
  }

  const { rows } = await pool.query(
    'INSERT INTO turmas (nome, professor_id, conteudo_aprovado) VALUES ($1, $2, $3) RETURNING *',
    [nome, professorId, null]
  );

  res.status(201).json(rows[0]);
});

app.get('/admin/turmas', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT t.id, t.nome, t.professor_id, u.nome AS professor_nome
    FROM turmas t
    LEFT JOIN usuarios u ON u.id = t.professor_id
    ORDER BY t.nome
    `
  );

  res.json(rows);
});

app.post('/admin/materias', auth, requireAdmin, async (req, res) => {
  const turmaId = Number(req.body?.turma_id);
  const professorId = Number(req.body?.professor_id);
  const nome = String(req.body?.nome || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const tipoMateria = String(req.body?.tipo_materia || '').trim().toLowerCase();

  if (!turmaId || !professorId || !nome || !['obrigatoria', 'isolada'].includes(tipoMateria)) {
    return res.status(400).json({ erro: 'turma_id, professor_id, nome e tipo_materia valido sao obrigatorios.' });
  }

  const turmaResult = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turmaResult.rows.length) {
    return res.status(404).json({ erro: 'Turma nao encontrada.' });
  }

  const professorResult = await pool.query(
    "SELECT id FROM usuarios WHERE id = $1 AND tipo_usuario = 'professor'",
    [professorId]
  );
  if (!professorResult.rows.length) {
    return res.status(404).json({ erro: 'Professor nao encontrado.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO materias (turma_id, professor_id, nome, descricao, tipo_materia, ativa)
    VALUES ($1, $2, $3, $4, $5, true)
    RETURNING *
    `,
    [turmaId, professorId, nome, descricao, tipoMateria]
  );

  res.status(201).json(rows[0]);
});

app.patch('/admin/materias/:id/professor', auth, requireAdmin, async (req, res) => {
  const materiaId = Number(req.params.id);
  const professorId = Number(req.body?.professor_id);

  if (!materiaId || !professorId) {
    return res.status(400).json({ erro: 'ID da materia e professor_id sao obrigatorios.' });
  }

  const professorResult = await pool.query(
    "SELECT id FROM usuarios WHERE id = $1 AND tipo_usuario = 'professor'",
    [professorId]
  );
  if (!professorResult.rows.length) {
    return res.status(404).json({ erro: 'Professor nao encontrado.' });
  }

  const { rows } = await pool.query(
    'UPDATE materias SET professor_id = $1 WHERE id = $2 RETURNING *',
    [professorId, materiaId]
  );
  if (!rows.length) {
    return res.status(404).json({ erro: 'Materia nao encontrada.' });
  }

  res.json(rows[0]);
});

app.get('/admin/materias', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.nome,
      m.descricao,
      m.tipo_materia,
      m.ativa,
      m.data_criacao,
      t.id AS turma_id,
      t.nome AS turma_nome,
      p.id AS professor_id,
      p.nome AS professor_nome,
      p.email AS professor_email
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    JOIN usuarios p ON p.id = m.professor_id
    ORDER BY t.nome, m.nome
    `
  );

  res.json(rows);
});

app.get('/admin/anexos/pendentes', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      mm.id,
      mm.titulo,
      mm.descricao,
      mm.tipo_material,
      mm.conteudo_texto,
      mm.arquivo_url,
      mm.arquivo_nome,
      mm.mime_type,
      mm.extensao,
      mm.status_moderacao,
      mm.data_criacao,
      mm.autor_id,
      autor.nome AS autor_nome,
      autor.email AS autor_email,
      m.id AS materia_id,
      m.nome AS materia_nome,
      m.tipo_materia,
      t.id AS turma_id,
      t.nome AS turma_nome
    FROM materiais_materia mm
    JOIN materias m ON m.id = mm.materia_id
    JOIN turmas t ON t.id = m.turma_id
    JOIN usuarios autor ON autor.id = mm.autor_id
    WHERE mm.status_moderacao = 'pendente'
    ORDER BY mm.data_criacao ASC
    `
  );

  res.json(rows);
});

app.post('/admin/anexos/:id/aprovar', auth, requireAdmin, async (req, res) => {
  const materialId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!materialId) {
    return res.status(400).json({ erro: 'ID do material invalido.' });
  }

  const materialResult = await pool.query('SELECT id, status_moderacao FROM materiais_materia WHERE id = $1', [materialId]);
  const material = materialResult.rows[0];

  if (!material) {
    return res.status(404).json({ erro: 'Material nao encontrado.' });
  }

  if (material.status_moderacao !== 'pendente') {
    return res.status(400).json({ erro: 'Somente materiais pendentes podem ser aprovados.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE materiais_materia
    SET
      status_moderacao = 'aprovado',
      aprovado_por_id = $1,
      data_aprovacao = NOW(),
      comentario_moderacao = $2,
      data_atualizacao = NOW()
    WHERE id = $3
    RETURNING *
    `,
    [req.userId, comentario, materialId]
  );

  res.json(rows[0]);
});

app.post('/admin/anexos/:id/reprovar', auth, requireAdmin, async (req, res) => {
  const materialId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!materialId) {
    return res.status(400).json({ erro: 'ID do material invalido.' });
  }

  const materialResult = await pool.query('SELECT id, status_moderacao FROM materiais_materia WHERE id = $1', [materialId]);
  const material = materialResult.rows[0];

  if (!material) {
    return res.status(404).json({ erro: 'Material nao encontrado.' });
  }

  if (material.status_moderacao !== 'pendente') {
    return res.status(400).json({ erro: 'Somente materiais pendentes podem ser reprovados.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE materiais_materia
    SET
      status_moderacao = 'reprovado',
      aprovado_por_id = $1,
      data_aprovacao = NOW(),
      comentario_moderacao = $2,
      data_atualizacao = NOW()
    WHERE id = $3
    RETURNING *
    `,
    [req.userId, comentario, materialId]
  );

  res.json(rows[0]);
});

app.get('/professor/materias', auth, requireProfessor, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.nome,
      m.descricao,
      m.tipo_materia,
      m.ativa,
      t.id AS turma_id,
      t.nome AS turma_nome
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    WHERE m.professor_id = $1
      AND m.ativa = true
    ORDER BY t.nome, m.nome
    `,
    [req.userId]
  );

  res.json(rows);
});

app.post('/professor/anexos', auth, requireProfessor, upload.single('arquivo'), async (req, res) => {
  const materiaId = Number(req.body?.materia_id);
  const titulo = String(req.body?.titulo || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const tipoMaterial = String(req.body?.tipo_material || '').trim().toLowerCase();
  const conteudoTexto = String(req.body?.conteudo_texto || '').trim() || null;

  if (!materiaId || !titulo || !tipoMaterial) {
    return res.status(400).json({ erro: 'materia_id, titulo e tipo_material sao obrigatorios.' });
  }

  const materia = await materiaDoProfessor(materiaId, req.userId);
  if (!materia) {
    return res.status(403).json({ erro: 'Voce nao possui permissao nesta materia.' });
  }

  const validation = validateMaterialPayload(tipoMaterial, req.file, conteudoTexto);
  if (!validation.ok) {
    return res.status(400).json({ erro: validation.erro });
  }

  const arquivoUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const arquivoNome = req.file ? req.file.originalname : null;
  const mimeType = req.file ? req.file.mimetype : null;
  const extensao = req.file ? path.extname(req.file.originalname || '').toLowerCase() : null;

  const { rows } = await pool.query(
    `
    INSERT INTO materiais_materia
      (
        materia_id,
        titulo,
        descricao,
        tipo_material,
        conteudo_texto,
        arquivo_url,
        arquivo_nome,
        mime_type,
        extensao,
        status_moderacao,
        autor_id,
        data_criacao,
        data_atualizacao
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', $10, NOW(), NOW())
    RETURNING *
    `,
    [
      materiaId,
      titulo,
      descricao,
      tipoMaterial,
      conteudoTexto,
      arquivoUrl,
      arquivoNome,
      mimeType,
      extensao,
      req.userId
    ]
  );

  res.status(201).json(rows[0]);
});

app.get('/professor/anexos', auth, requireProfessor, async (req, res) => {
  const materiaId = req.query?.materia_id ? Number(req.query.materia_id) : null;

  if (req.query?.materia_id && !materiaId) {
    return res.status(400).json({ erro: 'materia_id invalido.' });
  }

  const params = [req.userId];
  let filter = '';

  if (materiaId) {
    filter = 'AND mm.materia_id = $2';
    params.push(materiaId);
  }

  const { rows } = await pool.query(
    `
    SELECT
      mm.id,
      mm.materia_id,
      mm.titulo,
      mm.descricao,
      mm.tipo_material,
      mm.status_moderacao,
      mm.comentario_moderacao,
      mm.arquivo_url,
      mm.arquivo_nome,
      mm.data_criacao,
      m.nome AS materia_nome,
      t.nome AS turma_nome
    FROM materiais_materia mm
    JOIN materias m ON m.id = mm.materia_id
    JOIN turmas t ON t.id = m.turma_id
    WHERE m.professor_id = $1
      ${filter}
    ORDER BY mm.data_criacao DESC
    `,
    params
  );

  res.json(rows);
});

app.post('/professor/avaliacoes-v2', auth, requireProfessor, async (req, res) => {
  const materiaId = Number(req.body?.materia_id);
  const tipoAvaliacao = String(req.body?.tipo_avaliacao || '').trim().toLowerCase();
  const titulo = String(req.body?.titulo || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const dataLimite = req.body?.data_limite ? new Date(req.body.data_limite) : null;
  const questoes = Array.isArray(req.body?.questoes) ? req.body.questoes : [];

  if (!materiaId || !['teste', 'exercicio', 'avaliacao'].includes(tipoAvaliacao) || !titulo || !questoes.length) {
    return res.status(400).json({ erro: 'materia_id, tipo_avaliacao, titulo e questoes sao obrigatorios.' });
  }

  if (dataLimite && Number.isNaN(dataLimite.getTime())) {
    return res.status(400).json({ erro: 'data_limite invalida.' });
  }

  const materia = await materiaDoProfessor(materiaId, req.userId);
  if (!materia) {
    return res.status(403).json({ erro: 'Voce nao possui permissao nesta materia.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const avaliacaoResult = await client.query(
      `
      INSERT INTO avaliacoes_v2
        (materia_id, professor_id, tipo_avaliacao, titulo, descricao, data_limite, status, data_criacao)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'publicada', NOW())
      RETURNING *
      `,
      [materiaId, req.userId, tipoAvaliacao, titulo, descricao, dataLimite]
    );

    const avaliacao = avaliacaoResult.rows[0];

    for (let i = 0; i < questoes.length; i += 1) {
      const q = questoes[i] || {};
      const enunciado = String(q.enunciado || '').trim();
      const tipoQuestao = String(q.tipo_questao || '').trim().toLowerCase();
      const peso = Number(q.peso) > 0 ? Number(q.peso) : 1;
      const ordem = Number.isInteger(q.ordem) ? q.ordem : i + 1;

      if (!enunciado || !['objetiva', 'discursiva'].includes(tipoQuestao)) {
        throw new Error(`Questao ${i + 1} invalida.`);
      }

      let opcoesJson = null;
      let respostaCorreta = null;

      if (tipoQuestao === 'objetiva') {
        const opcoes = Array.isArray(q.opcoes) ? q.opcoes.map((item) => String(item).trim()).filter(Boolean) : [];
        const resposta = String(q.resposta_correta || '').trim();

        if (opcoes.length < 2 || !resposta) {
          throw new Error(`Questao objetiva ${i + 1} sem opcoes/resposta.`);
        }

        opcoesJson = JSON.stringify(opcoes);
        respostaCorreta = resposta;
      }

      await client.query(
        `
        INSERT INTO avaliacoes_v2_questoes
          (avaliacao_id, enunciado, tipo_questao, opcoes_json, resposta_correta, peso, ordem, data_criacao)
        VALUES
          ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
        `,
        [avaliacao.id, enunciado, tipoQuestao, opcoesJson, respostaCorreta, peso, ordem]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ ok: true, avaliacao_id: avaliacao.id, questoes: questoes.length });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: error.message || 'Falha ao criar avaliacao.' });
  } finally {
    client.release();
  }
});

app.post('/professor/avaliacoes-v2/submissoes/:id/corrigir', auth, requireProfessor, async (req, res) => {
  const submissaoId = Number(req.params.id);
  const respostasDiscursivas = Array.isArray(req.body?.respostas_discursivas) ? req.body.respostas_discursivas : [];
  const feedbackGeral = String(req.body?.feedback_geral || '').trim() || null;

  if (!submissaoId) {
    return res.status(400).json({ erro: 'ID da submissao invalido.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const submissaoResult = await client.query(
      `
      SELECT
        s.id,
        s.avaliacao_id,
        s.nota_objetiva,
        a.professor_id
      FROM avaliacoes_v2_submissoes s
      JOIN avaliacoes_v2 a ON a.id = s.avaliacao_id
      WHERE s.id = $1
      FOR UPDATE
      `,
      [submissaoId]
    );

    const submissao = submissaoResult.rows[0];

    if (!submissao) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Submissao nao encontrada.' });
    }

    if (Number(submissao.professor_id) !== req.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Sem permissao para corrigir esta submissao.' });
    }

    for (const item of respostasDiscursivas) {
      const questaoId = Number(item.questao_id);
      const nota = Number(item.nota_discursiva);
      const comentario = String(item.comentario_professor || '').trim() || null;

      if (!questaoId || Number.isNaN(nota) || nota < 0 || nota > 100) {
        throw new Error('Notas discursivas devem estar entre 0 e 100.');
      }

      await client.query(
        `
        UPDATE avaliacoes_v2_respostas
        SET nota_discursiva = $1,
            comentario_professor = $2
        WHERE submissao_id = $3
          AND questao_id = $4
        `,
        [nota, comentario, submissaoId, questaoId]
      );
    }

    const respostaDiscResult = await client.query(
      `
      SELECT r.nota_discursiva, q.peso
      FROM avaliacoes_v2_respostas r
      JOIN avaliacoes_v2_questoes q ON q.id = r.questao_id
      WHERE r.submissao_id = $1
        AND q.tipo_questao = 'discursiva'
      `,
      [submissaoId]
    );

    const notasDiscursivas = respostaDiscResult.rows.filter((row) => row.nota_discursiva !== null);
    let notaDiscursiva = null;

    if (notasDiscursivas.length) {
      let pesoTotal = 0;
      let somaPonderada = 0;

      notasDiscursivas.forEach((row) => {
        const peso = Number(row.peso) || 1;
        const nota = Number(row.nota_discursiva) || 0;
        pesoTotal += peso;
        somaPonderada += nota * peso;
      });

      notaDiscursiva = pesoTotal > 0 ? Number((somaPonderada / pesoTotal).toFixed(2)) : null;
    }

    const componentes = [];
    if (submissao.nota_objetiva !== null) componentes.push(Number(submissao.nota_objetiva));
    if (notaDiscursiva !== null) componentes.push(notaDiscursiva);

    const notaFinal = componentes.length
      ? Number((componentes.reduce((acc, value) => acc + value, 0) / componentes.length).toFixed(2))
      : null;

    await client.query(
      `
      UPDATE avaliacoes_v2_submissoes
      SET
        status = 'corrigida',
        nota_discursiva = $1,
        nota_final = $2,
        feedback_geral = $3,
        corrigido_por_id = $4,
        data_correcao = NOW()
      WHERE id = $5
      `,
      [notaDiscursiva, notaFinal, feedbackGeral, req.userId, submissaoId]
    );

    await client.query('COMMIT');

    res.json({ ok: true, nota_discursiva: notaDiscursiva, nota_final: notaFinal });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: error.message || 'Falha ao corrigir submissao.' });
  } finally {
    client.release();
  }
});

app.get('/aluno/materias', auth, requireAluno, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.nome,
      m.descricao,
      m.tipo_materia,
      m.data_criacao,
      t.id AS turma_id,
      t.nome AS turma_nome,
      p.nome AS professor_nome
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    JOIN alunos_turmas at ON at.turma_id = m.turma_id
    LEFT JOIN usuarios p ON p.id = m.professor_id
    WHERE at.aluno_id = $1
      AND at.status = 'ativo'
      AND m.ativa = true
    ORDER BY t.nome, m.nome
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/aluno/materias/:id/materiais', auth, requireAluno, async (req, res) => {
  const materiaId = Number(req.params.id);

  if (!materiaId) {
    return res.status(400).json({ erro: 'ID da materia invalido.' });
  }

  const materia = await materiaAcessivelAluno(materiaId, req.userId);
  if (!materia) {
    return res.status(403).json({ erro: 'Sem acesso a esta materia.' });
  }

  const { rows } = await pool.query(
    `
    SELECT
      id,
      titulo,
      descricao,
      tipo_material,
      conteudo_texto,
      arquivo_url,
      arquivo_nome,
      mime_type,
      data_criacao
    FROM materiais_materia
    WHERE materia_id = $1
      AND status_moderacao = 'aprovado'
    ORDER BY data_criacao DESC
    `,
    [materiaId]
  );

  res.json({ materia, materiais: rows });
});

app.get('/aluno/avaliacoes-v2', auth, requireAluno, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      a.id,
      a.titulo,
      a.descricao,
      a.tipo_avaliacao,
      a.data_limite,
      a.data_criacao,
      m.id AS materia_id,
      m.nome AS materia_nome,
      m.tipo_materia,
      t.nome AS turma_nome,
      s.status AS minha_submissao_status,
      s.nota_final AS minha_nota_final,
      s.data_envio AS minha_data_envio
    FROM avaliacoes_v2 a
    JOIN materias m ON m.id = a.materia_id
    JOIN turmas t ON t.id = m.turma_id
    JOIN alunos_turmas at ON at.turma_id = m.turma_id
    LEFT JOIN avaliacoes_v2_submissoes s
      ON s.avaliacao_id = a.id
      AND s.aluno_id = $1
    WHERE at.aluno_id = $1
      AND at.status = 'ativo'
      AND m.ativa = true
      AND a.status = 'publicada'
    ORDER BY a.data_criacao DESC
    `,
    [req.userId]
  );

  res.json(rows);
});

app.post('/aluno/avaliacoes-v2/:id/submissoes', auth, requireAluno, async (req, res) => {
  const avaliacaoId = Number(req.params.id);
  const respostas = Array.isArray(req.body?.respostas) ? req.body.respostas : [];

  if (!avaliacaoId || !respostas.length) {
    return res.status(400).json({ erro: 'Avaliacao e respostas sao obrigatorias.' });
  }

  const avaliacao = await avaliacaoAcessivelAluno(avaliacaoId, req.userId);
  if (!avaliacao) {
    return res.status(403).json({ erro: 'Sem acesso a esta avaliacao.' });
  }

  const existing = await pool.query(
    'SELECT id FROM avaliacoes_v2_submissoes WHERE avaliacao_id = $1 AND aluno_id = $2',
    [avaliacaoId, req.userId]
  );
  if (existing.rows.length) {
    return res.status(409).json({ erro: 'Avaliacao ja enviada por este aluno.' });
  }

  const questoesResult = await pool.query(
    `
    SELECT id, tipo_questao, resposta_correta, peso
    FROM avaliacoes_v2_questoes
    WHERE avaliacao_id = $1
    ORDER BY ordem, id
    `,
    [avaliacaoId]
  );
  const questoes = questoesResult.rows;

  if (!questoes.length) {
    return res.status(400).json({ erro: 'Avaliacao sem questoes cadastradas.' });
  }

  const respostaMap = new Map();
  respostas.forEach((item) => {
    const questaoId = Number(item.questao_id);
    if (questaoId) {
      respostaMap.set(questaoId, String(item.resposta || '').trim());
    }
  });

  let totalObjetivaPeso = 0;
  let acertosObjetivaPeso = 0;
  let possuiDiscursiva = false;
  const respostasPreparadas = [];

  questoes.forEach((questao) => {
    const questaoId = Number(questao.id);
    const respostaTexto = respostaMap.get(questaoId) || '';
    const peso = Number(questao.peso) || 1;

    if (questao.tipo_questao === 'objetiva') {
      totalObjetivaPeso += peso;
      const correta = normalizeAnswer(respostaTexto) === normalizeAnswer(questao.resposta_correta);
      if (correta) acertosObjetivaPeso += peso;
      respostasPreparadas.push({ questao_id: questaoId, resposta_texto: respostaTexto, correta });
    } else {
      possuiDiscursiva = true;
      respostasPreparadas.push({ questao_id: questaoId, resposta_texto: respostaTexto, correta: null });
    }
  });

  const notaObjetiva = totalObjetivaPeso > 0
    ? Number(((acertosObjetivaPeso / totalObjetivaPeso) * 100).toFixed(2))
    : null;
  const statusSubmissao = possuiDiscursiva ? 'enviada' : 'corrigida';
  const notaFinal = notaObjetiva;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const submissaoResult = await client.query(
      `
      INSERT INTO avaliacoes_v2_submissoes
        (avaliacao_id, aluno_id, status, nota_objetiva, nota_final, data_envio)
      VALUES
        ($1, $2, $3, $4, $5, NOW())
      RETURNING *
      `,
      [avaliacaoId, req.userId, statusSubmissao, notaObjetiva, notaFinal]
    );
    const submissao = submissaoResult.rows[0];

    for (const resposta of respostasPreparadas) {
      await client.query(
        `
        INSERT INTO avaliacoes_v2_respostas
          (submissao_id, questao_id, resposta_texto, correta)
        VALUES
          ($1, $2, $3, $4)
        `,
        [submissao.id, resposta.questao_id, resposta.resposta_texto, resposta.correta]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      submissao_id: submissao.id,
      status: submissao.status,
      nota_objetiva: notaObjetiva,
      nota_final: notaFinal,
      pendente_correcao_discursiva: possuiDiscursiva
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ erro: 'Falha ao registrar submissao.' });
  } finally {
    client.release();
  }
});

app.get('/aluno/turmas', auth, requireAluno, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      at.id,
      at.turma_id,
      at.status,
      at.data_matricula,
      t.nome AS turma_nome,
      t.conteudo_aprovado,
      t.professor_id,
      u.nome AS professor_nome
    FROM alunos_turmas at
    JOIN turmas t ON t.id = at.turma_id
    LEFT JOIN usuarios u ON u.id = t.professor_id
    WHERE at.aluno_id = $1
    ORDER BY at.data_matricula DESC
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/aluno/materias/:id/feed', auth, requireAluno, async (req, res) => {
  const materiaId = Number(req.params.id);

  if (!materiaId) {
    return res.status(400).json({ erro: 'ID da materia invalido.' });
  }

  const materia = await materiaAcessivelAluno(materiaId, req.userId);
  if (!materia) {
    return res.status(403).json({ erro: 'Sem acesso a esta materia.' });
  }

  const [materiaisResult, avaliacoesResult, aulasResult] = await Promise.all([
    pool.query(
      `
      SELECT
        id,
        titulo,
        descricao,
        tipo_material,
        conteudo_texto,
        arquivo_url,
        arquivo_nome,
        mime_type,
        data_criacao
      FROM materiais_materia
      WHERE materia_id = $1
        AND status_moderacao = 'aprovado'
      ORDER BY data_criacao DESC
      `,
      [materiaId]
    ),
    pool.query(
      `
      SELECT
        a.id,
        a.titulo,
        a.descricao,
        a.tipo_avaliacao,
        a.data_limite,
        a.status,
        a.data_criacao,
        s.id AS minha_submissao_id,
        s.status AS minha_submissao_status,
        s.nota_final AS minha_nota_final
      FROM avaliacoes_v2 a
      LEFT JOIN avaliacoes_v2_submissoes s
        ON s.avaliacao_id = a.id
        AND s.aluno_id = $2
      WHERE a.materia_id = $1
        AND a.status = 'publicada'
      ORDER BY a.data_criacao DESC
      `,
      [materiaId, req.userId]
    ),
    pool.query(
      `
      SELECT
        a.id,
        a.titulo,
        a.descricao,
        a.status,
        a.inicio_previsto,
        a.fim_previsto,
        a.inicio_real,
        a.fim_real,
        a.conteudo_aprovado,
        a.link_sala,
        ap.id AS presenca_id,
        ap.presenca_status,
        fj.status AS justificativa_status,
        fj.id AS justificativa_id,
        g.id AS gravacao_id,
        g.arquivo_url AS gravacao_url,
        g.duracao_segundos
      FROM aulas_ao_vivo a
      LEFT JOIN aula_presencas ap
        ON ap.aula_id = a.id
        AND ap.aluno_id = $2
      LEFT JOIN LATERAL (
        SELECT j.id, j.status
        FROM faltas_justificativas j
        WHERE j.presenca_id = ap.id
        ORDER BY j.criado_em DESC
        LIMIT 1
      ) fj ON true
      LEFT JOIN aula_gravacoes g ON g.aula_id = a.id
      WHERE a.materia_id = $1
      ORDER BY COALESCE(a.inicio_previsto, a.criado_em) DESC
      `,
      [materiaId, req.userId]
    )
  ]);

  const aulas = aulasResult.rows.map((aula) => {
    const faltosoSemDuplaAprovacao =
      aula.presenca_status === 'falta' && aula.justificativa_status !== 'aprovado_duplo';
    const replayDisponivel =
      ['encerrada', 'realizada'].includes(aula.status) &&
      Boolean(aula.gravacao_id) &&
      Boolean(aula.conteudo_aprovado) &&
      !faltosoSemDuplaAprovacao;

    return {
      ...aula,
      replay_disponivel: replayDisponivel,
      bloqueio_motivo: faltosoSemDuplaAprovacao
        ? 'Falta registrada. Envie justificativa para liberar o replay.'
        : null
    };
  });

  res.json({
    materia,
    materiais: materiaisResult.rows,
    avaliacoes: avaliacoesResult.rows,
    aulas
  });
});

app.get('/professor/turmas', auth, requireProfessor, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT
      t.id,
      t.nome,
      t.conteudo_aprovado,
      m.id AS materia_id,
      m.nome AS materia_nome,
      m.tipo_materia
    FROM materias m
    JOIN turmas t ON t.id = m.turma_id
    WHERE m.professor_id = $1
      AND m.ativa = true
    ORDER BY t.nome, m.nome
    `,
    [req.userId]
  );

  res.json(rows);
});

app.post('/professor/materias/:id/materiais', auth, requireProfessor, upload.single('arquivo'), async (req, res) => {
  const materiaId = Number(req.params.id);
  const titulo = String(req.body?.titulo || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const tipoMaterial = String(req.body?.tipo_material || '').trim().toLowerCase();
  const conteudoTexto = String(req.body?.conteudo_texto || '').trim() || null;

  if (!materiaId || !titulo || !tipoMaterial) {
    return res.status(400).json({ erro: 'materia_id, titulo e tipo_material sao obrigatorios.' });
  }

  const materia = await materiaDoProfessor(materiaId, req.userId);
  if (!materia) {
    return res.status(403).json({ erro: 'Voce nao possui permissao nesta materia.' });
  }

  const validation = validateMaterialPayload(tipoMaterial, req.file, conteudoTexto);
  if (!validation.ok) {
    return res.status(400).json({ erro: validation.erro });
  }

  const arquivoUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const arquivoNome = req.file ? req.file.originalname : null;
  const mimeType = req.file ? req.file.mimetype : null;
  const extensao = req.file ? path.extname(req.file.originalname || '').toLowerCase() : null;

  const { rows } = await pool.query(
    `
    INSERT INTO materiais_materia
      (
        materia_id,
        titulo,
        descricao,
        tipo_material,
        conteudo_texto,
        arquivo_url,
        arquivo_nome,
        mime_type,
        extensao,
        status_moderacao,
        autor_id,
        data_criacao,
        data_atualizacao
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', $10, NOW(), NOW())
    RETURNING *
    `,
    [
      materiaId,
      titulo,
      descricao,
      tipoMaterial,
      conteudoTexto,
      arquivoUrl,
      arquivoNome,
      mimeType,
      extensao,
      req.userId
    ]
  );

  await trySaveUniversalArchive({
    chave: `material:${rows[0].id}:${Date.now()}`,
    tipoRecurso: 'academico',
    subtipo: 'material_pendente',
    payload: rows[0],
    metadata: {
      origem: 'route:/professor/materias/:id/materiais',
      materia_id: materiaId,
      tipo_material: tipoMaterial
    },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: arquivoUrl
  });

  await logAudit(req, 'publicar_material_pendente', 'academico', 'materiais_materia', rows[0].id, {
    materia_id: materiaId,
    tipo_material: tipoMaterial
  });

  res.status(201).json(rows[0]);
});

// Rota para cadastro de membros existentes
app.post('/api/inscricao-membro', async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const nivel_codigo = String(req.body?.nivel_codigo || '').trim().toLowerCase();

  if (!nome || !email || !senha || !nivel_codigo) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
  }

  const validLevels = ['neofito', 'mago_n1', 'mago_n2', 'mago_n3', 'mentor', 'sabio', 'mestre', 'ti'];
  if (!validLevels.includes(nivel_codigo)) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }

  const passwordCheck = validatePasswordStrength(senha);
  if (!passwordCheck.ok) {
    return res.status(400).json({ erro: passwordCheck.erro });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cadastro web permite criar acesso direto; conta TI continua exigindo inscricao aprovada.
    const approvedEnrollment = await client.query(
      "SELECT id FROM inscricoes WHERE lower(email) = lower($1) AND status = 'aprovado' LIMIT 1",
      [email]
    );
    const hasApprovedEnrollment = approvedEnrollment.rows.length > 0;
    if (nivel_codigo === 'ti' && !hasApprovedEnrollment) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        erro: 'Cadastro de TI exige inscricao aprovada previamente.'
      });
    }

    // Verifica se email já existe
    const checkUser = await client.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [email]);
    if (checkUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Este e-mail já possui cadastro.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const tipoUsuarioDestino = hasApprovedEnrollment && nivel_codigo === 'ti' ? 'ti' : 'aluno';
    const userRes = await client.query(
      'INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo) VALUES ($1, $2, $3, $4, true) RETURNING id',
      [nome, email, senhaHash, tipoUsuarioDestino]
    );
    const userId = userRes.rows[0].id;

    // Define o nível/categoria
    await client.query(
      "INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em) VALUES ($1, $2, NOW())",
      [userId, nivel_codigo]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, message: 'Cadastro realizado com sucesso. Acesso liberado.' });
  } catch (error) {
    await client.query('ROLLBACK');
    return sendApiInternalError(req, res, error, 'Erro interno ao processar cadastro.');
  } finally {
    client.release();
  }
});

app.post('/api/loja/clientes/cadastro-rapido', async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.password || req.body?.senha || '');
  const cpf = String(req.body?.cpf || '').trim();
  const nascimento = String(req.body?.nascimento || '').trim() || null;
  const telefone = String(req.body?.telefone || '').trim();
  const endereco = {
    cep: String(req.body?.cep || '').trim(),
    logradouro: String(req.body?.logradouro || '').trim(),
    numero: String(req.body?.numero || '').trim(),
    complemento: String(req.body?.complemento || '').trim(),
    bairro: String(req.body?.bairro || '').trim(),
    cidade: String(req.body?.cidade || '').trim(),
    estado: String(req.body?.estado || '').trim().toUpperCase()
  };

  const preferenciasPagamento = {
    recorrencia_aceita: Boolean(req.body?.recorrencia_aceita),
    dia_preferido_cobranca: Number(req.body?.dia_pagamento || 10),
    wallets_preferidas: Array.isArray(req.body?.wallets_preferidas)
      ? req.body.wallets_preferidas.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : []
  };

  const hasRawCardData = [
    req.body?.numero_cartao,
    req.body?.cvv,
    req.body?.card_number,
    req.body?.security_code,
    req.body?.dados_cartao
  ].some((value) => String(value || '').trim().length > 0);

  if (hasRawCardData) {
    return res.status(400).json({
      erro: 'Dados brutos de cartao nao sao aceitos. Use tokenizacao do gateway de pagamento para maxima seguranca.'
    });
  }

  if (!nome || !email || !senha || !cpf || !telefone || !endereco.cep || !endereco.logradouro || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.estado) {
    return res.status(400).json({ erro: 'Preencha nome, email, senha, cpf, telefone e endereco completo.' });
  }

  const passwordCheck = validatePasswordStrength(senha);
  if (!passwordCheck.ok) {
    return res.status(400).json({ erro: passwordCheck.erro });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [email]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Ja existe cadastro com este email.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const userResult = await client.query(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo) VALUES ($1, $2, $3, 'cliente', true) RETURNING id",
      [nome, email, senhaHash]
    );
    const usuarioId = userResult.rows[0].id;

    await client.query(
      `
      INSERT INTO loja_clientes_perfis
        (usuario_id, cpf, nascimento, telefone, endereco_json, contato_json, preferencias_pagamento_json, termos_aceitos_em)
      VALUES
        ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
      `,
      [
        usuarioId,
        cpf,
        nascimento || null,
        telefone,
        JSON.stringify(endereco),
        JSON.stringify({ telefone, email }),
        JSON.stringify(preferenciasPagamento)
      ]
    );

    if (preferenciasPagamento.recorrencia_aceita && preferenciasPagamento.dia_preferido_cobranca >= 1 && preferenciasPagamento.dia_preferido_cobranca <= 28) {
      await client.query(
        `
        INSERT INTO pagamento_preferencias (usuario_id, dia_pagamento, data_vigencia, mensagem_alerta, atualizado_em)
        VALUES ($1, $2, CURRENT_DATE, $3, NOW())
        ON CONFLICT (usuario_id)
        DO UPDATE SET
          dia_pagamento = EXCLUDED.dia_pagamento,
          mensagem_alerta = EXCLUDED.mensagem_alerta,
          atualizado_em = NOW()
        `,
        [usuarioId, preferenciasPagamento.dia_preferido_cobranca, 'Cadastro rapido loja cliente']
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, usuario_id: usuarioId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ erro: 'Falha ao cadastrar cliente da loja.' });
  } finally {
    client.release();
  }
});

app.post('/api/bootstrap/fundadores', loginRateLimiter, async (req, res) => {
  if (!BOOTSTRAP_FOUNDERS_ENABLED) {
    return res.status(410).json({
      erro: 'Bootstrap de fundadores desativado neste ambiente.'
    });
  }

  // Accept optional overrides from the request body so the UI can provide emails
  // and passwords to be used for bootstrap creation. Fields accepted:
  // caio_email, caio_password, dayenne_email, dayenne_password, ti_email, ti_password
  const overrides = {
    BOOTSTRAP_ADMIN_CAIO_EMAIL: req.body?.caio_email || req.body?.bootstrap_admin_caio_email || undefined,
    BOOTSTRAP_ADMIN_CAIO_PASSWORD: req.body?.caio_password || req.body?.bootstrap_admin_caio_password || undefined,
    BOOTSTRAP_ADMIN_DAYENNE_EMAIL: req.body?.dayenne_email || req.body?.bootstrap_admin_dayenne_email || undefined,
    BOOTSTRAP_ADMIN_DAYENNE_PASSWORD: req.body?.dayenne_password || req.body?.bootstrap_admin_dayenne_password || undefined,
    BOOTSTRAP_TI_EMAIL: req.body?.ti_email || req.body?.bootstrap_ti_email || undefined,
    BOOTSTRAP_TI_PASSWORD: req.body?.ti_password || req.body?.bootstrap_ti_password || undefined
  };

  const passcode = String(req.body?.senha_acesso || '').trim();
  const knownGateSecrets = getBootstrapGateSecrets(overrides);

  if (!knownGateSecrets.length) {
    return res.status(503).json({
      erro: 'Bootstrap protegido nao configurado. Defina ADMIN_AREA_SHARED_PASSCODE ou senhas BOOTSTRAP_* no ambiente.'
    });
  }

  if (!isBootstrapGatePasscodeValid(passcode, overrides)) {
    await logSecurityEvent(req, 'bootstrap_fundadores_rejeitado', {});
    return res.status(401).json({
      erro: 'Senha de acesso invalida para bootstrap.',
      dica: 'Use ADMIN_AREA_SHARED_PASSCODE ou uma senha BOOTSTRAP_* valida do ambiente.'
    });
  }

  await ensureCoreSystemUsers(overrides);

  const privilegedCountAfter = await pool.query(
    "SELECT COUNT(*)::int AS total FROM usuarios WHERE tipo_usuario IN ('admin', 'ti')"
  );
  const totalPrivilegedAfter = Number(privilegedCountAfter.rows[0]?.total || 0);

  const coreUsers = getCoreBootstrapUsers(overrides);
  const emailsToQuery = coreUsers.map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean);

  const { rows } = await pool.query(
    `
    SELECT id, nome, email, tipo_usuario, ativo, data_cadastro
    FROM usuarios
    WHERE lower(email) = ANY($1::text[])
    ORDER BY email ASC
    `,
    [emailsToQuery]
  );

  await logSecurityEvent(req, 'bootstrap_fundadores_executado', {
    total_contas_bootstrap: rows.length,
    total_privilegiados: totalPrivilegedAfter,
    limite_privilegiados: MAX_BOOTSTRAP_PRIVILEGED_USERS
  });
  return res.json({
    ok: true,
    contas_bootstrap: rows,
    total_privilegiados: totalPrivilegedAfter,
    limite_privilegiados: MAX_BOOTSTRAP_PRIVILEGED_USERS,
    bloqueado: totalPrivilegedAfter >= MAX_BOOTSTRAP_PRIVILEGED_USERS,
    gate: {
      metodos_aceitos: ['ADMIN_AREA_SHARED_PASSCODE', 'BOOTSTRAP_ADMIN_CAIO_PASSWORD', 'BOOTSTRAP_ADMIN_DAYENNE_PASSWORD', 'BOOTSTRAP_TI_PASSWORD'],
      segredos_configurados: knownGateSecrets.length
    },
    descartavel: true,
    observacao: 'Endpoint de bootstrap recomendado apenas para onboarding inicial. Desative com BOOTSTRAP_FOUNDERS_ENABLED=false apos concluir.'
  });
});

// Admin: Listar membros pendentes de ativação
app.get('/admin/membros-pendentes', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nome, u.email, u.data_cadastro, un.nivel_codigo
    FROM usuarios u
    LEFT JOIN usuario_niveis un ON un.usuario_id = u.id
    WHERE u.ativo = false
      AND u.tipo_usuario IN ('aluno', 'ti')
    ORDER BY un.nivel_codigo DESC, u.data_cadastro ASC
  `);
  res.json(rows);
});

// Admin: Aprovar membro (ativar conta)
app.post('/admin/aprovar-membro', auth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  await pool.query('UPDATE usuarios SET ativo = true WHERE id = $1', [id]);
  await logAudit(req, 'aprovar_membro', 'admin', 'usuarios', id, {});
  res.json({ ok: true });
});

app.post('/admin/materiais/:id/aprovar', auth, requireAdmin, async (req, res) => {
  const materialId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!materialId) {
    return res.status(400).json({ erro: 'ID do material invalido.' });
  }

  const materialResult = await pool.query('SELECT id, status_moderacao FROM materiais_materia WHERE id = $1', [materialId]);
  const material = materialResult.rows[0];

  if (!material) {
    return res.status(404).json({ erro: 'Material nao encontrado.' });
  }

  if (material.status_moderacao !== 'pendente') {
    return res.status(400).json({ erro: 'Somente materiais pendentes podem ser aprovados.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE materiais_materia
    SET
      status_moderacao = 'aprovado',
      aprovado_por_id = $1,
      data_aprovacao = NOW(),
      comentario_moderacao = $2,
      data_atualizacao = NOW()
    WHERE id = $3
    RETURNING *
    `,
    [req.userId, comentario, materialId]
  );

  await logAudit(req, 'aprovar_material', 'academico', 'materiais_materia', materialId, { comentario });
  res.json(rows[0]);
});

app.post('/admin/materiais/:id/reprovar', auth, requireAdmin, async (req, res) => {
  const materialId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!materialId) {
    return res.status(400).json({ erro: 'ID do material invalido.' });
  }

  const materialResult = await pool.query('SELECT id, status_moderacao FROM materiais_materia WHERE id = $1', [materialId]);
  const material = materialResult.rows[0];

  if (!material) {
    return res.status(404).json({ erro: 'Material nao encontrado.' });
  }

  if (material.status_moderacao !== 'pendente') {
    return res.status(400).json({ erro: 'Somente materiais pendentes podem ser reprovados.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE materiais_materia
    SET
      status_moderacao = 'reprovado',
      aprovado_por_id = $1,
      data_aprovacao = NOW(),
      comentario_moderacao = $2,
      data_atualizacao = NOW()
    WHERE id = $3
    RETURNING *
    `,
    [req.userId, comentario, materialId]
  );

  await logAudit(req, 'reprovar_material', 'academico', 'materiais_materia', materialId, { comentario });
  res.json(rows[0]);
});

app.get('/aluno/gamificacao/progresso', auth, requireAluno, async (req, res) => {
  const [materiasResult, avaliacoesResult, presencasResult, faltasJustificadasResult] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(DISTINCT m.id)::INT AS total
      FROM materias m
      JOIN alunos_turmas at ON at.turma_id = m.turma_id
      WHERE at.aluno_id = $1
        AND at.status = 'ativo'
        AND m.ativa = true
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT
        COUNT(*)::INT AS total_submissoes,
        ROUND(AVG(s.nota_final)::numeric, 2) AS media_nota
      FROM avaliacoes_v2_submissoes s
      WHERE s.aluno_id = $1
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE ap.presenca_status IN ('presente', 'abonada'))::INT AS presentes,
        COUNT(*) FILTER (WHERE ap.presenca_status = 'falta')::INT AS faltas
      FROM aula_presencas ap
      WHERE ap.aluno_id = $1
      `,
      [req.userId]
    ),
    pool.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM faltas_justificativas fj
      WHERE fj.aluno_id = $1
        AND fj.status = 'aprovado_duplo'
      `,
      [req.userId]
    )
  ]);

  const totalMaterias = materiasResult.rows[0].total || 0;
  const totalSubmissoes = avaliacoesResult.rows[0].total_submissoes || 0;
  const mediaNota = Number(avaliacoesResult.rows[0].media_nota || 0);
  const totalPresencas = presencasResult.rows[0].total || 0;
  const presentes = presencasResult.rows[0].presentes || 0;
  const faltas = presencasResult.rows[0].faltas || 0;
  const faltasJustificadas = faltasJustificadasResult.rows[0].total || 0;
  const taxaPresenca = totalPresencas ? Number(((presentes / totalPresencas) * 100).toFixed(2)) : 0;

  const scoreTrilha = Number(
    (
      Math.min(totalMaterias * 5, 30) +
      Math.min(totalSubmissoes * 3, 30) +
      Math.min((mediaNota / 100) * 25, 25) +
      Math.min((taxaPresenca / 100) * 15, 15)
    ).toFixed(2)
  );

  res.json({
    progresso: {
      materias_ativas: totalMaterias,
      atividades_concluidas: totalSubmissoes,
      media_nota: mediaNota,
      taxa_presenca: taxaPresenca,
      faltas,
      faltas_justificadas: faltasJustificadas,
      score_trilha: scoreTrilha
    }
  });
});

app.get('/aluno/gamificacao/top10', auth, requireAluno, async (req, res) => {
  const [topPrecisao, topTurmasNota, topTurmasAdesao, topTurmasFrequencia] = await Promise.all([
    pool.query(
      `
      SELECT
        u.id AS aluno_id,
        u.nome AS aluno_nome,
        ROUND(AVG(s.nota_final)::numeric, 2) AS media_nota,
        COUNT(*)::INT AS total_avaliacoes
      FROM avaliacoes_v2_submissoes s
      JOIN usuarios u ON u.id = s.aluno_id
      WHERE s.nota_final IS NOT NULL
      GROUP BY u.id, u.nome
      ORDER BY media_nota DESC, total_avaliacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      SELECT
        t.id AS turma_id,
        t.nome AS turma_nome,
        ROUND(AVG(s.nota_final)::numeric, 2) AS media_nota,
        COUNT(*)::INT AS total_avaliacoes
      FROM avaliacoes_v2_submissoes s
      JOIN avaliacoes_v2 a ON a.id = s.avaliacao_id
      JOIN materias m ON m.id = a.materia_id
      JOIN turmas t ON t.id = m.turma_id
      WHERE s.nota_final IS NOT NULL
      GROUP BY t.id, t.nome
      ORDER BY media_nota DESC, total_avaliacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      WITH turma_base AS (
        SELECT
          t.id,
          t.nome,
          COUNT(DISTINCT at.aluno_id) FILTER (WHERE at.status = 'ativo')::INT AS alunos_ativos
        FROM turmas t
        LEFT JOIN alunos_turmas at ON at.turma_id = t.id
        GROUP BY t.id, t.nome
      ),
      turma_engajamento AS (
        SELECT
          m.turma_id,
          COUNT(s.id)::INT AS interacoes
        FROM avaliacoes_v2_submissoes s
        JOIN avaliacoes_v2 a ON a.id = s.avaliacao_id
        JOIN materias m ON m.id = a.materia_id
        GROUP BY m.turma_id
      )
      SELECT
        tb.id AS turma_id,
        tb.nome AS turma_nome,
        tb.alunos_ativos,
        COALESCE(te.interacoes, 0)::INT AS interacoes,
        CASE
          WHEN tb.alunos_ativos = 0 THEN 0
          ELSE ROUND((COALESCE(te.interacoes, 0)::numeric / tb.alunos_ativos), 2)
        END AS indice_adesao
      FROM turma_base tb
      LEFT JOIN turma_engajamento te ON te.turma_id = tb.id
      ORDER BY indice_adesao DESC, interacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      WITH turma_freq AS (
        SELECT
          t.id,
          t.nome,
          COUNT(ap.id)::INT AS total_registros,
          COUNT(ap.id) FILTER (WHERE ap.presenca_status = 'falta')::INT AS total_faltas
        FROM turmas t
        LEFT JOIN aulas_ao_vivo a ON a.turma_id = t.id
        LEFT JOIN aula_presencas ap ON ap.aula_id = a.id
        GROUP BY t.id, t.nome
      )
      SELECT
        id AS turma_id,
        nome AS turma_nome,
        total_registros,
        total_faltas,
        CASE
          WHEN total_registros = 0 THEN 0
          ELSE ROUND(((total_registros - total_faltas)::numeric / total_registros) * 100, 2)
        END AS taxa_presenca
      FROM turma_freq
      ORDER BY taxa_presenca DESC, total_registros DESC
      LIMIT 10
      `
    )
  ]);

  res.json({
    top10: {
      alunos_mais_precisos: topPrecisao.rows,
      turmas_melhor_nota: topTurmasNota.rows,
      turmas_maior_adesao: topTurmasAdesao.rows,
      turmas_menos_faltas: topTurmasFrequencia.rows
    }
  });
});

app.get('/admin/gamificacao/rankings', auth, requireAdmin, async (req, res) => {
  const [topPrecisao, topTurmasNota, topTurmasAdesao, topTurmasFrequencia] = await Promise.all([
    pool.query(
      `
      SELECT
        u.id AS aluno_id,
        u.nome AS aluno_nome,
        ROUND(AVG(s.nota_final)::numeric, 2) AS media_nota,
        COUNT(*)::INT AS total_avaliacoes
      FROM avaliacoes_v2_submissoes s
      JOIN usuarios u ON u.id = s.aluno_id
      WHERE s.nota_final IS NOT NULL
      GROUP BY u.id, u.nome
      ORDER BY media_nota DESC, total_avaliacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      SELECT
        t.id AS turma_id,
        t.nome AS turma_nome,
        ROUND(AVG(s.nota_final)::numeric, 2) AS media_nota,
        COUNT(*)::INT AS total_avaliacoes
      FROM avaliacoes_v2_submissoes s
      JOIN avaliacoes_v2 a ON a.id = s.avaliacao_id
      JOIN materias m ON m.id = a.materia_id
      JOIN turmas t ON t.id = m.turma_id
      WHERE s.nota_final IS NOT NULL
      GROUP BY t.id, t.nome
      ORDER BY media_nota DESC, total_avaliacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      WITH turma_base AS (
        SELECT
          t.id,
          t.nome,
          COUNT(DISTINCT at.aluno_id) FILTER (WHERE at.status = 'ativo')::INT AS alunos_ativos
        FROM turmas t
        LEFT JOIN alunos_turmas at ON at.turma_id = t.id
        GROUP BY t.id, t.nome
      ),
      turma_engajamento AS (
        SELECT
          m.turma_id,
          COUNT(s.id)::INT AS interacoes
        FROM avaliacoes_v2_submissoes s
        JOIN avaliacoes_v2 a ON a.id = s.avaliacao_id
        JOIN materias m ON m.id = a.materia_id
        GROUP BY m.turma_id
      )
      SELECT
        tb.id AS turma_id,
        tb.nome AS turma_nome,
        tb.alunos_ativos,
        COALESCE(te.interacoes, 0)::INT AS interacoes,
        CASE
          WHEN tb.alunos_ativos = 0 THEN 0
          ELSE ROUND((COALESCE(te.interacoes, 0)::numeric / tb.alunos_ativos), 2)
        END AS indice_adesao
      FROM turma_base tb
      LEFT JOIN turma_engajamento te ON te.turma_id = tb.id
      ORDER BY indice_adesao DESC, interacoes DESC
      LIMIT 10
      `
    ),
    pool.query(
      `
      WITH turma_freq AS (
        SELECT
          t.id,
          t.nome,
          COUNT(ap.id)::INT AS total_registros,
          COUNT(ap.id) FILTER (WHERE ap.presenca_status = 'falta')::INT AS total_faltas
        FROM turmas t
        LEFT JOIN aulas_ao_vivo a ON a.turma_id = t.id
        LEFT JOIN aula_presencas ap ON ap.aula_id = a.id
        GROUP BY t.id, t.nome
      )
      SELECT
        id AS turma_id,
        nome AS turma_nome,
        total_registros,
        total_faltas,
        CASE
          WHEN total_registros = 0 THEN 0
          ELSE ROUND(((total_registros - total_faltas)::numeric / total_registros) * 100, 2)
        END AS taxa_presenca
      FROM turma_freq
      ORDER BY taxa_presenca DESC, total_registros DESC
      LIMIT 10
      `
    )
  ]);

  const rankings = {
    alunos_mais_precisos: topPrecisao.rows,
    turmas_melhor_nota: topTurmasNota.rows,
    turmas_maior_adesao: topTurmasAdesao.rows,
    turmas_menos_faltas: topTurmasFrequencia.rows
  };

  await pool.query(
    `
    INSERT INTO ranking_snapshots (tipo_ranking, referencia, dados_json, criado_em)
    VALUES ($1, $2, $3::jsonb, NOW())
    `,
    ['top10_geral', 'admin', JSON.stringify(rankings)]
  );

  res.json({ ok: true, rankings });
});

app.get('/biblioteca/publica/search', auth, async (req, res) => {
  const query = String(req.query?.q || '').trim();
  if (query.length < 2) {
    return res.json({ q: query, results: [] });
  }

  try {
    const [googleResults, openLibraryResults] = await Promise.all([
      searchGoogleBooks(query),
      searchOpenLibrary(query)
    ]);
    const externalShortcuts = buildPublicLibraryLinks(query);

    res.json({
      q: query,
      results: [...googleResults, ...openLibraryResults, ...externalShortcuts]
    });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar acervo externo.' });
  }
});

app.get('/biblioteca/google/drive/search', auth, requireProfessorOrAdmin, async (req, res) => {
  const query = String(req.query?.q || '').trim();
  const limite = Math.max(1, Math.min(Number(req.query?.limite || 20) || 20, 100));
  const folderId = String(req.query?.folder_id || GOOGLE_DRIVE_SHARED_FOLDER_ID || '').trim() || null;

  try {
    const results = await searchGoogleDriveFiles({ query, limit: limite, folderId });
    res.json({
      q: query,
      fonte: 'google_drive',
      folder_id: folderId,
      total: results.length,
      results
    });
  } catch (error) {
    res.status(422).json({
      erro: 'Falha ao consultar Google Drive.',
      detalhes: String(error?.message || 'Erro desconhecido.')
    });
  }
});

app.get('/biblioteca/google/classroom/cursos', auth, requireProfessorOrAdmin, async (req, res) => {
  const limite = Math.max(1, Math.min(Number(req.query?.limite || 30) || 30, 100));

  try {
    const cursos = await listGoogleClassroomCourses({ limit: limite });
    res.json({
      fonte: 'google_classroom',
      total: cursos.length,
      cursos
    });
  } catch (error) {
    res.status(422).json({
      erro: 'Falha ao listar cursos do Google Classroom.',
      detalhes: String(error?.message || 'Erro desconhecido.')
    });
  }
});

app.get('/biblioteca/google/classroom/cursos/:id/atividades', auth, requireProfessorOrAdmin, async (req, res) => {
  const courseId = String(req.params?.id || '').trim();
  const limite = Math.max(1, Math.min(Number(req.query?.limite || 30) || 30, 100));

  if (!courseId) {
    return res.status(400).json({ erro: 'course_id invalido.' });
  }

  try {
    const atividades = await listGoogleClassroomCoursework({ courseId, limit: limite });
    res.json({
      fonte: 'google_classroom',
      course_id: courseId,
      total: atividades.length,
      atividades
    });
  } catch (error) {
    res.status(422).json({
      erro: 'Falha ao listar atividades do curso no Google Classroom.',
      detalhes: String(error?.message || 'Erro desconhecido.')
    });
  }
});

app.post('/biblioteca/transicao/google/importar', auth, requireProfessorOrAdmin, async (req, res) => {
  const fontes = Array.isArray(req.body?.fontes) ? req.body.fontes : ['drive'];
  const query = String(req.body?.q || '').trim();
  const limite = Math.max(1, Math.min(Number(req.body?.limite || 20) || 20, 100));
  const courseId = String(req.body?.course_id || '').trim();
  const folderId = String(req.body?.folder_id || GOOGLE_DRIVE_SHARED_FOLDER_ID || '').trim() || null;
  const gratuito = req.body?.gratuito !== false;

  const normalizedFontes = fontes.map((item) => String(item || '').trim().toLowerCase());
  const collectedItems = [];

  try {
    if (normalizedFontes.includes('drive')) {
      const driveItems = await searchGoogleDriveFiles({ query, limit: limite, folderId });
      collectedItems.push(...driveItems);
    }

    if (normalizedFontes.includes('classroom')) {
      if (!courseId) {
        return res.status(400).json({ erro: 'course_id e obrigatorio quando fontes inclui classroom.' });
      }
      const classroomItems = await listGoogleClassroomCoursework({ courseId, limit: limite });
      collectedItems.push(...classroomItems);
    }

    const result = await importBibliotecaResources({
      userId: req.userId,
      items: collectedItems,
      gratuito
    });

    await logAudit(req, 'importar_transicao_google_biblioteca', 'biblioteca', 'biblioteca_recursos', null, {
      fontes: normalizedFontes,
      total_coletado: collectedItems.length,
      total_importado: result.imported.length,
      total_ignorados: result.skipped.length,
      course_id: courseId || null
    });

    res.status(201).json({
      ok: true,
      fontes: normalizedFontes,
      total_coletado: collectedItems.length,
      importados: result.imported.length,
      ignorados: result.skipped.length,
      detalhes: {
        imported: result.imported,
        skipped: result.skipped
      }
    });
  } catch (error) {
    res.status(422).json({
      erro: 'Falha ao importar conteudo do Google para a biblioteca.',
      detalhes: String(error?.message || 'Erro desconhecido.')
    });
  }
});

app.get('/biblioteca/recursos', auth, async (req, res) => {
  const query = String(req.query?.q || '').trim();
  const hasPrivilegedAccess = hasAuditViewPermission(req.user) || req.user.tipo_usuario === 'professor';
  const params = [];
  let where = `br.status = 'ativo'`;
  let idx = 1;

  if (query) {
    where += ` AND (br.titulo ILIKE $${idx} OR COALESCE(br.descricao, '') ILIKE $${idx})`;
    params.push(`%${query}%`);
    idx += 1;
  }

  if (!hasPrivilegedAccess) {
    const raCodigo = await getUserAcademicRegistrationByUserId(req.userId);
    where += `
      AND (
        br.gratuito = true
        OR EXISTS (
          SELECT 1
          FROM biblioteca_autorizacoes ba
          WHERE ba.recurso_id = br.id
            AND ba.usuario_id = $${idx}
            AND ba.ra_codigo = $${idx + 1}
            AND ba.status = 'ativo'
        )
      )
    `;
    params.push(req.userId, raCodigo);
    idx += 2;
  }

  const { rows } = await pool.query(
    `
    SELECT
      br.id,
      br.titulo,
      br.tipo_recurso,
      br.categoria,
      br.descricao,
      br.url_recurso,
      br.fonte,
      br.gratuito,
      br.status,
      br.criado_em,
      u.nome AS autor_nome
    FROM biblioteca_recursos br
    LEFT JOIN usuarios u ON u.id = br.adicionado_por_id
    WHERE ${where}
    ORDER BY br.criado_em DESC
    LIMIT 300
    `,
    params
  );

  res.json(rows);
});

app.post('/biblioteca/recursos', auth, async (req, res) => {
  const allowed = ['professor', 'admin', 'ti'].includes(req.user.tipo_usuario) || hasAuditViewPermission(req.user);
  if (!allowed) {
    return res.status(403).json({ erro: 'Perfil sem permissao para cadastrar recurso na biblioteca.' });
  }

  const titulo = String(req.body?.titulo || '').trim();
  const tipoRecurso = String(req.body?.tipo_recurso || '').trim().toLowerCase();
  const categoria = String(req.body?.categoria || '').trim() || null;
  const descricao = String(req.body?.descricao || '').trim() || null;
  const urlRecurso = String(req.body?.url_recurso || '').trim();
  const fonte = String(req.body?.fonte || 'interno').trim().toLowerCase() || 'interno';
  const gratuito = req.body?.gratuito !== false;

  if (!titulo || !urlRecurso) {
    return res.status(400).json({ erro: 'titulo e url_recurso sao obrigatorios.' });
  }

  const allowedTypes = ['site', 'texto', 'citacao', 'livro', 'artigo', 'filme', 'serie', 'outro'];
  if (!allowedTypes.includes(tipoRecurso)) {
    return res.status(400).json({ erro: 'tipo_recurso invalido.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO biblioteca_recursos
      (titulo, tipo_recurso, categoria, descricao, url_recurso, fonte, gratuito, status, adicionado_por_id, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, 'ativo', $8, NOW(), NOW())
    RETURNING *
    `,
    [titulo, tipoRecurso, categoria, descricao, urlRecurso, fonte, gratuito, req.userId]
  );

  await trySaveUniversalArchive({
    chave: `biblioteca:${rows[0].id}:${Date.now()}`,
    tipoRecurso: 'biblioteca',
    subtipo: 'recurso_criado',
    payload: rows[0],
    metadata: { origem: 'route:/biblioteca/recursos' },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });

  await logAudit(req, 'cadastrar_recurso_biblioteca', 'biblioteca', 'biblioteca_recursos', rows[0].id, {});
  res.status(201).json(rows[0]);
});

app.post('/biblioteca/recursos/:id/autorizar', auth, requireAuditoria, async (req, res) => {
  const recursoId = Number(req.params.id);
  const usuarioId = Number(req.body?.usuario_id);
  const raCodigo = normalizeAcademicRegistration(req.body?.ra_codigo);
  const observacao = String(req.body?.observacao || '').trim() || null;

  if (!recursoId || !usuarioId || !isValidAcademicRegistration(raCodigo)) {
    return res.status(400).json({ erro: 'recurso, usuario_id e ra_codigo alfanumerico valido sao obrigatorios.' });
  }

  const resourceResult = await pool.query('SELECT id FROM biblioteca_recursos WHERE id = $1', [recursoId]);
  if (!resourceResult.rows.length) {
    return res.status(404).json({ erro: 'Recurso nao encontrado.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO biblioteca_autorizacoes
      (recurso_id, usuario_id, ra_codigo, autorizado_por_id, status, observacao, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, 'ativo', $5, NOW(), NOW())
    ON CONFLICT (recurso_id, usuario_id)
    DO UPDATE SET
      ra_codigo = EXCLUDED.ra_codigo,
      autorizado_por_id = EXCLUDED.autorizado_por_id,
      status = 'ativo',
      observacao = EXCLUDED.observacao,
      atualizado_em = NOW()
    RETURNING *
    `,
    [recursoId, usuarioId, raCodigo, req.userId, observacao]
  );

  await logAudit(req, 'autorizar_recurso_biblioteca', 'biblioteca', 'biblioteca_autorizacoes', rows[0].id, {});
  res.json(rows[0]);
});

// ========================================
// ENDPOINTS: BIBLIOTECA LIVROS (NOVO MÓDULO)
// ========================================

// GET /biblioteca/livros - Listar livros com filtros e paginação
app.get('/biblioteca/livros', auth, async (req, res) => {
  const page = Math.max(1, Number(req.query?.page || 1));
  const per_page = Math.min(50, Math.max(1, Number(req.query?.per_page || 20)));
  const offset = (page - 1) * per_page;

  const search = String(req.query?.search || '').trim().toLowerCase();
  const tema = String(req.query?.tema || '').trim();
  const autor = String(req.query?.autor || '').trim();
  const idioma = String(req.query?.idioma || '').trim();

  let whereClause = 'WHERE bl.status = \'ativo\'';
  const params = [];

  // Controle de acesso por nível
  const userNivel = normalizeNivelCodigo(req.user?.nivel?.nivel_codigo || 'neofito');
  whereClause += ` AND bl.nivel_minimo_acesso IN (${NIVEL_HIERARCHY.filter(n => isNivelAtLeast(userNivel, n)).map(n => `'${n}'`).join(',')})`;

  if (search) {
    whereClause += ` AND (LOWER(bl.titulo) LIKE $${params.length + 1} OR LOWER(bl.autor) LIKE $${params.length + 1} OR LOWER(bl.isbn) LIKE $${params.length + 1})`;
    params.push(`%${search}%`);
  }

  if (tema) {
    whereClause += ` AND EXISTS (SELECT 1 FROM biblioteca_livro_temas blt JOIN biblioteca_temas bt ON bt.id = blt.tema_id WHERE blt.livro_id = bl.id AND bt.nome = $${params.length + 1})`;
    params.push(tema);
  }

  if (autor) {
    whereClause += ` AND LOWER(bl.autor) LIKE $${params.length + 1}`;
    params.push(`%${autor}%`);
  }

  if (idioma) {
    whereClause += ` AND bl.idioma = $${params.length + 1}`;
    params.push(idioma);
  }

  const countQuery = `SELECT COUNT(*) as total FROM biblioteca_livros bl ${whereClause}`;
  const dataQuery = `
    SELECT bl.*, 
      (SELECT json_agg(bt.nome) FROM biblioteca_livro_temas blt 
       JOIN biblioteca_temas bt ON bt.id = blt.tema_id 
       WHERE blt.livro_id = bl.id) as temas
    FROM biblioteca_livros bl ${whereClause}
    ORDER BY bl.titulo ASC
    LIMIT ${params.length + 1} OFFSET ${params.length + 2}`;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, [...params, per_page, offset])
  ]);

  const total = Number(countRes.rows[0]?.total || 0);

  res.json({
    livros: dataRes.rows,
    paginacao: {
      pagina: page,
      por_pagina: per_page,
      total: total,
      total_paginas: Math.ceil(total / per_page)
    }
  });
});

// GET /biblioteca/livros/:id - Detalhes de um livro específico
app.get('/biblioteca/livros/:id', auth, async (req, res) => {
  const livroId = Number(req.params.id);

  if (!livroId) {
    return res.status(400).json({ erro: 'ID do livro invalido.' });
  }

  const { rows } = await pool.query(
    `SELECT bl.*, 
      (SELECT json_agg(json_build_object('id', bt.id, 'nome', bt.nome)) 
       FROM biblioteca_livro_temas blt 
       JOIN biblioteca_temas bt ON bt.id = blt.tema_id 
       WHERE blt.livro_id = bl.id) as temas,
      (SELECT COUNT(*) as contador FROM biblioteca_leituras_usuario WHERE livro_id = bl.id AND status = 'lido') as usuarios_leram,
      (SELECT AVG(nota_pessoal)::numeric(3,1) FROM biblioteca_leituras_usuario WHERE livro_id = bl.id AND nota_pessoal IS NOT NULL) as media_notas
    FROM biblioteca_livros bl 
    WHERE bl.id = $1 AND bl.status = 'ativo'`,
    [livroId]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Livro nao encontrado.' });
  }

  res.json(rows[0]);
});

// POST /biblioteca/livros - Criar novo livro (admin only)
app.post('/biblioteca/livros', auth, requireAdmin, async (req, res) => {
  const titulo = String(req.body?.titulo || '').trim();
  const autor = String(req.body?.autor || '').trim();
  const isbn = String(req.body?.isbn || '').trim() || null;
  const editora = String(req.body?.editora || '').trim() || null;
  const ano_publicacao = Number(req.body?.ano_publicacao || null);
  const edicao = String(req.body?.edicao || '').trim() || null;
  const idioma = String(req.body?.idioma || 'pt-BR').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const nivel_minimo = String(req.body?.nivel_minimo_acesso || 'neofito').trim();
  const url_acesso = String(req.body?.url_acesso || '').trim() || null;
  const nota_acesso = String(req.body?.nota_acesso || '').trim() || null;
  const urls = req.body?.urls || {};
  const paginas = Number(req.body?.paginas || null);
  const categoria = String(req.body?.categoria || '').trim() || null;
  const tema_ids = Array.isArray(req.body?.tema_ids) ? req.body.tema_ids.map(Number).filter(id => !isNaN(id)) : [];

  if (!titulo || !autor) {
    return res.status(400).json({ erro: 'titulo e autor sao obrigatorios.' });
  }

  if (!NIVEL_HIERARCHY.includes(nivel_minimo)) {
    return res.status(400).json({ erro: 'nivel_minimo_acesso invalido.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO biblioteca_livros 
        (isbn, titulo, autor, editora, ano_publicacao, edicao, idioma, descricao, 
         nivel_minimo_acesso, url_acesso, url_mercado_livre, url_amazon, url_fnac, 
         url_openlibrary, url_google_books, nota_acesso, paginas, categoria, adicionado_por_id, criado_em, atualizado_em)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
      RETURNING *`,
      [isbn, titulo, autor, editora, ano_publicacao || null, edicao, idioma, descricao,
       nivel_minimo, url_acesso, urls.mercado_livre || null, urls.amazon || null, urls.fnac || null,
       urls.openlibrary || null, urls.google_books || null, nota_acesso, paginas || null, categoria, req.userId]
    );

    const livroId = rows[0].id;

    // Inserir temas
    if (tema_ids.length > 0) {
      await pool.query(
        `INSERT INTO biblioteca_livro_temas (livro_id, tema_id) 
         VALUES ${tema_ids.map((_, i) => `($1, $${i + 2})`).join(',')}
         ON CONFLICT DO NOTHING`,
        [livroId, ...tema_ids]
      );
    }

    await logAudit(req, 'criar_livro_biblioteca', 'biblioteca', 'biblioteca_livros', livroId, { titulo, autor });

    res.status(201).json({ ok: true, livro_id: livroId, livro: rows[0] });
  } catch (error) {
    if (error.message.includes('unique')) {
      return res.status(409).json({ erro: 'ISBN ja existe na biblioteca.' });
    }
    throw error;
  }
});

// PUT /biblioteca/livros/:id - Atualizar livro (admin only)
app.put('/biblioteca/livros/:id', auth, requireAdmin, async (req, res) => {
  const livroId = Number(req.params.id);
  const updates = {};
  const updateFields = ['titulo', 'autor', 'editora', 'ano_publicacao', 'edicao', 'idioma', 'descricao', 'nivel_minimo_acesso', 'url_acesso', 'nota_acesso', 'paginas', 'categoria', 'status'];

  updateFields.forEach(field => {
    if (req.body?.[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (req.body?.urls && typeof req.body.urls === 'object') {
    Object.assign(updates, {
      url_mercado_livre: req.body.urls.mercado_livre,
      url_amazon: req.body.urls.amazon,
      url_fnac: req.body.urls.fnac,
      url_openlibrary: req.body.urls.openlibrary,
      url_google_books: req.body.urls.google_books
    });
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
  }

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [...Object.values(updates), livroId];

  const { rows } = await pool.query(
    `UPDATE biblioteca_livros SET ${setClauses}, atualizado_em = NOW() WHERE id = $1 RETURNING *`,
    values
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Livro nao encontrado.' });
  }

  await logAudit(req, 'atualizar_livro_biblioteca', 'biblioteca', 'biblioteca_livros', livroId, updates);
  res.json(rows[0]);
});

// DELETE /biblioteca/livros/:id - Deletar livro (admin only)
app.delete('/biblioteca/livros/:id', auth, requireAdmin, async (req, res) => {
  const livroId = Number(req.params.id);

  const { rows } = await pool.query(
    'DELETE FROM biblioteca_livros WHERE id = $1 RETURNING id',
    [livroId]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Livro nao encontrado.' });
  }

  await logAudit(req, 'deletar_livro_biblioteca', 'biblioteca', 'biblioteca_livros', livroId, {});
  res.json({ ok: true, deletado_id: livroId });
});

// GET /biblioteca/temas - Listar todos os temas
app.get('/biblioteca/temas', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM biblioteca_temas WHERE ativo = true ORDER BY ordem_exibicao ASC, nome ASC'
  );
  res.json(rows);
});

// POST /biblioteca/temas - Criar novo tema (admin only)
app.post('/biblioteca/temas', auth, requireAdmin, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const ordem = Number(req.body?.ordem_exibicao || 0);

  if (!nome) {
    return res.status(400).json({ erro: 'nome do tema e obrigatorio.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO biblioteca_temas (nome, descricao, ordem_exibicao, ativo, criado_em) 
       VALUES ($1, $2, $3, true, NOW()) 
       RETURNING *`,
      [nome, descricao, ordem]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.message.includes('unique')) {
      return res.status(409).json({ erro: 'Tema ja existe.' });
    }
    throw error;
  }
});

// POST /biblioteca/livros/:id/leitura - Registrar status de leitura do usuário
app.post('/biblioteca/livros/:id/leitura', auth, async (req, res) => {
  const livroId = Number(req.params.id);
  const status = String(req.body?.status || 'para_ler').trim();
  const paginas_lidas = Number(req.body?.paginas_lidas || 0);
  const nota = Number(req.body?.nota_pessoal || null);
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!['para_ler', 'lendo', 'lido', 'abandonado'].includes(status)) {
    return res.status(400).json({ erro: 'status de leitura invalido.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO biblioteca_leituras_usuario 
      (usuario_id, livro_id, status, paginas_lidas, nota_pessoal, comentario, iniciado_em, finalizado_em, criado_em, atualizado_em)
    VALUES 
      ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'lendo' THEN NOW() ELSE NULL END, CASE WHEN $3 = 'lido' THEN NOW() ELSE NULL END, NOW(), NOW())
    ON CONFLICT (usuario_id, livro_id) 
    DO UPDATE SET 
      status = EXCLUDED.status, 
      paginas_lidas = EXCLUDED.paginas_lidas, 
      nota_pessoal = EXCLUDED.nota_pessoal, 
      comentario = EXCLUDED.comentario, 
      finalizado_em = CASE WHEN EXCLUDED.status = 'lido' THEN NOW() ELSE NULL END,
      atualizado_em = NOW()
    RETURNING *`,
    [req.userId, livroId, status, paginas_lidas, nota > 0 && nota <= 5 ? nota : null, comentario]
  );

  res.json({ ok: true, registro: rows[0] });
});

// GET /biblioteca/minha-leitura - Livros que o usuário está lendo/leu
app.get('/biblioteca/minha-leitura', auth, async (req, res) => {
  const status = String(req.query?.status || '').trim() || null;

  let query = `SELECT bl.*, blu.status, blu.nota_pessoal, blu.comentario, blu.atualizado_em
    FROM biblioteca_leituras_usuario blu
    JOIN biblioteca_livros bl ON bl.id = blu.livro_id
    WHERE blu.usuario_id = $1`;

  const params = [req.userId];

  if (status) {
    query += ` AND blu.status = $${params.length + 1}`;
    params.push(status);
  }

  query += ' ORDER BY blu.atualizado_em DESC';

  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.get('/diario/pessoal', auth, async (req, res) => {
  const viewerIsAuditor = hasAuditViewPermission(req.user);
  const targetUserId = req.query?.usuario_id && viewerIsAuditor ? Number(req.query.usuario_id) : req.userId;
  const usuarioId = Number(targetUserId || req.userId);

  const { rows } = await pool.query(
    `
    SELECT
      d.id,
      d.usuario_id,
      u.nome AS usuario_nome,
      d.titulo,
      d.conteudo_texto,
      d.sentimento,
      d.desenho_url,
      d.visivel_para_supervisao,
      d.criado_em,
      d.atualizado_em
    FROM diarios_pessoais d
    JOIN usuarios u ON u.id = d.usuario_id
    WHERE d.usuario_id = $1
    ORDER BY d.criado_em DESC
    LIMIT 300
    `,
    [usuarioId]
  );

  res.json(rows);
});

app.post('/diario/pessoal', auth, async (req, res) => {
  const titulo = String(req.body?.titulo || '').trim() || null;
  const conteudoTexto = String(req.body?.conteudo_texto || '').trim();
  const sentimento = String(req.body?.sentimento || '').trim() || null;
  const desenhoUrl = String(req.body?.desenho_url || '').trim() || null;
  const visivel = req.body?.visivel_para_supervisao !== false;

  if (!conteudoTexto && !desenhoUrl) {
    return res.status(400).json({ erro: 'Informe conteudo_texto ou desenho_url.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO diarios_pessoais
      (usuario_id, titulo, conteudo_texto, sentimento, desenho_url, visivel_para_supervisao, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING *
    `,
    [req.userId, titulo, conteudoTexto || null, sentimento, desenhoUrl, visivel]
  );

  await logAudit(req, 'registrar_diario_pessoal', 'diario', 'diarios_pessoais', rows[0].id, {});
  res.status(201).json(rows[0]);
});

app.post('/diario/pessoal/:id/comentarios', auth, requireAuditoria, async (req, res) => {
  const diarioId = Number(req.params.id);
  const comentario = String(req.body?.comentario || '').trim();

  if (!diarioId || !comentario) {
    return res.status(400).json({ erro: 'diario_id e comentario sao obrigatorios.' });
  }

  const diarioResult = await pool.query('SELECT id FROM diarios_pessoais WHERE id = $1', [diarioId]);
  if (!diarioResult.rows.length) {
    return res.status(404).json({ erro: 'Registro de diario nao encontrado.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO diarios_comentarios (diario_id, comentado_por_id, comentario, criado_em)
    VALUES ($1, $2, $3, NOW())
    RETURNING *
    `,
    [diarioId, req.userId, comentario]
  );

  await logAudit(req, 'comentar_diario_pessoal', 'diario', 'diarios_comentarios', rows[0].id, {});
  res.status(201).json(rows[0]);
});

app.get('/diario/pessoal/:id/comentarios', auth, async (req, res) => {
  const diarioId = Number(req.params.id);
  if (!diarioId) {
    return res.status(400).json({ erro: 'diario_id invalido.' });
  }

  const diarioResult = await pool.query(
    `
    SELECT id, usuario_id, visivel_para_supervisao
    FROM diarios_pessoais
    WHERE id = $1
    LIMIT 1
    `,
    [diarioId]
  );
  const diario = diarioResult.rows[0];
  if (!diario) {
    return res.status(404).json({ erro: 'Registro de diario nao encontrado.' });
  }

  const canRead = Number(diario.usuario_id) === req.userId || hasAuditViewPermission(req.user);
  if (!canRead) {
    return res.status(403).json({ erro: 'Sem permissao para visualizar comentarios deste diario.' });
  }

  const { rows } = await pool.query(
    `
    SELECT
      dc.id,
      dc.diario_id,
      dc.comentario,
      dc.criado_em,
      u.id AS autor_id,
      u.nome AS autor_nome
    FROM diarios_comentarios dc
    JOIN usuarios u ON u.id = dc.comentado_por_id
    WHERE dc.diario_id = $1
    ORDER BY dc.criado_em DESC
    `,
    [diarioId]
  );

  res.json(rows);
});

app.get('/grimorio/pessoal', auth, async (req, res) => {
  const viewerIsAuditor = hasAuditViewPermission(req.user);
  const targetUserId = req.query?.usuario_id && viewerIsAuditor ? Number(req.query.usuario_id) : req.userId;
  const usuarioId = Number(targetUserId || req.userId);

  const { rows } = await pool.query(
    `
    SELECT
      g.id,
      g.usuario_id,
      u.nome AS usuario_nome,
      g.titulo,
      g.tipo_registro,
      g.conteudo_texto,
      g.tags,
      g.visivel_para_supervisao,
      g.criado_em,
      g.atualizado_em
    FROM grimorio_pessoal g
    JOIN usuarios u ON u.id = g.usuario_id
    WHERE g.usuario_id = $1
    ORDER BY g.criado_em DESC
    LIMIT 300
    `,
    [usuarioId]
  );

  res.json(rows);
});

app.post('/grimorio/pessoal', auth, async (req, res) => {
  const titulo = String(req.body?.titulo || '').trim() || null;
  const tipoRegistro = String(req.body?.tipo_registro || 'anotacao').trim().toLowerCase();
  const conteudoTexto = String(req.body?.conteudo_texto || '').trim();
  const visivel = req.body?.visivel_para_supervisao !== false;
  const rawTags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  const tags = rawTags
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  const allowedTypes = new Set(['anotacao', 'ritual', 'estudo', 'referencia']);
  if (!conteudoTexto) {
    return res.status(400).json({ erro: 'conteudo_texto e obrigatorio.' });
  }
  if (!allowedTypes.has(tipoRegistro)) {
    return res.status(400).json({ erro: 'tipo_registro invalido.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO grimorio_pessoal
      (usuario_id, titulo, tipo_registro, conteudo_texto, tags, visivel_para_supervisao, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
    RETURNING *
    `,
    [req.userId, titulo, tipoRegistro, conteudoTexto, JSON.stringify(tags), visivel]
  );

  await trySaveUniversalArchive({
    chave: `grimorio:${rows[0].id}:${Date.now()}`,
    tipoRecurso: 'grimorio',
    subtipo: 'registro_criado',
    payload: rows[0],
    metadata: { origem: 'route:/grimorio/pessoal' },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });

  await logAudit(req, 'registrar_grimorio_pessoal', 'grimorio', 'grimorio_pessoal', rows[0].id, {});
  res.status(201).json(rows[0]);
});

app.post('/notificacoes/whatsapp/enviar', auth, requireAuditoria, async (req, res) => {
  const usuarioId = req.body?.usuario_id ? Number(req.body.usuario_id) : null;
  const destinatario = String(req.body?.telefone || '').trim();
  const mensagem = String(req.body?.mensagem || '').trim();
  const origem = String(req.body?.origem || 'manual').trim();

  if ((!usuarioId && !destinatario) || !mensagem) {
    return res.status(400).json({ erro: 'usuario_id ou telefone e mensagem sao obrigatorios.' });
  }

  let telefoneFinal = destinatario;
  if (usuarioId && !telefoneFinal) {
    const userResult = await pool.query(
      `
      SELECT i.telefone
      FROM usuarios u
      LEFT JOIN inscricoes i ON i.email = u.email
      WHERE u.id = $1
      LIMIT 1
      `,
      [usuarioId]
    );
    telefoneFinal = String(userResult.rows[0]?.telefone || '').trim();
  }

  if (!telefoneFinal) {
    return res.status(400).json({ erro: 'Telefone nao encontrado para envio.' });
  }

  try {
    const providerResponse = await sendWhatsAppNotification({
      to: telefoneFinal,
      message: mensagem
    });

    await pool.query(
      `
      INSERT INTO notifications (usuario_id, tipo, mensagem, canal, enviado, created_at)
      VALUES ($1, $2, $3, 'whatsapp', true, NOW())
      `,
      [usuarioId, origem, mensagem]
    );

    await logAudit(req, 'enviar_notificacao_whatsapp', 'notificacao', 'notifications', usuarioId, { telefone: telefoneFinal });
    res.json({ ok: true, provider_response: redactSensitiveFields(providerResponse) });
  } catch (error) {
    await pool.query(
      `
      INSERT INTO notifications (usuario_id, tipo, mensagem, canal, enviado, created_at)
      VALUES ($1, $2, $3, 'whatsapp', false, NOW())
      `,
      [usuarioId, `${origem}_falha`, mensagem]
    );
    res.status(502).json({ erro: 'Falha ao enviar WhatsApp.', detalhes: error.message });
  }
});

app.get('/live/salas', auth, async (req, res) => {
  let whereClause = '1 = 1';
  const params = [];

  if (req.user.tipo_usuario === 'professor') {
    whereClause = 'a.professor_id = $1';
    params.push(req.userId);
  } else if (req.user.tipo_usuario === 'aluno') {
    whereClause = `
      EXISTS (
        SELECT 1
        FROM alunos_turmas at
        WHERE at.turma_id = a.turma_id
          AND at.aluno_id = $1
          AND at.status = 'ativo'
      )
    `;
    params.push(req.userId);
  } else if (!['admin', 'ti'].includes(req.user.tipo_usuario)) {
    return res.status(403).json({ erro: 'Perfil sem acesso ao modulo de aulas ao vivo.' });
  }

  const { rows } = await pool.query(
    `
    SELECT
      a.id,
      a.titulo,
      a.descricao,
      a.status,
      a.inicio_previsto,
      a.fim_previsto,
      a.inicio_real,
      a.fim_real,
      a.link_sala,
      a.provedor_sala,
      a.sala_externa_id,
      a.detalhes_provedor_json,
      a.conteudo_aprovado,
      t.id AS turma_id,
      t.nome AS turma_nome,
      m.id AS materia_id,
      m.nome AS materia_nome,
      p.id AS professor_id,
      p.nome AS professor_nome
    FROM aulas_ao_vivo a
    LEFT JOIN turmas t ON t.id = a.turma_id
    LEFT JOIN materias m ON m.id = a.materia_id
    LEFT JOIN usuarios p ON p.id = a.professor_id
    WHERE ${whereClause}
    ORDER BY COALESCE(a.inicio_previsto, a.criado_em) DESC
    LIMIT 150
    `,
    params
  );

  res.json(rows);
});

app.post('/live/salas', auth, requireProfessorOrAdmin, async (req, res) => {
  const turmaId = req.body?.turma_id ? Number(req.body.turma_id) : null;
  const materiaId = req.body?.materia_id ? Number(req.body.materia_id) : null;
  const titulo = String(req.body?.titulo || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const inicioPrevisto = req.body?.inicio_previsto ? new Date(req.body.inicio_previsto) : null;
  const fimPrevisto = req.body?.fim_previsto ? new Date(req.body.fim_previsto) : null;
  const professorIdFromBody = req.body?.professor_id ? Number(req.body.professor_id) : null;
  const provedorSala = normalizeLiveProvider(req.body?.provedor_sala || req.body?.provider || 'interno');

  if (!titulo) {
    return res.status(400).json({ erro: 'titulo e obrigatorio.' });
  }

  if (inicioPrevisto && Number.isNaN(inicioPrevisto.getTime())) {
    return res.status(400).json({ erro: 'inicio_previsto invalido.' });
  }

  if (fimPrevisto && Number.isNaN(fimPrevisto.getTime())) {
    return res.status(400).json({ erro: 'fim_previsto invalido.' });
  }

  if (inicioPrevisto && fimPrevisto && fimPrevisto <= inicioPrevisto) {
    return res.status(400).json({ erro: 'fim_previsto deve ser maior que inicio_previsto.' });
  }

  let professorId = req.userId;
  if (req.user.tipo_usuario === 'admin') {
    professorId = professorIdFromBody || req.userId;
  }

  if (professorIdFromBody && req.user.tipo_usuario === 'admin') {
    const professorResult = await pool.query(
      "SELECT id FROM usuarios WHERE id = $1 AND tipo_usuario = 'professor'",
      [professorIdFromBody]
    );
    if (!professorResult.rows.length) {
      return res.status(400).json({ erro: 'professor_id invalido.' });
    }
  }

  if (materiaId && req.user.tipo_usuario === 'professor') {
    const materia = await materiaDoProfessor(materiaId, req.userId);
    if (!materia) {
      return res.status(403).json({ erro: 'Professor nao pode criar sala para materia fora do escopo.' });
    }
  }

  if (turmaId) {
    const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
    if (!turma.rows.length) {
      return res.status(404).json({ erro: 'Turma nao encontrada.' });
    }
  }

  if (materiaId) {
    const materia = await pool.query('SELECT id FROM materias WHERE id = $1', [materiaId]);
    if (!materia.rows.length) {
      return res.status(404).json({ erro: 'Materia nao encontrada.' });
    }
  }

  const precisaAprovacao = req.user.tipo_usuario !== 'admin';
  const status = req.user.tipo_usuario === 'admin'
    ? (inicioPrevisto ? 'agendada' : 'aprovada')
    : 'pendente';

  let liveProvision = {
    provider: 'interno',
    link: buildInternalLiveLink(),
    externalId: null,
    details: {}
  };

  try {
    liveProvision = await provisionLiveLink({
      provider: provedorSala,
      title: titulo,
      startDate: inicioPrevisto,
      endDate: fimPrevisto
    });
  } catch (error) {
    return res.status(400).json({
      erro: `Falha ao provisionar sala no provedor ${provedorSala}.`,
      detalhes: String(error.message || 'Erro desconhecido.')
    });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO aulas_ao_vivo
      (
        turma_id,
        materia_id,
        criado_por_id,
        professor_id,
        titulo,
        descricao,
        status,
        inicio_previsto,
        fim_previsto,
        precisa_aprovacao,
        aprovado_por_id,
        aprovado_em,
        link_sala,
        provedor_sala,
        sala_externa_id,
        detalhes_provedor_json,
        conteudo_aprovado,
        criado_em,
        atualizado_em
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, false, NOW(), NOW())
    RETURNING *
    `,
    [
      turmaId,
      materiaId,
      req.userId,
      professorId,
      titulo,
      descricao,
      status,
      inicioPrevisto,
      fimPrevisto,
      precisaAprovacao,
      req.user.tipo_usuario === 'admin' ? req.userId : null,
      req.user.tipo_usuario === 'admin' ? new Date() : null,
      liveProvision.link,
      liveProvision.provider,
      liveProvision.externalId,
      JSON.stringify(redactSensitiveFields(liveProvision.details || {}))
    ]
  );

  await logAudit(req, 'criar_aula_ao_vivo', 'live', 'aulas_ao_vivo', rows[0].id, {
    status,
    precisa_aprovacao: precisaAprovacao,
    provedor_sala: liveProvision.provider
  });

  res.status(201).json(rows[0]);
});

app.post('/live/salas/:id/agendar', auth, requireProfessorOrAdmin, async (req, res) => {
  const aulaId = Number(req.params.id);
  const inicioPrevisto = req.body?.inicio_previsto ? new Date(req.body.inicio_previsto) : null;
  const fimPrevisto = req.body?.fim_previsto ? new Date(req.body.fim_previsto) : null;

  if (!aulaId || !inicioPrevisto || !fimPrevisto || Number.isNaN(inicioPrevisto.getTime()) || Number.isNaN(fimPrevisto.getTime())) {
    return res.status(400).json({ erro: 'aula, inicio_previsto e fim_previsto validos sao obrigatorios.' });
  }

  if (fimPrevisto <= inicioPrevisto) {
    return res.status(400).json({ erro: 'fim_previsto deve ser maior que inicio_previsto.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT id, professor_id
    FROM aulas_ao_vivo
    WHERE id = $1
    `,
    [aulaId]
  );
  const aula = aulaResult.rows[0];

  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  if (req.user.tipo_usuario === 'professor' && Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para agendar esta sala.' });
  }

  const status = req.user.tipo_usuario === 'admin' ? 'agendada' : 'pendente';
  const aprovadoPor = req.user.tipo_usuario === 'admin' ? req.userId : null;
  const aprovadoEm = req.user.tipo_usuario === 'admin' ? new Date() : null;

  const { rows } = await pool.query(
    `
    UPDATE aulas_ao_vivo
    SET
      inicio_previsto = $1,
      fim_previsto = $2,
      status = $3,
      precisa_aprovacao = $4,
      aprovado_por_id = $5,
      aprovado_em = $6,
      atualizado_em = NOW()
    WHERE id = $7
    RETURNING *
    `,
    [
      inicioPrevisto,
      fimPrevisto,
      status,
      req.user.tipo_usuario !== 'admin',
      aprovadoPor,
      aprovadoEm,
      aulaId
    ]
  );

  await logAudit(req, 'agendar_aula_ao_vivo', 'live', 'aulas_ao_vivo', aulaId, { status });
  res.json(rows[0]);
});

app.post('/live/salas/:id/gerar-link', auth, requireProfessorOrAdmin, async (req, res) => {
  const aulaId = Number(req.params.id);
  const provider = normalizeLiveProvider(req.body?.provedor_sala || req.body?.provider || 'interno');
  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da sala invalido.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT id, titulo, professor_id, inicio_previsto, fim_previsto
    FROM aulas_ao_vivo
    WHERE id = $1
    LIMIT 1
    `,
    [aulaId]
  );
  const aula = aulaResult.rows[0];
  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  if (req.user.tipo_usuario === 'professor' && Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para alterar esta sala.' });
  }

  try {
    const provision = await provisionLiveLink({
      provider,
      title: aula.titulo,
      startDate: aula.inicio_previsto ? new Date(aula.inicio_previsto) : null,
      endDate: aula.fim_previsto ? new Date(aula.fim_previsto) : null
    });

    const { rows } = await pool.query(
      `
      UPDATE aulas_ao_vivo
      SET
        link_sala = $1,
        provedor_sala = $2,
        sala_externa_id = $3,
        detalhes_provedor_json = $4::jsonb,
        atualizado_em = NOW()
      WHERE id = $5
      RETURNING *
      `,
      [
        provision.link,
        provision.provider,
        provision.externalId,
        JSON.stringify(redactSensitiveFields(provision.details || {})),
        aulaId
      ]
    );

    await logAudit(req, 'gerar_link_aula_ao_vivo', 'live', 'aulas_ao_vivo', aulaId, {
      provider: provision.provider
    });
    return res.json(rows[0]);
  } catch (error) {
    return res.status(400).json({
      erro: `Falha ao gerar link para provider ${provider}.`,
      detalhes: String(error.message || 'Erro desconhecido.')
    });
  }
});

app.post('/live/salas/:id/aprovar-agenda', auth, requireAdmin, async (req, res) => {
  const aulaId = Number(req.params.id);
  const decisao = String(req.body?.decisao || 'aprovada').trim().toLowerCase();
  const motivo = String(req.body?.motivo || '').trim() || null;

  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da sala invalido.' });
  }

  if (!['aprovada', 'rejeitada'].includes(decisao)) {
    return res.status(400).json({ erro: 'decisao deve ser aprovada ou rejeitada.' });
  }

  const status = decisao === 'aprovada' ? 'agendada' : 'rejeitada';

  const { rows } = await pool.query(
    `
    UPDATE aulas_ao_vivo
    SET
      status = $1,
      precisa_aprovacao = false,
      aprovado_por_id = $2,
      aprovado_em = NOW(),
      motivo_rejeicao = $3,
      atualizado_em = NOW()
    WHERE id = $4
    RETURNING *
    `,
    [status, req.userId, decisao === 'rejeitada' ? motivo : null, aulaId]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  await logAudit(req, 'aprovar_agenda_aula', 'live', 'aulas_ao_vivo', aulaId, { decisao, motivo });
  res.json(rows[0]);
});

app.post('/live/salas/:id/entrar', auth, async (req, res) => {
  const aulaId = Number(req.params.id);
  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da sala invalido.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT id, turma_id, professor_id, status, titulo, link_sala, provedor_sala, sala_externa_id
    FROM aulas_ao_vivo
    WHERE id = $1
    `,
    [aulaId]
  );
  const aula = aulaResult.rows[0];

  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  let papelNaAula = 'aluno';
  let allowed = false;

  if (['admin', 'ti'].includes(req.user.tipo_usuario)) {
    papelNaAula = req.user.tipo_usuario;
    allowed = true;
  } else if (req.user.tipo_usuario === 'professor') {
    allowed = Number(aula.professor_id) === req.userId;
    papelNaAula = 'professor';
  } else if (req.user.tipo_usuario === 'aluno') {
    const matriculaResult = await pool.query(
      `
      SELECT id
      FROM alunos_turmas
      WHERE aluno_id = $1
        AND turma_id = $2
        AND status = 'ativo'
      `,
      [req.userId, aula.turma_id]
    );
    allowed = Boolean(matriculaResult.rows.length);
    papelNaAula = 'aluno';
  }

  if (!allowed) {
    return res.status(403).json({ erro: 'Sem acesso a esta sala.' });
  }

  if (req.user.tipo_usuario === 'aluno' && !['agendada', 'ao_vivo'].includes(aula.status)) {
    return res.status(400).json({ erro: 'Sala nao esta disponivel para entrada de alunos neste momento.' });
  }

  const microfoneLiberado = req.body?.microfone_liberado !== false;
  const cameraLiberada = req.body?.camera_liberada !== false;
  const telaLiberada = req.body?.tela_liberada !== false;

  await pool.query(
    `
    INSERT INTO aula_participantes
      (aula_id, usuario_id, papel_na_aula, entrou_em, microfone_liberado, camera_liberada, tela_liberada, criado_em)
    VALUES
      ($1, $2, $3, NOW(), $4, $5, $6, NOW())
    ON CONFLICT (aula_id, usuario_id)
    DO UPDATE SET
      papel_na_aula = EXCLUDED.papel_na_aula,
      entrou_em = NOW(),
      saiu_em = NULL,
      microfone_liberado = EXCLUDED.microfone_liberado,
      camera_liberada = EXCLUDED.camera_liberada,
      tela_liberada = EXCLUDED.tela_liberada
    `,
    [aulaId, req.userId, papelNaAula, microfoneLiberado, cameraLiberada, telaLiberada]
  );

  if (['admin', 'professor'].includes(req.user.tipo_usuario) && ['agendada', 'aprovada'].includes(aula.status)) {
    await pool.query(
      `
      UPDATE aulas_ao_vivo
      SET status = 'ao_vivo',
          inicio_real = COALESCE(inicio_real, NOW()),
          atualizado_em = NOW()
      WHERE id = $1
      `,
      [aulaId]
    );
  }

  await logAudit(req, 'entrar_sala_ao_vivo', 'live', 'aulas_ao_vivo', aulaId, { papel_na_aula: papelNaAula });

  res.json({
    ok: true,
    sala: {
      id: aula.id,
      titulo: aula.titulo,
      status: aula.status,
      link_sala: aula.link_sala,
      provedor_sala: aula.provedor_sala,
      sala_externa_id: aula.sala_externa_id
    },
    permissao: {
      papel: papelNaAula,
      pode_controlar_midias: ['professor', 'admin', 'ti'].includes(papelNaAula),
      pode_gravar: ['professor', 'admin'].includes(req.user.tipo_usuario)
    }
  });
});

app.post('/live/salas/:id/encerrar', auth, requireProfessorOrAdmin, async (req, res) => {
  const aulaId = Number(req.params.id);
  const tituloGravacao = String(req.body?.titulo || '').trim() || null;
  const descricaoGravacao = String(req.body?.descricao || '').trim() || null;
  const arquivoUrl = String(req.body?.arquivo_url || '').trim() || null;

  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da sala invalido.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT id, professor_id, inicio_real, titulo, descricao
    FROM aulas_ao_vivo
    WHERE id = $1
    `,
    [aulaId]
  );
  const aula = aulaResult.rows[0];

  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  if (req.user.tipo_usuario === 'professor' && Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para encerrar esta aula.' });
  }

  const fimReal = new Date();
  const inicioReal = aula.inicio_real ? new Date(aula.inicio_real) : null;
  const duracaoSegundos = inicioReal
    ? Math.max(0, Math.floor((fimReal.getTime() - inicioReal.getTime()) / 1000))
    : null;

  await pool.query(
    `
    UPDATE aulas_ao_vivo
    SET status = 'realizada',
        fim_real = $1,
        duracao_segundos = $2,
        atualizado_em = NOW()
    WHERE id = $3
    `,
    [fimReal, duracaoSegundos, aulaId]
  );

  const gravacaoResult = await pool.query('SELECT id FROM aula_gravacoes WHERE aula_id = $1', [aulaId]);
  if (!gravacaoResult.rows.length) {
    await pool.query(
      `
      INSERT INTO aula_gravacoes
        (aula_id, arquivo_url, titulo, descricao, inicio_real, fim_real, duracao_segundos, status_legenda, criado_em)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
      `,
      [
        aulaId,
        arquivoUrl,
        tituloGravacao || aula.titulo,
        descricaoGravacao || aula.descricao,
        inicioReal,
        fimReal,
        duracaoSegundos
      ]
    );
  } else {
    await pool.query(
      `
      UPDATE aula_gravacoes
      SET
        arquivo_url = COALESCE($1, arquivo_url),
        titulo = COALESCE($2, titulo),
        descricao = COALESCE($3, descricao),
        inicio_real = COALESCE($4, inicio_real),
        fim_real = $5,
        duracao_segundos = $6
      WHERE aula_id = $7
      `,
      [
        arquivoUrl,
        tituloGravacao,
        descricaoGravacao,
        inicioReal,
        fimReal,
        duracaoSegundos,
        aulaId
      ]
    );
  }

  await logAudit(req, 'encerrar_aula_ao_vivo', 'live', 'aulas_ao_vivo', aulaId, { duracao_segundos: duracaoSegundos });
  res.json({ ok: true, aula_id: aulaId, duracao_segundos: duracaoSegundos });
});

app.get('/live/salas/:id/gravacoes', auth, async (req, res) => {
  const aulaId = Number(req.params.id);
  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da sala invalido.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT id, turma_id, professor_id, status, conteudo_aprovado
    FROM aulas_ao_vivo
    WHERE id = $1
    `,
    [aulaId]
  );
  const aula = aulaResult.rows[0];

  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }

  if (req.user.tipo_usuario === 'professor' && Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a esta aula.' });
  }

  if (req.user.tipo_usuario === 'aluno') {
    const matricula = await pool.query(
      `
      SELECT id
      FROM alunos_turmas
      WHERE aluno_id = $1
        AND turma_id = $2
        AND status = 'ativo'
      `,
      [req.userId, aula.turma_id]
    );
    if (!matricula.rows.length) {
      return res.status(403).json({ erro: 'Aluno nao matriculado nesta turma.' });
    }
  }

  const { rows } = await pool.query(
    `
    SELECT
      g.id,
      g.aula_id,
      g.arquivo_url,
      g.titulo,
      g.descricao,
      g.inicio_real,
      g.fim_real,
      g.duracao_segundos,
      g.status_legenda,
      l.status AS legenda_status,
      l.texto_revisado
    FROM aula_gravacoes g
    LEFT JOIN aula_legendas l ON l.aula_id = g.aula_id
    WHERE g.aula_id = $1
    ORDER BY g.criado_em DESC
    `,
    [aulaId]
  );

  res.json({
    aula: {
      id: aula.id,
      status: aula.status,
      conteudo_aprovado: aula.conteudo_aprovado
    },
    gravacoes: rows
  });
});

app.get('/live/salas/:id/gravações', auth, (req, res) => {
  res.redirect(307, `/live/salas/${req.params.id}/gravacoes`);
});

app.post('/live/salas/:id/presencas', auth, requireProfessorOrAdmin, async (req, res) => {
  const aulaId = Number(req.params.id);
  const presencas = Array.isArray(req.body?.presencas) ? req.body.presencas : [];

  if (!aulaId || !presencas.length) {
    return res.status(400).json({ erro: 'aula e presencas sao obrigatorios.' });
  }

  const aulaResult = await pool.query('SELECT id, professor_id FROM aulas_ao_vivo WHERE id = $1', [aulaId]);
  const aula = aulaResult.rows[0];
  if (!aula) {
    return res.status(404).json({ erro: 'Sala nao encontrada.' });
  }
  if (req.user.tipo_usuario === 'professor' && Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para lancar presencas nesta aula.' });
  }

  const allowedStatus = ['presente', 'falta', 'justificada', 'abonada'];
  let processed = 0;

  for (const item of presencas) {
    const alunoId = Number(item?.aluno_id);
    const status = String(item?.presenca_status || '').trim().toLowerCase();
    const motivo = String(item?.motivo || '').trim() || null;

    if (!alunoId || !allowedStatus.includes(status)) {
      continue;
    }

    await pool.query(
      `
      INSERT INTO aula_presencas (aula_id, aluno_id, presenca_status, computado_por_id, motivo, criado_em, atualizado_em)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (aula_id, aluno_id)
      DO UPDATE SET
        presenca_status = EXCLUDED.presenca_status,
        computado_por_id = EXCLUDED.computado_por_id,
        motivo = EXCLUDED.motivo,
        atualizado_em = NOW()
      `,
      [aulaId, alunoId, status, req.userId, motivo]
    );
    processed += 1;
  }

  await logAudit(req, 'registrar_presencas', 'live', 'aula_presencas', aulaId, { total_processado: processed });
  res.json({ ok: true, processados: processed });
});

app.post('/aluno/faltas/:id/justificar', auth, requireAluno, async (req, res) => {
  const presencaId = Number(req.params.id);
  const tipoJustificativa = String(req.body?.tipo_justificativa || '').trim().toLowerCase();
  const textoMotivo = String(req.body?.texto_motivo || '').trim() || null;
  const atestadoUrl = String(req.body?.atestado_url || '').trim() || null;

  if (!presencaId || !['atestado', 'motivo', 'ambos'].includes(tipoJustificativa)) {
    return res.status(400).json({ erro: 'Presenca e tipo_justificativa valido sao obrigatorios.' });
  }

  const presencaResult = await pool.query(
    `
    SELECT id, aluno_id, presenca_status
    FROM aula_presencas
    WHERE id = $1
    `,
    [presencaId]
  );
  const presenca = presencaResult.rows[0];

  if (!presenca || Number(presenca.aluno_id) !== req.userId) {
    return res.status(404).json({ erro: 'Registro de falta nao encontrado para este aluno.' });
  }

  if (presenca.presenca_status !== 'falta') {
    return res.status(400).json({ erro: 'Somente faltas podem ser justificadas.' });
  }

  if ((tipoJustificativa === 'motivo' || tipoJustificativa === 'ambos') && !textoMotivo) {
    return res.status(400).json({ erro: 'texto_motivo obrigatorio para este tipo de justificativa.' });
  }
  if ((tipoJustificativa === 'atestado' || tipoJustificativa === 'ambos') && !atestadoUrl) {
    return res.status(400).json({ erro: 'atestado_url obrigatorio para este tipo de justificativa.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO faltas_justificativas
      (presenca_id, aluno_id, tipo_justificativa, texto_motivo, atestado_url, status, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, 'pendente', NOW(), NOW())
    RETURNING *
    `,
    [presencaId, req.userId, tipoJustificativa, textoMotivo, atestadoUrl]
  );

  await logAudit(req, 'justificar_falta', 'academico', 'faltas_justificativas', rows[0].id, { tipo_justificativa: tipoJustificativa });
  res.status(201).json(rows[0]);
});

app.post('/professor/faltas/:id/aprovar', auth, requireProfessor, async (req, res) => {
  const justificativaId = Number(req.params.id);
  const decisao = String(req.body?.decisao || 'aprovado').trim().toLowerCase();
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!justificativaId || !['aprovado', 'reprovado'].includes(decisao)) {
    return res.status(400).json({ erro: 'justificativa e decisao validas sao obrigatorias.' });
  }

  const justificativaResult = await pool.query(
    `
    SELECT
      fj.id,
      fj.presenca_id,
      ap.aula_id,
      a.professor_id
    FROM faltas_justificativas fj
    JOIN aula_presencas ap ON ap.id = fj.presenca_id
    JOIN aulas_ao_vivo a ON a.id = ap.aula_id
    WHERE fj.id = $1
    `,
    [justificativaId]
  );
  const justificativa = justificativaResult.rows[0];

  if (!justificativa) {
    return res.status(404).json({ erro: 'Justificativa nao encontrada.' });
  }
  if (Number(justificativa.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para esta justificativa.' });
  }

  await pool.query(
    `
    INSERT INTO faltas_aprovacoes (justificativa_id, aprovador_id, papel_aprovador, decisao, comentario, criado_em)
    VALUES ($1, $2, 'professor', $3, $4, NOW())
    ON CONFLICT (justificativa_id, papel_aprovador)
    DO UPDATE SET
      aprovador_id = EXCLUDED.aprovador_id,
      decisao = EXCLUDED.decisao,
      comentario = EXCLUDED.comentario,
      criado_em = NOW()
    `,
    [justificativaId, req.userId, decisao, comentario]
  );

  if (decisao === 'reprovado') {
    await pool.query(
      `
      UPDATE faltas_justificativas
      SET status = 'reprovado', atualizado_em = NOW()
      WHERE id = $1
      `,
      [justificativaId]
    );
    await logAudit(req, 'reprovar_justificativa_falta_professor', 'academico', 'faltas_justificativas', justificativaId, {});
    return res.json({ ok: true, status: 'reprovado' });
  }

  const aprovacoes = await pool.query(
    `
    SELECT papel_aprovador, decisao
    FROM faltas_aprovacoes
    WHERE justificativa_id = $1
    `,
    [justificativaId]
  );

  const professorAprovou = aprovacoes.rows.some((a) => a.papel_aprovador === 'professor' && a.decisao === 'aprovado');
  const adminAprovou = aprovacoes.rows.some((a) => a.papel_aprovador === 'admin' && a.decisao === 'aprovado');
  const status = professorAprovou && adminAprovou ? 'aprovado_duplo' : 'em_analise';

  await pool.query(
    `
    UPDATE faltas_justificativas
    SET status = $1, atualizado_em = NOW()
    WHERE id = $2
    `,
    [status, justificativaId]
  );

  await logAudit(req, 'aprovar_justificativa_falta_professor', 'academico', 'faltas_justificativas', justificativaId, { status });
  res.json({ ok: true, status });
});

app.post('/admin/faltas/:id/aprovar', auth, requireAdmin, async (req, res) => {
  const justificativaId = Number(req.params.id);
  const decisao = String(req.body?.decisao || 'aprovado').trim().toLowerCase();
  const comentario = String(req.body?.comentario || '').trim() || null;

  if (!justificativaId || !['aprovado', 'reprovado'].includes(decisao)) {
    return res.status(400).json({ erro: 'justificativa e decisao validas sao obrigatorias.' });
  }

  const justificativaResult = await pool.query(
    `
    SELECT id
    FROM faltas_justificativas
    WHERE id = $1
    `,
    [justificativaId]
  );
  const justificativa = justificativaResult.rows[0];

  if (!justificativa) {
    return res.status(404).json({ erro: 'Justificativa nao encontrada.' });
  }

  await pool.query(
    `
    INSERT INTO faltas_aprovacoes (justificativa_id, aprovador_id, papel_aprovador, decisao, comentario, criado_em)
    VALUES ($1, $2, 'admin', $3, $4, NOW())
    ON CONFLICT (justificativa_id, papel_aprovador)
    DO UPDATE SET
      aprovador_id = EXCLUDED.aprovador_id,
      decisao = EXCLUDED.decisao,
      comentario = EXCLUDED.comentario,
      criado_em = NOW()
    `,
    [justificativaId, req.userId, decisao, comentario]
  );

  if (decisao === 'reprovado') {
    await pool.query(
      `
      UPDATE faltas_justificativas
      SET status = 'reprovado', atualizado_em = NOW()
      WHERE id = $1
      `,
      [justificativaId]
    );
    await logAudit(req, 'reprovar_justificativa_falta_admin', 'academico', 'faltas_justificativas', justificativaId, {});
    return res.json({ ok: true, status: 'reprovado' });
  }

  const aprovacoes = await pool.query(
    `
    SELECT papel_aprovador, decisao
    FROM faltas_aprovacoes
    WHERE justificativa_id = $1
    `,
    [justificativaId]
  );

  const professorAprovou = aprovacoes.rows.some((a) => a.papel_aprovador === 'professor' && a.decisao === 'aprovado');
  const adminAprovou = aprovacoes.rows.some((a) => a.papel_aprovador === 'admin' && a.decisao === 'aprovado');
  const status = professorAprovou && adminAprovou ? 'aprovado_duplo' : 'em_analise';

  await pool.query(
    `
    UPDATE faltas_justificativas
    SET status = $1, atualizado_em = NOW()
    WHERE id = $2
    `,
    [status, justificativaId]
  );

  await logAudit(req, 'aprovar_justificativa_falta_admin', 'academico', 'faltas_justificativas', justificativaId, { status });
  res.json({ ok: true, status });
});

app.get('/professor/faltas/pendentes', auth, requireProfessor, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      fj.id AS justificativa_id,
      fj.status AS justificativa_status,
      fj.tipo_justificativa,
      fj.texto_motivo,
      fj.atestado_url,
      fj.criado_em AS justificativa_criada_em,
      ap.id AS presenca_id,
      ap.presenca_status,
      a.id AS aula_id,
      a.titulo AS aula_titulo,
      m.nome AS materia_nome,
      t.nome AS turma_nome,
      aluno.id AS aluno_id,
      aluno.nome AS aluno_nome,
      aluno.email AS aluno_email
    FROM faltas_justificativas fj
    JOIN aula_presencas ap ON ap.id = fj.presenca_id
    JOIN aulas_ao_vivo a ON a.id = ap.aula_id
    LEFT JOIN materias m ON m.id = a.materia_id
    LEFT JOIN turmas t ON t.id = a.turma_id
    JOIN usuarios aluno ON aluno.id = fj.aluno_id
    WHERE a.professor_id = $1
      AND fj.status IN ('pendente', 'em_analise')
    ORDER BY fj.criado_em DESC
    LIMIT 300
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/admin/faltas/pendentes', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      fj.id AS justificativa_id,
      fj.status AS justificativa_status,
      fj.tipo_justificativa,
      fj.texto_motivo,
      fj.atestado_url,
      fj.criado_em AS justificativa_criada_em,
      ap.id AS presenca_id,
      ap.presenca_status,
      a.id AS aula_id,
      a.titulo AS aula_titulo,
      professor.nome AS professor_nome,
      m.nome AS materia_nome,
      t.nome AS turma_nome,
      aluno.id AS aluno_id,
      aluno.nome AS aluno_nome,
      aluno.email AS aluno_email
    FROM faltas_justificativas fj
    JOIN aula_presencas ap ON ap.id = fj.presenca_id
    JOIN aulas_ao_vivo a ON a.id = ap.aula_id
    LEFT JOIN usuarios professor ON professor.id = a.professor_id
    LEFT JOIN materias m ON m.id = a.materia_id
    LEFT JOIN turmas t ON t.id = a.turma_id
    JOIN usuarios aluno ON aluno.id = fj.aluno_id
    WHERE fj.status IN ('pendente', 'em_analise')
    ORDER BY fj.criado_em DESC
    LIMIT 500
    `
  );

  res.json(rows);
});

app.get('/admin/presencas/export.csv', auth, requireAdmin, async (req, res) => {
  const turmaId = req.query?.turma_id ? Number(req.query.turma_id) : null;
  const turmaClause = turmaId ? 'AND t.id = $1' : '';
  const params = turmaId ? [turmaId] : [];

  const { rows } = await pool.query(
    `
    SELECT
      t.nome AS turma_nome,
      aluno.nome AS aluno_nome,
      aluno.email AS aluno_email,
      COALESCE(i.ra_codigo, '') AS ra_codigo,
      ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY aluno.nome) AS numero_lista,
      COUNT(ap.id) FILTER (WHERE ap.presenca_status IN ('presente', 'abonada', 'justificada'))::INT AS presencas_validas,
      COUNT(ap.id) FILTER (WHERE ap.presenca_status = 'falta')::INT AS faltas
    FROM alunos_turmas at
    JOIN turmas t ON t.id = at.turma_id
    JOIN usuarios aluno ON aluno.id = at.aluno_id
    LEFT JOIN inscricoes i ON i.email = aluno.email
    LEFT JOIN aulas_ao_vivo a ON a.turma_id = t.id
    LEFT JOIN aula_presencas ap ON ap.aula_id = a.id AND ap.aluno_id = aluno.id
    WHERE at.status = 'ativo'
      ${turmaClause}
    GROUP BY t.id, t.nome, aluno.id, aluno.nome, aluno.email, i.ra_codigo
    ORDER BY t.nome ASC, numero_lista ASC
    `,
    params
  );

  const csvHeader = 'turma,numero_lista,ra_codigo,aluno_nome,aluno_email,presencas_validas,faltas\n';
  const csvRows = rows
    .map((row) => [
      row.turma_nome,
      row.numero_lista,
      row.ra_codigo,
      row.aluno_nome,
      row.aluno_email,
      row.presencas_validas,
      row.faltas
    ])
    .map((fields) => fields.map((field) => `"${String(field || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="presencas-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`${csvHeader}${csvRows}\n`);
});

app.get('/aluno/faltas/minhas', auth, requireAluno, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      ap.id AS presenca_id,
      ap.presenca_status,
      ap.motivo AS motivo_falta,
      ap.criado_em,
      a.id AS aula_id,
      a.titulo AS aula_titulo,
      a.inicio_previsto,
      a.fim_previsto,
      m.id AS materia_id,
      m.nome AS materia_nome,
      t.id AS turma_id,
      t.nome AS turma_nome,
      fj.id AS justificativa_id,
      fj.tipo_justificativa,
      fj.status AS justificativa_status,
      fj.texto_motivo,
      fj.atestado_url,
      fj.atualizado_em AS justificativa_atualizada_em
    FROM aula_presencas ap
    JOIN aulas_ao_vivo a ON a.id = ap.aula_id
    LEFT JOIN materias m ON m.id = a.materia_id
    LEFT JOIN turmas t ON t.id = a.turma_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM faltas_justificativas fj2
      WHERE fj2.presenca_id = ap.id
      ORDER BY fj2.criado_em DESC
      LIMIT 1
    ) fj ON true
    WHERE ap.aluno_id = $1
      AND ap.presenca_status = 'falta'
    ORDER BY ap.atualizado_em DESC
    `,
    [req.userId]
  );

  res.json(rows);
});

app.get('/aluno/aulas/:id/replay', auth, requireAluno, async (req, res) => {
  const aulaId = Number(req.params.id);
  if (!aulaId) {
    return res.status(400).json({ erro: 'ID da aula invalido.' });
  }

  const result = await pool.query(
    `
    SELECT
      a.id AS aula_id,
      a.turma_id,
      a.titulo AS aula_titulo,
      a.status AS aula_status,
      a.conteudo_aprovado,
      g.id AS gravacao_id,
      g.arquivo_url,
      g.titulo AS gravacao_titulo,
      g.descricao AS gravacao_descricao,
      g.duracao_segundos,
      ap.id AS presenca_id,
      ap.presenca_status,
      fj.status AS justificativa_status,
      rp.progresso_percent,
      rp.ultimo_segundo,
      rp.assistido_completo,
      rp.bloqueado_por_seek
    FROM aulas_ao_vivo a
    JOIN alunos_turmas at
      ON at.turma_id = a.turma_id
      AND at.aluno_id = $2
      AND at.status = 'ativo'
    LEFT JOIN aula_gravacoes g ON g.aula_id = a.id
    LEFT JOIN aula_presencas ap
      ON ap.aula_id = a.id
      AND ap.aluno_id = $2
    LEFT JOIN LATERAL (
      SELECT status
      FROM faltas_justificativas
      WHERE presenca_id = ap.id
      ORDER BY criado_em DESC
      LIMIT 1
    ) fj ON true
    LEFT JOIN aula_replay_progresso rp
      ON rp.aula_id = a.id
      AND rp.aluno_id = $2
    WHERE a.id = $1
    LIMIT 1
    `,
    [aulaId, req.userId]
  );

  const aula = result.rows[0];
  if (!aula) {
    return res.status(404).json({ erro: 'Aula nao encontrada para este aluno.' });
  }

  if (!aula.gravacao_id || !aula.conteudo_aprovado) {
    return res.status(403).json({ erro: 'Replay ainda indisponivel. Aguardando publicacao oficial.' });
  }

  if (aula.presenca_status === 'falta' && aula.justificativa_status !== 'aprovado_duplo') {
    return res.status(403).json({
      erro: 'Aula bloqueada por falta. Envie justificativa e aguarde dupla aprovacao.',
      bloquear_feed: true
    });
  }

  res.json({
    aula: {
      id: aula.aula_id,
      titulo: aula.aula_titulo,
      status: aula.aula_status
    },
    gravacao: {
      id: aula.gravacao_id,
      url: aula.arquivo_url,
      titulo: aula.gravacao_titulo,
      descricao: aula.gravacao_descricao,
      duracao_segundos: aula.duracao_segundos
    },
    player_restrito: {
      permitir_seek_forward: false,
      velocidades_permitidas: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5],
      controles: ['volume', 'velocidade', 'legenda']
    },
    progresso: {
      percentual: Number(aula.progresso_percent || 0),
      ultimo_segundo: Number(aula.ultimo_segundo || 0),
      assistido_completo: Boolean(aula.assistido_completo),
      bloqueado_por_seek: Boolean(aula.bloqueado_por_seek)
    }
  });
});

app.post('/aluno/aulas/:id/progresso', auth, requireAluno, async (req, res) => {
  const aulaId = Number(req.params.id);
  const ultimoSegundo = Number(req.body?.ultimo_segundo);
  const duracaoSegundos = Number(req.body?.duracao_segundos);
  const velocidadeAtual = Number(req.body?.velocidade_atual ?? 1);

  if (!aulaId || Number.isNaN(ultimoSegundo) || Number.isNaN(duracaoSegundos) || duracaoSegundos <= 0) {
    return res.status(400).json({ erro: 'Dados de progresso invalidos.' });
  }

  const velocidadesPermitidas = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];
  if (!velocidadesPermitidas.includes(velocidadeAtual)) {
    return res.status(400).json({ erro: 'Velocidade invalida para replay restrito.' });
  }

  const aulaResult = await pool.query(
    `
    SELECT
      a.id,
      a.turma_id,
      a.conteudo_aprovado,
      g.id AS gravacao_id,
      ap.id AS presenca_id,
      ap.presenca_status,
      fj.status AS justificativa_status
    FROM aulas_ao_vivo a
    JOIN alunos_turmas at
      ON at.turma_id = a.turma_id
      AND at.aluno_id = $2
      AND at.status = 'ativo'
    LEFT JOIN aula_gravacoes g ON g.aula_id = a.id
    LEFT JOIN aula_presencas ap
      ON ap.aula_id = a.id
      AND ap.aluno_id = $2
    LEFT JOIN LATERAL (
      SELECT status
      FROM faltas_justificativas
      WHERE presenca_id = ap.id
      ORDER BY criado_em DESC
      LIMIT 1
    ) fj ON true
    WHERE a.id = $1
    `,
    [aulaId, req.userId]
  );
  const aula = aulaResult.rows[0];

  if (!aula || !aula.gravacao_id || !aula.conteudo_aprovado) {
    return res.status(403).json({ erro: 'Replay indisponivel para registrar progresso.' });
  }

  if (aula.presenca_status === 'falta' && aula.justificativa_status !== 'aprovado_duplo') {
    return res.status(403).json({ erro: 'Replay bloqueado ate a dupla aprovacao da justificativa.' });
  }

  const existingResult = await pool.query(
    `
    SELECT ultimo_segundo
    FROM aula_replay_progresso
    WHERE aula_id = $1
      AND aluno_id = $2
    `,
    [aulaId, req.userId]
  );
  const currentSecond = Number(existingResult.rows?.[0]?.ultimo_segundo || 0);

  if (ultimoSegundo > currentSecond + 15) {
    await pool.query(
      `
      INSERT INTO aula_replay_progresso
        (aula_id, aluno_id, progresso_percent, ultimo_segundo, assistido_completo, bloqueado_por_seek, velocidade_atual, atualizado_em)
      VALUES
        ($1, $2, 0, $3, false, true, $4, NOW())
      ON CONFLICT (aula_id, aluno_id)
      DO UPDATE SET
        bloqueado_por_seek = true,
        velocidade_atual = EXCLUDED.velocidade_atual,
        atualizado_em = NOW()
      `,
      [aulaId, req.userId, currentSecond, velocidadeAtual]
    );
    return res.status(400).json({ erro: 'Avanco detectado. O replay restrito nao permite seek forward.' });
  }

  const safeSecond = Math.max(0, Math.min(ultimoSegundo, duracaoSegundos));
  const progressoPercent = Number(((safeSecond / duracaoSegundos) * 100).toFixed(2));
  const assistidoCompleto = progressoPercent >= 100;

  await pool.query(
    `
    INSERT INTO aula_replay_progresso
      (aula_id, aluno_id, progresso_percent, ultimo_segundo, assistido_completo, bloqueado_por_seek, velocidade_atual, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, false, $6, NOW())
    ON CONFLICT (aula_id, aluno_id)
    DO UPDATE SET
      progresso_percent = EXCLUDED.progresso_percent,
      ultimo_segundo = EXCLUDED.ultimo_segundo,
      assistido_completo = EXCLUDED.assistido_completo,
      velocidade_atual = EXCLUDED.velocidade_atual,
      atualizado_em = NOW()
    `,
    [aulaId, req.userId, progressoPercent, safeSecond, assistidoCompleto, velocidadeAtual]
  );

  if (assistidoCompleto && aula.presenca_status === 'falta' && aula.justificativa_status === 'aprovado_duplo' && aula.presenca_id) {
    await pool.query(
      `
      UPDATE aula_presencas
      SET presenca_status = 'justificada', atualizado_em = NOW()
      WHERE id = $1
      `,
      [aula.presenca_id]
    );
  }

  await logAudit(req, 'atualizar_replay_progresso', 'live', 'aula_replay_progresso', aulaId, {
    progresso_percent: progressoPercent,
    assistido_completo: assistidoCompleto
  });

  res.json({
    ok: true,
    progresso_percent: progressoPercent,
    ultimo_segundo: safeSecond,
    assistido_completo: assistidoCompleto
  });
});

app.post('/professor/aulas/:id/legendas/aprovar', auth, requireProfessor, async (req, res) => {
  const aulaId = Number(req.params.id);
  const status = String(req.body?.status || 'aprovada').trim().toLowerCase();
  const textoRevisado = String(req.body?.texto_revisado || '').trim() || null;

  if (!aulaId || !['aprovada', 'reprovada'].includes(status)) {
    return res.status(400).json({ erro: 'aula e status validos sao obrigatorios.' });
  }

  const aulaResult = await pool.query('SELECT id, professor_id FROM aulas_ao_vivo WHERE id = $1', [aulaId]);
  const aula = aulaResult.rows[0];
  if (!aula) {
    return res.status(404).json({ erro: 'Aula nao encontrada.' });
  }
  if (Number(aula.professor_id) !== req.userId) {
    return res.status(403).json({ erro: 'Professor sem permissao para aprovar legenda desta aula.' });
  }

  await pool.query(
    `
    INSERT INTO aula_legendas
      (aula_id, texto_transcrito, texto_revisado, status, aprovado_por_id, aprovado_em, criado_em, atualizado_em)
    VALUES
      ($1, NULL, $2, $3, $4, NOW(), NOW(), NOW())
    ON CONFLICT (aula_id)
    DO UPDATE SET
      texto_revisado = EXCLUDED.texto_revisado,
      status = EXCLUDED.status,
      aprovado_por_id = EXCLUDED.aprovado_por_id,
      aprovado_em = NOW(),
      atualizado_em = NOW()
    `,
    [aulaId, textoRevisado, status, req.userId]
  );

  await pool.query(
    `
    UPDATE aula_gravacoes
    SET
      status_legenda = $1,
      legenda_texto = $2,
      legenda_aprovada_por_id = $3,
      legenda_aprovada_em = NOW()
    WHERE aula_id = $4
    `,
    [status, textoRevisado, req.userId, aulaId]
  );

  await logAudit(req, 'aprovar_legenda_aula', 'live', 'aula_legendas', aulaId, { status });
  res.json({ ok: true, aula_id: aulaId, status });
});

app.post('/loja/carrinho', auth, async (req, res) => {
  const produtoId = req.body?.produto_id ? Number(req.body.produto_id) : null;
  const tipoItem = String(req.body?.tipo_item || (produtoId ? 'produto' : 'servico')).trim().toLowerCase();
  const quantidade = Math.max(1, Number(req.body?.quantidade || 1));
  const descricaoServico = String(req.body?.descricao_servico || '').trim() || null;
  const precoUnitarioBody = req.body?.preco_unitario !== undefined ? Number(req.body.preco_unitario) : null;

  if (!['produto', 'servico'].includes(tipoItem)) {
    return res.status(400).json({ erro: 'tipo_item deve ser produto ou servico.' });
  }

  let precoUnitario = 0;
  let produto = null;
  if (tipoItem === 'produto') {
    if (!produtoId) {
      return res.status(400).json({ erro: 'produto_id obrigatorio para item de produto.' });
    }

    const produtoResult = await pool.query('SELECT id, nome, preco, ativo FROM produtos WHERE id = $1', [produtoId]);
    produto = produtoResult.rows[0];
    if (!produto || !produto.ativo) {
      return res.status(404).json({ erro: 'Produto nao encontrado ou inativo.' });
    }
    precoUnitario = Number(produto.preco || 0);
  } else {
    if (precoUnitarioBody === null || Number.isNaN(precoUnitarioBody) || precoUnitarioBody < 0) {
      return res.status(400).json({ erro: 'preco_unitario valido obrigatorio para servico.' });
    }
    precoUnitario = precoUnitarioBody;
  }

  let cartResult = await pool.query(
    `
    SELECT id
    FROM carrinhos
    WHERE usuario_id = $1
      AND status = 'aberto'
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [req.userId]
  );

  let cartId;
  if (!cartResult.rows.length) {
    const newCart = await pool.query(
      `
      INSERT INTO carrinhos (usuario_id, status, moeda, criado_em, atualizado_em)
      VALUES ($1, 'aberto', 'BRL', NOW(), NOW())
      RETURNING id
      `,
      [req.userId]
    );
    cartId = newCart.rows[0].id;
  } else {
    cartId = cartResult.rows[0].id;
  }

  const itemResult = await pool.query(
    `
    INSERT INTO carrinho_itens
      (carrinho_id, produto_id, tipo_item, quantidade, preco_unitario, descricao_servico, criado_em)
    VALUES
      ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *
    `,
    [cartId, produtoId, tipoItem, quantidade, precoUnitario, descricaoServico]
  );

  await pool.query('UPDATE carrinhos SET atualizado_em = NOW() WHERE id = $1', [cartId]);
  await logAudit(req, 'adicionar_item_carrinho', 'loja', 'carrinho_itens', itemResult.rows[0].id, {
    carrinho_id: cartId,
    tipo_item: tipoItem
  });

  res.status(201).json({
    ok: true,
    carrinho_id: cartId,
    item: itemResult.rows[0],
    produto_nome: produto?.nome || null
  });
});

app.post('/loja/checkout', auth, async (req, res) => {
  const metodoPagamento = String(req.body?.metodo_pagamento || 'pix').trim().toLowerCase();
  const processingMode = String(req.body?.processing_mode || 'manual').trim().toLowerCase();
  const payerEmail = String(req.body?.payer?.email || req.user?.email || '').trim().toLowerCase();
  const paymentMethodId = toNullableTrimmedString(req.body?.payment_method_id);
  const paymentMethodType = toNullableTrimmedString(req.body?.payment_method_type);
  const paymentToken = toNullableTrimmedString(req.body?.payment_token);
  const installments = Number(req.body?.installments || 1);
  const dataAgendada = req.body?.data_pagamento_agendada ? new Date(req.body.data_pagamento_agendada) : null;
  const enderecoEntrega = req.body?.endereco_entrega || {};
  const tipoFrete = String(req.body?.tipo_frete || '').trim() || null;
  const servicoFrete = String(req.body?.servico_frete || '').trim() || null;

  if (!['manual', 'automatic'].includes(processingMode)) {
    return res.status(400).json({ erro: "processing_mode deve ser 'manual' ou 'automatic'." });
  }

  if (dataAgendada && Number.isNaN(dataAgendada.getTime())) {
    return res.status(400).json({ erro: 'data_pagamento_agendada invalida.' });
  }

  if (processingMode === 'automatic') {
    if (!payerEmail) {
      return res.status(400).json({ erro: 'payer.email obrigatorio para processing_mode automatic.' });
    }
    if (!paymentMethodId || !paymentMethodType) {
      return res.status(400).json({
        erro: 'payment_method_id e payment_method_type sao obrigatorios para processing_mode automatic.'
      });
    }
    if (!Number.isInteger(installments) || installments < 1) {
      return res.status(400).json({ erro: 'installments invalido. Use inteiro >= 1.' });
    }
  }

  const client = await pool.connect();
  try {
    const orderClient = requireMercadoPagoOrderClient();
    await client.query('BEGIN');

    const cartResult = await client.query(
      `
      SELECT id
      FROM carrinhos
      WHERE usuario_id = $1
        AND status = 'aberto'
      ORDER BY criado_em DESC
      LIMIT 1
      FOR UPDATE
      `,
      [req.userId]
    );
    const cart = cartResult.rows[0];

    if (!cart) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Nao ha carrinho aberto para checkout.' });
    }

    const itensResult = await client.query(
      `
      SELECT
        ci.id,
        ci.quantidade,
        ci.preco_unitario,
        ci.tipo_item,
        ci.descricao_servico,
        p.nome AS produto_nome
      FROM carrinho_itens ci
      LEFT JOIN produtos p ON p.id = ci.produto_id
      WHERE carrinho_id = $1
      `,
      [cart.id]
    );
    const itens = itensResult.rows;
    if (!itens.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Carrinho vazio.' });
    }

    const total = Number(
      itens.reduce((acc, item) => acc + Number(item.quantidade || 0) * Number(item.preco_unitario || 0), 0).toFixed(2)
    );
    const totalAmount = toAmountString(total);

    const pedidoResult = await client.query(
      `
      INSERT INTO pedidos (usuario_id, total, status, data_pedido)
      VALUES ($1, $2, 'pendente', NOW())
      RETURNING *
      `,
      [req.userId, total]
    );
    const pedido = pedidoResult.rows[0];

    await client.query(
      `
      UPDATE carrinhos
      SET status = 'fechado', atualizado_em = NOW()
      WHERE id = $1
      `,
      [cart.id]
    );

    await client.query(
      `
      INSERT INTO pedidos_entrega
        (pedido_id, tipo_frete, servico_frete, endereco_json, status_entrega, atualizado_em)
      VALUES
        ($1, $2, $3, $4::jsonb, 'preparando', NOW())
      `,
      [pedido.id, tipoFrete, servicoFrete, JSON.stringify(enderecoEntrega || {})]
    );

    const idempotencyKey = createIdempotencyKey();
    const hashReferencia = crypto.randomBytes(12).toString('hex');
    const transacaoResult = await client.query(
      `
      INSERT INTO pagamentos_transacoes
        (
          pedido_id,
          usuario_id,
          metodo,
          status,
          valor,
          moeda,
          data_pagamento_agendada,
          hash_referencia,
          idempotency_key,
          detalhes_gateway,
          ultima_atualizacao_gateway,
          criado_em,
          atualizado_em
        )
      VALUES
        ($1, $2, $3, 'pendente', $4, 'BRL', $5, $6, $7, '{}'::jsonb, NOW(), NOW(), NOW())
      RETURNING *
      `,
      [pedido.id, req.userId, metodoPagamento, total, dataAgendada, hashReferencia, idempotencyKey]
    );
    const transacao = transacaoResult.rows[0];

    const itemsPayload = itens.map((item) => ({
      title: item.produto_nome || item.descricao_servico || `Item ${item.id}`,
      quantity: Number(item.quantidade || 1),
      unit_price: toAmountString(item.preco_unitario || 0)
    }));

    const orderBody = {
      type: 'online',
      processing_mode: processingMode,
      total_amount: totalAmount,
      external_reference: `pedido_${pedido.id}`,
      description: `Pedido #${pedido.id} - Loja/Escola Ordo Caoti`,
      currency: 'BRL',
      items: itemsPayload,
      config: {
        online: {
          success_url: `${FRONTEND_PUBLIC_BASE_URL}/compra-aprovada.html`,
          pending_url: `${FRONTEND_PUBLIC_BASE_URL}/compra-aprovada.html`,
          failure_url: `${FRONTEND_PUBLIC_BASE_URL}/compra-recusada.html`
        }
      }
    };

    if (payerEmail) {
      orderBody.payer = { email: payerEmail };
    }

    if (processingMode === 'automatic') {
      const payment = {
        amount: totalAmount,
        payment_method: {
          id: paymentMethodId,
          type: paymentMethodType,
          installments
        }
      };

      if (paymentToken) {
        payment.payment_method.token = paymentToken;
      }

      orderBody.transactions = { payments: [payment] };
    }

    const mercadoOrder = await orderClient.create({
      body: orderBody,
      requestOptions: {
        idempotencyKey
      }
    });

    const mercadoOrderId = String(mercadoOrder?.id || '');
    const mercadoOrderStatus = String(mercadoOrder?.status || 'created').toLowerCase();
    const firstPayment = mercadoOrder?.transactions?.payments?.[0] || null;
    const mercadoTransactionId = firstPayment?.id ? String(firstPayment.id) : null;

    await client.query(
      `
      UPDATE pagamentos_transacoes
      SET
        status = $1,
        mercado_order_id = $2,
        mercado_transaction_id = $3,
        mercado_status = $4,
        detalhes_gateway = $5::jsonb,
        ultima_atualizacao_gateway = NOW(),
        atualizado_em = NOW()
      WHERE id = $6
      `,
      [
        normalizeOrderStatusToTransactionStatus(mercadoOrderStatus),
        mercadoOrderId || null,
        mercadoTransactionId,
        mercadoOrderStatus,
        JSON.stringify(mercadoOrder || {}),
        transacao.id
      ]
    );

    await client.query(
      `
      UPDATE pedidos
      SET
        status = $1,
        payment_id = $2,
        mercado_external_reference = $3
      WHERE id = $4
      `,
      [
        normalizeOrderStatusToPedidoStatus(mercadoOrderStatus),
        mercadoOrderId || null,
        `pedido_${pedido.id}`,
        pedido.id
      ]
    );

    await client.query('COMMIT');

    const pedidoStatusAtual = normalizeOrderStatusToPedidoStatus(mercadoOrderStatus);
    await upsertAssinaturaFromPedido({
      pedidoId: pedido.id,
      pedidoStatus: pedidoStatusAtual,
      valorMensal: total
    });

    await trySaveUniversalArchive({
      chave: `pedido:${pedido.id}:${Date.now()}`,
      tipoRecurso: 'loja',
      subtipo: 'checkout_orders_v2',
      payload: {
        pedido,
        carrinho_id: cart.id,
        itens,
        transacao,
        mercado_order: mercadoOrder,
        payment_method: metodoPagamento,
        processing_mode: processingMode,
        total
      },
      metadata: { origem: 'route:/loja/checkout' },
      userId: req.userId || null,
      bucket: SUPABASE_STORAGE_BUCKET || null,
      bucketPath: null
    });

    await logAudit(req, 'checkout_loja_orders_api_v2', 'loja', 'pedidos', pedido.id, {
      total,
      metodo_pagamento: metodoPagamento,
      processing_mode: processingMode,
      mercado_order_id: mercadoOrderId || null
    });

    res.status(201).json({
      ok: true,
      pedido_id: pedido.id,
      total,
      status: pedidoStatusAtual,
      mercado_pago: {
        order_id: mercadoOrderId || null,
        order_status: mercadoOrderStatus,
        order_status_detail: mercadoOrder?.status_detail || null,
        processing_mode: mercadoOrder?.processing_mode || processingMode,
        transaction_id: mercadoTransactionId,
        transaction_status: firstPayment?.status || null,
        payment_method: firstPayment?.payment_method || null,
        qr_code: firstPayment?.payment_method?.qr_code || null,
        qr_code_base64: firstPayment?.payment_method?.qr_code_base64 || null,
        ticket_url: firstPayment?.payment_method?.ticket_url || null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const safeError = sanitizeMercadoError(error);
    console.error(safeError);
    const status = safeError.status && Number(safeError.status) < 500 ? 422 : 502;
    res.status(status).json({
      erro: 'Falha ao finalizar checkout com Orders API.',
      detalhes_gateway: safeError
    });
  } finally {
    client.release();
  }
});

app.get('/loja/pedidos/:id', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query(
    `
    SELECT p.*
    FROM pedidos p
    WHERE p.id = $1
    `,
    [pedidoId]
  );
  const pedido = pedidoResult.rows[0];

  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const [entregaResult, transacoesResult, solicitacoesResult] = await Promise.all([
    pool.query('SELECT * FROM pedidos_entrega WHERE pedido_id = $1 ORDER BY id DESC LIMIT 1', [pedidoId]),
    pool.query('SELECT * FROM pagamentos_transacoes WHERE pedido_id = $1 ORDER BY criado_em DESC', [pedidoId]),
    pool.query('SELECT * FROM pedido_solicitacoes WHERE pedido_id = $1 ORDER BY criado_em DESC', [pedidoId])
  ]);

  res.json({
    pedido,
    entrega: entregaResult.rows[0] || null,
    transacoes: transacoesResult.rows,
    solicitacoes: solicitacoesResult.rows
  });
});

app.get('/loja/pedidos/:id/rastreio', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query('SELECT id, usuario_id FROM pedidos WHERE id = $1', [pedidoId]);
  const pedido = pedidoResult.rows[0];

  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const entregaResult = await pool.query(
    `
    SELECT codigo_rastreio, status_entrega, atualizado_em
    FROM pedidos_entrega
    WHERE pedido_id = $1
    ORDER BY id DESC
    LIMIT 1
    `,
    [pedidoId]
  );

  const entrega = entregaResult.rows[0];
  if (!entrega?.codigo_rastreio) {
    return res.status(404).json({ erro: 'Pedido sem codigo de rastreio vinculado.' });
  }

  try {
    const rastreio = await fetchCorreiosTracking(entrega.codigo_rastreio);
    return res.json({
      pedido_id: pedidoId,
      codigo_rastreio: entrega.codigo_rastreio,
      status_entrega: entrega.status_entrega,
      ultima_atualizacao_entrega: entrega.atualizado_em,
      rastreio
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    return res.status(statusCode).json({
      erro: 'Falha ao consultar rastreio do pedido.',
      detalhes: String(error?.message || 'Erro desconhecido')
    });
  }
});

app.get('/api/correios/rastreio/:codigo', auth, async (req, res) => {
  try {
    const rastreio = await fetchCorreiosTracking(req.params.codigo);
    return res.json({ ok: true, rastreio });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    return res.status(statusCode).json({
      ok: false,
      erro: 'Nao foi possivel consultar o rastreio.',
      detalhes: String(error?.message || 'Erro desconhecido')
    });
  }
});

app.get('/api/ops/resumo', auth, requireAdminOrTi, async (_req, res) => {
  async function safeCount(tableName) {
    try {
      const result = await pool.query(`SELECT COUNT(*)::int AS total FROM ${tableName}`);
      return result.rows[0]?.total || 0;
    } catch (_error) {
      return null;
    }
  }

  const [usuarios, produtos, pedidos, inscricoes] = await Promise.all([
    safeCount('usuarios'),
    safeCount('produtos'),
    safeCount('pedidos'),
    safeCount('inscricoes')
  ]);

  return res.json({
    ok: true,
    gerado_em: new Date().toISOString(),
    totais: { usuarios, produtos, pedidos, inscricoes }
  });
});

app.get('/api/ops/estoque', auth, requireAdminOrTi, async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_produtos,
        COALESCE(SUM(CASE WHEN COALESCE(quantidade_estoque, 0) <= 0 THEN 1 ELSE 0 END), 0)::int AS sem_estoque,
        COALESCE(SUM(COALESCE(quantidade_estoque, 0)), 0)::int AS itens_em_estoque
      FROM produtos
      `
    );

    return res.json({ ok: true, estoque: result.rows[0] || {} });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao gerar resumo de estoque.',
      detalhes: String(error?.message || 'Erro desconhecido')
    });
  }
});

app.get('/api/ops/metas-vendas', auth, requireAdminOrTi, async (_req, res) => {
  try {
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS metas_vendas (
        id SERIAL PRIMARY KEY,
        referencia VARCHAR(20) NOT NULL,
        meta_valor NUMERIC(12,2) NOT NULL,
        criado_por INTEGER REFERENCES usuarios(id),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (referencia)
      )
      `
    );

    const result = await pool.query(
      `
      SELECT id, referencia, meta_valor, criado_por, criado_em, atualizado_em
      FROM metas_vendas
      ORDER BY referencia DESC
      `
    );

    return res.json({ ok: true, metas: result.rows });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao listar metas de vendas.',
      detalhes: String(error?.message || 'Erro desconhecido')
    });
  }
});

app.post('/api/ops/metas-vendas', auth, requireAdminOrTi, async (req, res) => {
  const referencia = String(req.body?.referencia || '').trim();
  const metaValor = Number(req.body?.meta_valor);

  if (!referencia || !Number.isFinite(metaValor) || metaValor <= 0) {
    return res.status(400).json({ erro: 'Campos invalidos. Use referencia e meta_valor > 0.' });
  }

  try {
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS metas_vendas (
        id SERIAL PRIMARY KEY,
        referencia VARCHAR(20) NOT NULL,
        meta_valor NUMERIC(12,2) NOT NULL,
        criado_por INTEGER REFERENCES usuarios(id),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (referencia)
      )
      `
    );

    const result = await pool.query(
      `
      INSERT INTO metas_vendas (referencia, meta_valor, criado_por, atualizado_em)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (referencia)
      DO UPDATE SET
        meta_valor = EXCLUDED.meta_valor,
        atualizado_em = NOW()
      RETURNING id, referencia, meta_valor, criado_por, criado_em, atualizado_em
      `,
      [referencia, metaValor, req.userId || null]
    );

    return res.status(201).json({ ok: true, meta: result.rows[0] });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao salvar meta de vendas.',
      detalhes: String(error?.message || 'Erro desconhecido')
    });
  }
});

app.post('/loja/pedidos/:id/sincronizar-ordem', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query('SELECT id, usuario_id, total FROM pedidos WHERE id = $1', [pedidoId]);
  const pedido = pedidoResult.rows[0];
  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const transacaoResult = await pool.query(
    `
    SELECT id, mercado_order_id
    FROM pagamentos_transacoes
    WHERE pedido_id = $1
      AND mercado_order_id IS NOT NULL
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [pedidoId]
  );
  const transacao = transacaoResult.rows[0];
  if (!transacao?.mercado_order_id) {
    return res.status(404).json({ erro: 'Pedido sem order_id no gateway.' });
  }

  try {
    const orderClient = requireMercadoPagoOrderClient();
    const mercadoOrder = await orderClient.get({ id: String(transacao.mercado_order_id) });
    const mercadoOrderStatus = String(mercadoOrder?.status || 'created').toLowerCase();
    const firstPayment = mercadoOrder?.transactions?.payments?.[0] || null;
    const mercadoTransactionId = firstPayment?.id ? String(firstPayment.id) : null;

    await pool.query(
      `
      UPDATE pagamentos_transacoes
      SET
        status = $1,
        mercado_transaction_id = COALESCE($2, mercado_transaction_id),
        mercado_status = $3,
        detalhes_gateway = $4::jsonb,
        ultima_atualizacao_gateway = NOW(),
        atualizado_em = NOW()
      WHERE id = $5
      `,
      [
        normalizeOrderStatusToTransactionStatus(mercadoOrderStatus),
        mercadoTransactionId,
        mercadoOrderStatus,
        JSON.stringify(mercadoOrder || {}),
        transacao.id
      ]
    );

    await pool.query(
      `
      UPDATE pedidos
      SET status = $1
      WHERE id = $2
      `,
      [normalizeOrderStatusToPedidoStatus(mercadoOrderStatus), pedidoId]
    );

    const pedidoStatusAtual = normalizeOrderStatusToPedidoStatus(mercadoOrderStatus);
    await upsertAssinaturaFromPedido({
      pedidoId,
      pedidoStatus: pedidoStatusAtual,
      valorMensal: pedido.total
    });

    await trySaveUniversalArchive({
      chave: `pedido:${pedidoId}:sync:${Date.now()}`,
      tipoRecurso: 'loja',
      subtipo: 'checkout_sincronizado',
      payload: {
        pedido_id: pedidoId,
        pedido,
        transacao,
        mercado_order: mercadoOrder,
        mercado_status: mercadoOrderStatus,
        pedido_status: pedidoStatusAtual
      },
      metadata: { origem: 'route:/loja/pedidos/:id/sincronizar-ordem' },
      userId: req.userId || null,
      bucket: SUPABASE_STORAGE_BUCKET || null,
      bucketPath: null
    });

    await logAudit(req, 'sincronizar_order_gateway', 'loja', 'pedidos', pedidoId, {
      mercado_order_id: transacao.mercado_order_id,
      mercado_status: mercadoOrderStatus
    });

    return res.json({
      ok: true,
      pedido_id: pedidoId,
      status: pedidoStatusAtual,
      mercado_pago: {
        order_id: transacao.mercado_order_id,
        order_status: mercadoOrderStatus,
        transaction_id: mercadoTransactionId,
        transaction_status: firstPayment?.status || null,
        payment_method: firstPayment?.payment_method || null
      }
    });
  } catch (error) {
    const safeError = sanitizeMercadoError(error);
    const status = safeError.status && Number(safeError.status) < 500 ? 422 : 502;
    return res.status(status).json({
      erro: 'Falha ao sincronizar order no gateway.',
      detalhes_gateway: safeError
    });
  }
});

app.post('/loja/pedidos/:id/reembolso', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || null;
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query('SELECT id, usuario_id FROM pedidos WHERE id = $1', [pedidoId]);
  const pedido = pedidoResult.rows[0];
  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO pedido_solicitacoes (pedido_id, usuario_id, tipo, motivo, status, criado_em, atualizado_em)
    VALUES ($1, $2, 'reembolso', $3, 'pendente', NOW(), NOW())
    RETURNING *
    `,
    [pedidoId, req.userId, motivo]
  );

  await trySaveUniversalArchive({
    chave: `pedido-solicitacao:${rows[0].id}:${Date.now()}`,
    tipoRecurso: 'loja',
    subtipo: 'reembolso_solicitado',
    payload: rows[0],
    metadata: { origem: 'route:/loja/pedidos/:id/reembolso', pedido_id: pedidoId },
    userId: req.userId || null,
    bucket: SUPABASE_STORAGE_BUCKET || null,
    bucketPath: null
  });

  await logAudit(req, 'solicitar_reembolso', 'loja', 'pedido_solicitacoes', rows[0].id, { pedido_id: pedidoId });
  res.status(201).json(rows[0]);
});

app.post('/loja/pedidos/:id/reembolso/processar', auth, requireAdminOrTi, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const valorReembolso = req.body?.valor_reembolso !== undefined ? Number(req.body.valor_reembolso) : null;
  const motivo = toNullableTrimmedString(req.body?.motivo || req.body?.observacao);

  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }
  if (valorReembolso !== null && (!Number.isFinite(valorReembolso) || valorReembolso <= 0)) {
    return res.status(400).json({ erro: 'valor_reembolso deve ser numero positivo.' });
  }

  const pedidoResult = await pool.query('SELECT id, total FROM pedidos WHERE id = $1', [pedidoId]);
  if (!pedidoResult.rows.length) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const transacaoResult = await pool.query(
    `
    SELECT id, mercado_order_id, mercado_transaction_id
    FROM pagamentos_transacoes
    WHERE pedido_id = $1
      AND mercado_order_id IS NOT NULL
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [pedidoId]
  );
  const transacao = transacaoResult.rows[0];
  if (!transacao?.mercado_order_id) {
    return res.status(400).json({ erro: 'Pedido sem order_id vinculado ao gateway.' });
  }

  if (valorReembolso !== null && !transacao.mercado_transaction_id) {
    return res.status(400).json({
      erro: 'Reembolso parcial exige transaction_id da order. Sincronize a order antes de reembolsar.'
    });
  }

  try {
    const orderClient = requireMercadoPagoOrderClient();
    const requestOptions = { idempotencyKey: createIdempotencyKey() };
    const refundBody = valorReembolso === null
      ? undefined
      : {
        transactions: [
          {
            id: String(transacao.mercado_transaction_id),
            amount: toAmountString(valorReembolso)
          }
        ]
      };

    const refundResponse = await orderClient.refund({
      id: String(transacao.mercado_order_id),
      body: refundBody,
      requestOptions
    });

    const refundStatus = String(refundResponse?.status || 'refunded').toLowerCase();

    await pool.query(
      `
      UPDATE pagamentos_transacoes
      SET
        status = 'reembolsado',
        mercado_status = $1,
        detalhes_gateway = $2::jsonb,
        ultima_atualizacao_gateway = NOW(),
        atualizado_em = NOW()
      WHERE id = $3
      `,
      [refundStatus, JSON.stringify(refundResponse || {}), transacao.id]
    );

    await pool.query(
      `
      UPDATE pedidos
      SET status = 'cancelado'
      WHERE id = $1
      `,
      [pedidoId]
    );

    await upsertAssinaturaFromPedido({
      pedidoId,
      pedidoStatus: 'cancelado',
      valorMensal: pedidoResult.rows[0].total
    });

    await pool.query(
      `
      UPDATE pedido_solicitacoes
      SET
        status = 'aprovada',
        atualizado_em = NOW(),
        motivo = COALESCE($2, motivo)
      WHERE id = (
        SELECT id
        FROM pedido_solicitacoes
        WHERE pedido_id = $1
          AND tipo = 'reembolso'
        ORDER BY criado_em DESC
        LIMIT 1
      )
      `,
      [pedidoId, motivo]
    );

    await logAudit(req, 'processar_reembolso_orders_api_v2', 'loja', 'pedidos', pedidoId, {
      mercado_order_id: transacao.mercado_order_id,
      valor_reembolso: valorReembolso,
      motivo
    });

    return res.json({
      ok: true,
      pedido_id: pedidoId,
      status: 'cancelado',
      mercado_pago: {
        order_id: transacao.mercado_order_id,
        refund_status: refundStatus,
        refund_response: refundResponse
      }
    });
  } catch (error) {
    const safeError = sanitizeMercadoError(error);
    const status = safeError.status && Number(safeError.status) < 500 ? 422 : 502;
    return res.status(status).json({
      erro: 'Falha ao processar reembolso no gateway.',
      detalhes_gateway: safeError
    });
  }
});

app.post('/loja/pedidos/:id/troca', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || null;
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query('SELECT id, usuario_id FROM pedidos WHERE id = $1', [pedidoId]);
  const pedido = pedidoResult.rows[0];
  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO pedido_solicitacoes (pedido_id, usuario_id, tipo, motivo, status, criado_em, atualizado_em)
    VALUES ($1, $2, 'troca', $3, 'pendente', NOW(), NOW())
    RETURNING *
    `,
    [pedidoId, req.userId, motivo]
  );

  await logAudit(req, 'solicitar_troca', 'loja', 'pedido_solicitacoes', rows[0].id, { pedido_id: pedidoId });
  res.status(201).json(rows[0]);
});

app.post('/loja/pedidos/:id/cancelamento', auth, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || null;
  if (!pedidoId) {
    return res.status(400).json({ erro: 'ID do pedido invalido.' });
  }

  const pedidoResult = await pool.query('SELECT id, usuario_id FROM pedidos WHERE id = $1', [pedidoId]);
  const pedido = pedidoResult.rows[0];
  if (!pedido) {
    return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  }

  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);
  if (!privileged && Number(pedido.usuario_id) !== req.userId) {
    return res.status(403).json({ erro: 'Sem acesso a este pedido.' });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO pedido_solicitacoes (pedido_id, usuario_id, tipo, motivo, status, criado_em, atualizado_em)
    VALUES ($1, $2, 'cancelamento', $3, 'pendente', NOW(), NOW())
    RETURNING *
    `,
    [pedidoId, req.userId, motivo]
  );

  await logAudit(req, 'solicitar_cancelamento', 'loja', 'pedido_solicitacoes', rows[0].id, { pedido_id: pedidoId });
  res.status(201).json(rows[0]);
});

app.get('/financeiro/historico', auth, async (req, res) => {
  const targetUserId = req.query?.usuario_id ? Number(req.query.usuario_id) : req.userId;
  const privileged = ['admin', 'ti'].includes(req.user.tipo_usuario);

  if (!privileged && targetUserId !== req.userId) {
    return res.status(403).json({ erro: 'Sem permissao para consultar este historico.' });
  }

  const [pedidosResult, transacoesResult, preferenciaResult, assinaturaResult] = await Promise.all([
    pool.query(
      `
      SELECT id, total, status, data_pedido
      FROM pedidos
      WHERE usuario_id = $1
      ORDER BY data_pedido DESC
      `,
      [targetUserId]
    ),
    pool.query(
      `
      SELECT id, pedido_id, metodo, status, valor, moeda, comprovante_url, data_pagamento_agendada, criado_em, atualizado_em
      FROM pagamentos_transacoes
      WHERE usuario_id = $1
      ORDER BY criado_em DESC
      `,
      [targetUserId]
    ),
    pool.query(
      `
      SELECT usuario_id, dia_pagamento, data_vigencia, mensagem_alerta, atualizado_em
      FROM pagamento_preferencias
      WHERE usuario_id = $1
      `,
      [targetUserId]
    ),
    pool.query(
      `
      SELECT
        usuario_id,
        plano_codigo,
        status,
        valor_mensal,
        moeda,
        ciclo_dias,
        inicio_em,
        proxima_cobranca_em,
        origem_pedido_id,
        observacao,
        atualizado_em
      FROM usuario_assinaturas
      WHERE usuario_id = $1
      `,
      [targetUserId]
    )
  ]);

  res.json({
    usuario_id: targetUserId,
    pedidos: pedidosResult.rows,
    transacoes: transacoesResult.rows,
    preferencia_pagamento: preferenciaResult.rows[0] || null,
    assinatura: assinaturaResult.rows[0] || null
  });
});

app.post('/financeiro/data-pagamento', auth, async (req, res) => {
  const diaPagamento = Number(req.body?.dia_pagamento);
  const dataVigencia = req.body?.data_vigencia ? new Date(req.body.data_vigencia) : null;

  if (!diaPagamento || diaPagamento < 1 || diaPagamento > 28) {
    return res.status(400).json({ erro: 'dia_pagamento deve estar entre 1 e 28.' });
  }

  if (!dataVigencia || Number.isNaN(dataVigencia.getTime())) {
    return res.status(400).json({ erro: 'data_vigencia valida obrigatoria.' });
  }

  const minDate = addBusinessDays(new Date(), 30);
  if (dataVigencia < minDate) {
    return res.status(400).json({
      erro: 'Alteracao so permitida com antecedencia minima de 30 dias uteis.',
      data_minima_permitida: minDate.toISOString().slice(0, 10)
    });
  }

  const alerta = 'Alteracao confirmada com antecedencia minima de 30 dias uteis.';

  const { rows } = await pool.query(
    `
    INSERT INTO pagamento_preferencias
      (usuario_id, dia_pagamento, data_vigencia, mensagem_alerta, criado_em, atualizado_em)
    VALUES
      ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (usuario_id)
    DO UPDATE SET
      dia_pagamento = EXCLUDED.dia_pagamento,
      data_vigencia = EXCLUDED.data_vigencia,
      mensagem_alerta = EXCLUDED.mensagem_alerta,
      atualizado_em = NOW()
    RETURNING *
    `,
    [req.userId, diaPagamento, dataVigencia, alerta]
  );

  await logAudit(req, 'alterar_data_pagamento', 'financeiro', 'pagamento_preferencias', req.userId, {
    dia_pagamento: diaPagamento,
    data_vigencia: dataVigencia.toISOString().slice(0, 10)
  });

  res.json({ ok: true, preferencia: rows[0] });
});

app.post('/webhooks/mercadopago/orders', webhookRateLimiter, async (req, res) => {
  const topic = toNullableTrimmedString(req.body?.type || req.query?.topic || req.query?.type || 'unknown');
  const action = toNullableTrimmedString(req.body?.action);
  const dataId = getWebhookDataId(req);
  const eventKey = getWebhookEventKey(req, dataId);
  const payload = req.body || {};
  const xSignature = toNullableTrimmedString(req.headers['x-signature']);
  const xRequestId = toNullableTrimmedString(req.headers['x-request-id']);

  if (!MERCADO_PAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ erro: 'Webhook secret nao configurado.' });
  }

  const isSignatureValid = verifyMercadoPagoWebhookSignature({
    xSignature,
    xRequestId,
    dataId,
    secret: MERCADO_PAGO_WEBHOOK_SECRET
  });

  if (!isSignatureValid) {
    return res.status(401).json({ erro: 'Assinatura webhook invalida.' });
  }

  const eventInsert = await pool.query(
    `
    INSERT INTO mercado_webhook_eventos
      (event_key, topic, action, data_id, payload_json, status_processamento, recebido_em)
    VALUES
      ($1, $2, $3, $4, $5::jsonb, 'recebido', NOW())
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id
    `,
    [eventKey, topic, action, dataId, JSON.stringify(payload)]
  );

  const eventRow = eventInsert.rows[0];
  if (!eventRow) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  if (!dataId || topic !== 'order') {
    await pool.query(
      `
      UPDATE mercado_webhook_eventos
      SET status_processamento = 'ignorado', processado_em = NOW()
      WHERE id = $1
      `,
      [eventRow.id]
    );
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const orderClient = requireMercadoPagoOrderClient();
    const mercadoOrder = await orderClient.get({ id: String(dataId) });
    const mercadoOrderStatus = String(mercadoOrder?.status || 'created').toLowerCase();
    const firstPayment = mercadoOrder?.transactions?.payments?.[0] || null;
    const mercadoTransactionId = firstPayment?.id ? String(firstPayment.id) : null;

    await pool.query(
      `
      UPDATE pagamentos_transacoes
      SET
        status = $1,
        mercado_status = $2,
        mercado_transaction_id = COALESCE($3, mercado_transaction_id),
        detalhes_gateway = $4::jsonb,
        ultima_atualizacao_gateway = NOW(),
        atualizado_em = NOW()
      WHERE mercado_order_id = $5
      `,
      [
        normalizeOrderStatusToTransactionStatus(mercadoOrderStatus),
        mercadoOrderStatus,
        mercadoTransactionId,
        JSON.stringify(mercadoOrder || {}),
        String(dataId)
      ]
    );

    await pool.query(
      `
      UPDATE pedidos p
      SET status = $1
      FROM pagamentos_transacoes pt
      WHERE pt.pedido_id = p.id
        AND pt.mercado_order_id = $2
      `,
      [normalizeOrderStatusToPedidoStatus(mercadoOrderStatus), String(dataId)]
    );

    const pedidosAfetadosResult = await pool.query(
      `
      SELECT p.id, p.total
      FROM pedidos p
      JOIN pagamentos_transacoes pt ON pt.pedido_id = p.id
      WHERE pt.mercado_order_id = $1
      `,
      [String(dataId)]
    );

    const pedidoStatusAtual = normalizeOrderStatusToPedidoStatus(mercadoOrderStatus);
    for (const item of pedidosAfetadosResult.rows) {
      await upsertAssinaturaFromPedido({
        pedidoId: item.id,
        pedidoStatus: pedidoStatusAtual,
        valorMensal: item.total
      });
    }

    await pool.query(
      `
      UPDATE mercado_webhook_eventos
      SET
        status_processamento = 'processado',
        processado_em = NOW()
      WHERE id = $1
      `,
      [eventRow.id]
    );

    return res.status(200).json({ ok: true, processed: true });
  } catch (error) {
    const safeError = sanitizeMercadoError(error);
    await pool.query(
      `
      UPDATE mercado_webhook_eventos
      SET
        status_processamento = 'falha',
        erro = $2,
        processado_em = NOW()
      WHERE id = $1
      `,
      [eventRow.id, JSON.stringify(safeError)]
    );
    return res.status(500).json({ erro: 'Falha ao processar webhook.' });
  }
});

app.get('/ti/webhooks/mercadopago/resumo', auth, requireAdminOrTi, async (req, res) => {
  const dias = Math.max(1, Math.min(60, Number(req.query?.dias || 7)));

  const [volumeResult, statusResult, errorsResult] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::INTEGER AS total
      FROM mercado_webhook_eventos
      WHERE recebido_em >= NOW() - ($1::TEXT || ' days')::INTERVAL
      `,
      [dias]
    ),
    pool.query(
      `
      SELECT status_processamento, COUNT(*)::INTEGER AS quantidade
      FROM mercado_webhook_eventos
      WHERE recebido_em >= NOW() - ($1::TEXT || ' days')::INTERVAL
      GROUP BY status_processamento
      ORDER BY quantidade DESC
      `,
      [dias]
    ),
    pool.query(
      `
      SELECT event_key, topic, action, data_id, erro, recebido_em
      FROM mercado_webhook_eventos
      WHERE status_processamento = 'falha'
        AND recebido_em >= NOW() - ($1::TEXT || ' days')::INTERVAL
      ORDER BY recebido_em DESC
      LIMIT 20
      `,
      [dias]
    )
  ]);

  const total = Number(volumeResult.rows[0]?.total || 0);
  const byStatus = Object.fromEntries(statusResult.rows.map((row) => [row.status_processamento, Number(row.quantidade)]));
  const sucesso = Number(byStatus.processado || 0);
  const taxaSucesso = total > 0 ? Number(((sucesso / total) * 100).toFixed(2)) : 0;

  res.json({
    periodo: {
      dias,
      inicio: new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString(),
      fim: new Date().toISOString()
    },
    resumo: {
      total_eventos: total,
      por_status: byStatus,
      taxa_sucesso_percentual: taxaSucesso,
      saude: taxaSucesso >= 98 ? 'saudavel' : (taxaSucesso >= 90 ? 'atencao' : 'critico')
    },
    erros_recentes: errorsResult.rows
  });
});

app.post('/ti/manutencoes', auth, requireAdminOrTi, async (req, res) => {
  const titulo = String(req.body?.titulo || '').trim();
  const descricao = String(req.body?.descricao || '').trim();
  const motivo = String(req.body?.motivo || '').trim();
  const previsaoRetorno = req.body?.previsao_retorno_em ? new Date(req.body.previsao_retorno_em) : null;
  const alvos = Array.isArray(req.body?.alvos)
    ? [...new Set(req.body.alvos.map((item) => String(item).trim()).filter(Boolean))]
    : [];

  if (!titulo || !descricao || !motivo || !alvos.length) {
    return res.status(400).json({ erro: 'titulo, descricao, motivo e alvos sao obrigatorios.' });
  }

  if (previsaoRetorno && Number.isNaN(previsaoRetorno.getTime())) {
    return res.status(400).json({ erro: 'previsao_retorno_em invalida.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const manutencaoResult = await client.query(
      `
      INSERT INTO manutencoes
        (criado_por_id, titulo, descricao, motivo, status, inicio_em, previsao_retorno_em, criado_em, atualizado_em)
      VALUES
        ($1, $2, $3, $4, 'ativa', NOW(), $5, NOW(), NOW())
      RETURNING *
      `,
      [req.userId, titulo, descricao, motivo, previsaoRetorno]
    );
    const manutencao = manutencaoResult.rows[0];

    for (const alvo of alvos) {
      await client.query(
        `
        INSERT INTO manutencao_alvos (manutencao_id, rota_alvo, html_alvo)
        VALUES ($1, $2, $3)
        ON CONFLICT (manutencao_id, rota_alvo) DO NOTHING
        `,
        [manutencao.id, alvo, alvo.endsWith('.html') ? alvo : null]
      );
    }

    await client.query('COMMIT');

    await logAudit(req, 'iniciar_manutencao', 'ti', 'manutencoes', manutencao.id, { alvos });
    res.status(201).json({ ok: true, manutencao_id: manutencao.id, status: manutencao.status, alvos });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar manutencao.' });
  } finally {
    client.release();
  }
});

app.post('/ti/manutencoes/:id/estender', auth, requireAdminOrTi, async (req, res) => {
  const manutencaoId = Number(req.params.id);
  const novaPrevisao = req.body?.previsao_retorno_em ? new Date(req.body.previsao_retorno_em) : null;
  const motivoExtensao = String(req.body?.motivo_extensao || '').trim();

  if (!manutencaoId || !novaPrevisao || Number.isNaN(novaPrevisao.getTime()) || !motivoExtensao) {
    return res.status(400).json({ erro: 'manutencao, previsao_retorno_em e motivo_extensao sao obrigatorios.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE manutencoes
    SET
      previsao_retorno_em = $1,
      motivo_extensao = $2,
      atualizado_em = NOW()
    WHERE id = $3
      AND status = 'ativa'
    RETURNING *
    `,
    [novaPrevisao, motivoExtensao, manutencaoId]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Manutencao ativa nao encontrada.' });
  }

  await logAudit(req, 'estender_manutencao', 'ti', 'manutencoes', manutencaoId, { motivo_extensao: motivoExtensao });
  res.json({ ok: true, manutencao: rows[0] });
});

app.post('/ti/manutencoes/:id/encerrar', auth, requireAdminOrTi, async (req, res) => {
  const manutencaoId = Number(req.params.id);
  const confirmar = req.body?.confirmar === true;

  if (!manutencaoId || !confirmar) {
    return res.status(400).json({ erro: 'confirmar=true obrigatorio para encerrar manutencao.' });
  }

  const { rows } = await pool.query(
    `
    UPDATE manutencoes
    SET
      status = 'encerrada',
      encerrada_em = NOW(),
      atualizado_em = NOW()
    WHERE id = $1
      AND status = 'ativa'
    RETURNING *
    `,
    [manutencaoId]
  );

  if (!rows.length) {
    return res.status(404).json({ erro: 'Manutencao ativa nao encontrada.' });
  }

  await logAudit(req, 'encerrar_manutencao', 'ti', 'manutencoes', manutencaoId, {});
  res.json({ ok: true, manutencao: rows[0] });
});

app.get('/ti/saude', auth, requireAdminOrTi, async (req, res) => {
  const startedAt = process.uptime();
  const now = new Date();
  const dbProbeStarted = Date.now();
  let dbStatus = 'ok';
  let dbLatencyMs = null;
  let dbError = null;

  try {
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - dbProbeStarted;
  } catch (error) {
    dbStatus = 'erro';
    dbError = error.message;
  }

  const maintenanceResult = await pool.query(
    `
    SELECT COUNT(*)::INTEGER AS total
    FROM manutencoes
    WHERE status = 'ativa'
    `
  );

  const activeMaintenance = Number(maintenanceResult.rows[0]?.total || 0);
  const saude = dbStatus === 'ok' ? (activeMaintenance > 0 ? 'degradado_manutencao' : 'saudavel') : 'critico';

  res.json({
    timestamp: now.toISOString(),
    timezone: 'America/Sao_Paulo',
    runtime: {
      node: process.version,
      uptime_seconds: Number(startedAt.toFixed(2))
    },
    ambiente: process.env.NODE_ENV || 'development',
    db: {
      status: dbStatus,
      latency_ms: dbLatencyMs,
      erro: dbError
    },
    manutencao: {
      ativa_total: activeMaintenance
    },
    resumo: {
      saude
    }
  });
});

app.get('/ti/manutencoes/ativas', auth, requireAdminOrTi, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.titulo,
      m.descricao,
      m.motivo,
      m.inicio_em,
      m.previsao_retorno_em,
      m.motivo_extensao,
      COALESCE(
        json_agg(
          json_build_object(
            'rota_alvo', ma.rota_alvo,
            'html_alvo', ma.html_alvo
          )
        ) FILTER (WHERE ma.id IS NOT NULL),
        '[]'::json
      ) AS alvos
    FROM manutencoes m
    LEFT JOIN manutencao_alvos ma ON ma.manutencao_id = m.id
    WHERE m.status = 'ativa'
    GROUP BY m.id
    ORDER BY m.inicio_em DESC
    `
  );

  res.json(rows);
});

app.post('/ti/manutencoes/pause-global', auth, requireAdminOrTi, async (req, res) => {
  const titulo = String(req.body?.titulo || 'Manutencao global').trim();
  const descricao = String(req.body?.descricao || 'Site temporariamente pausado para atualizacao tecnica.').trim();
  const motivo = String(req.body?.motivo || 'Atualizacao de infraestrutura').trim();
  const previsaoRetorno = req.body?.previsao_retorno_em ? new Date(req.body.previsao_retorno_em) : null;

  if (!titulo || !descricao || !motivo) {
    return res.status(400).json({ erro: 'titulo, descricao e motivo sao obrigatorios.' });
  }
  if (previsaoRetorno && Number.isNaN(previsaoRetorno.getTime())) {
    return res.status(400).json({ erro: 'previsao_retorno_em invalida.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createResult = await client.query(
      `
      INSERT INTO manutencoes
        (criado_por_id, titulo, descricao, motivo, status, inicio_em, previsao_retorno_em, criado_em, atualizado_em)
      VALUES
        ($1, $2, $3, $4, 'ativa', NOW(), $5, NOW(), NOW())
      RETURNING *
      `,
      [req.userId, titulo, descricao, motivo, previsaoRetorno]
    );
    const manutencao = createResult.rows[0];

    await client.query(
      `
      INSERT INTO manutencao_alvos (manutencao_id, rota_alvo, html_alvo)
      VALUES ($1, '*', NULL)
      ON CONFLICT (manutencao_id, rota_alvo) DO NOTHING
      `,
      [manutencao.id]
    );

    await client.query('COMMIT');
    await logAudit(req, 'pause_global_site', 'ti', 'manutencoes', manutencao.id, { alvos: ['*'] });
    res.status(201).json({ ok: true, manutencao });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ erro: 'Falha ao pausar site globalmente.' });
  } finally {
    client.release();
  }
});

app.get('/admin/manutencoes/historico', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.titulo,
      m.descricao,
      m.motivo,
      m.status,
      m.inicio_em,
      m.previsao_retorno_em,
      m.encerrada_em,
      m.motivo_extensao,
      criador.nome AS criado_por_nome,
      COALESCE(
        json_agg(
          json_build_object(
            'rota_alvo', ma.rota_alvo,
            'html_alvo', ma.html_alvo
          )
        ) FILTER (WHERE ma.id IS NOT NULL),
        '[]'::json
      ) AS alvos
    FROM manutencoes m
    LEFT JOIN usuarios criador ON criador.id = m.criado_por_id
    LEFT JOIN manutencao_alvos ma ON ma.manutencao_id = m.id
    GROUP BY m.id, criador.nome
    ORDER BY m.inicio_em DESC
    LIMIT 300
    `
  );

  res.json(rows);
});

app.get('/manutencao/status', async (req, res) => {
  const rota = String(req.query?.rota || '/').trim() || '/';

  try {
    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.titulo,
        m.descricao,
        m.motivo,
        m.status,
        m.inicio_em,
        m.previsao_retorno_em,
        m.motivo_extensao
      FROM manutencoes m
      JOIN manutencao_alvos ma ON ma.manutencao_id = m.id
      WHERE m.status = 'ativa'
        AND (ma.rota_alvo = $1 OR ma.rota_alvo = '*')
      ORDER BY m.inicio_em DESC
      LIMIT 1
      `,
      [rota]
    );

    if (!rows.length) {
      return res.json({ ativa: false });
    }

    res.json({ ativa: true, manutencao: rows[0] });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar status de manutencao.' });
  }
});

app.get('/api/public/app-config', (req, res) => {
  const inferredBaseUrl = `${req.protocol}://${req.get('host')}`;
  const apiBaseUrl = API_PUBLIC_BASE_URL || inferredBaseUrl;

  res.json({
    app_name: 'Ordo Caoti',
    app_mode: 'shop_school_unified',
    supported_languages: ['pt-BR', 'en-US', 'es-ES'],
    legal_routes: {
      privacy: '/legal/politica-privacidade',
      terms: '/legal/termos-de-uso',
      accessibility: '/legal/acessibilidade'
    },
    pwa: {
      manifest_url: '/manifest.webmanifest',
      service_worker_url: '/sw.js'
    },
    consent: {
      legal_terms_version: TERMO_PRIVACIDADE_VERSAO
    },
    api: {
      base_url: apiBaseUrl,
      login: '/login',
      logout: '/logout',
      memory: '/auth/memoria',
      search: '/api/search',
      storage_status: '/api/armazenamento/status',
      storage_records: '/api/armazenamento/registros',
      biblioteca_recursos: '/biblioteca/recursos',
      biblioteca_search_externa: '/biblioteca/publica/search',
      app_preferences_get: '/perfil/preferencias-app',
      app_preferences_post: '/perfil/preferencias-app',
      subscription_me: '/assinatura/me',
      health_ti: '/ti/saude'
    },
    versions: {
      preferences: APP_PREFERENCES_VERSION
    },
    accessibility: {
      high_contrast: true,
      reduced_motion: true,
      readable_font: true,
      focus_mode: true,
      line_spacing: true
    },
    integrations: {
      google_meet: {
        enabled: Boolean(
          (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN)
          || GOOGLE_CALENDAR_ACCESS_TOKEN
        ),
        mode: (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN)
          ? 'oauth_refresh_token'
          : (GOOGLE_CALENDAR_ACCESS_TOKEN ? 'access_token' : 'disabled')
      },
      daily: {
        enabled: Boolean(DAILY_API_KEY && DAILY_DOMAIN),
        route: '/live/reunioes'
      },
      webhooks: {
        mercado_pago_orders: {
          enabled: Boolean(MERCADO_PAGO_WEBHOOK_SECRET),
          path: '/webhooks/mercadopago/orders',
          method: 'POST'
        }
      }
    },
    timestamp: new Date().toISOString()
  });
});

function dailyRoomNameIsValid(value) {
  return /^[a-z0-9][a-z0-9-]{2,62}$/.test(String(value || '').trim().toLowerCase());
}

function ensureDailyConfigured(res) {
  if (DAILY_API_KEY && DAILY_DOMAIN) return true;
  res.status(503).json({ erro: 'Integracao Daily.co indisponivel. Configure DAILY_API_KEY e DAILY_DOMAIN no ambiente.' });
  return false;
}

app.get('/api/daily/config', auth, (req, res) => {
  if (!ensureDailyConfigured(res)) return;
  res.json({ enabled: true, domain: DAILY_DOMAIN });
});

app.get('/api/daily/rooms', auth, requireProfessorOrAdmin, async (req, res) => {
  if (!ensureDailyConfigured(res)) return;
  try {
    const response = await listRooms(DAILY_API_KEY);
    const rooms = Array.isArray(response?.data) ? response.data : [];
    res.json({ rooms: rooms.map((room) => ({ name: room.name, url: room.url, created_at: room.created_at, config: room.config })) });
  } catch (error) {
    res.status(502).json({ erro: 'Nao foi possivel listar as salas Daily.', detalhes: String(error?.message || 'erro_daily') });
  }
});

app.post('/api/daily/rooms', auth, requireProfessorOrAdmin, async (req, res) => {
  if (!ensureDailyConfigured(res)) return;
  const name = String(req.body?.name || '').trim().toLowerCase();
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (!dailyRoomNameIsValid(name)) {
    return res.status(400).json({ erro: 'Nome de sala invalido. Use 3 a 63 caracteres: letras minusculas, numeros e hifen.' });
  }
  try {
    const room = await createRoom(DAILY_API_KEY, {
      name,
      privacy: 'private',
      properties: {
        enable_chat: true,
        enable_screenshare: true,
        enable_recording: 'cloud',
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      },
      // Room title is retained in the audit event; Daily room name is canonical.
    });
    await logAudit(req, 'daily_sala_criada', 'daily', 'daily_room', null, { name, title });
    res.status(201).json({ room: { name: room.name, url: room.url, config: room.config } });
  } catch (error) {
    res.status(502).json({ erro: 'Nao foi possivel criar a sala Daily.', detalhes: String(error?.message || 'erro_daily') });
  }
});

app.post('/api/daily/rooms/:roomName/tokens', auth, async (req, res) => {
  if (!ensureDailyConfigured(res)) return;
  const roomName = String(req.params.roomName || '').trim().toLowerCase();
  if (!dailyRoomNameIsValid(roomName)) return res.status(400).json({ erro: 'Sala invalida.' });

  const mayOwnRoom = ['admin', 'ti', 'professor'].includes(req.user?.tipo_usuario) || req.user?.roles?.includes('professor');
  const requestedOwner = Boolean(req.body?.is_owner);
  if (requestedOwner && !mayOwnRoom) return res.status(403).json({ erro: 'Somente equipe docente pode receber permissao de anfitriao.' });

  try {
    const token = await createMeetingToken(DAILY_API_KEY, roomName, {
      user_name: String(req.user?.nome || 'Participante').slice(0, 80),
      user_id: String(req.userId),
      is_owner: requestedOwner && mayOwnRoom,
      exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    });
    await logAudit(req, 'daily_token_emitido', 'daily', 'daily_room', null, { room_name: roomName, is_owner: requestedOwner && mayOwnRoom });
    res.json({ token: token?.token || token });
  } catch (error) {
    res.status(502).json({ erro: 'Nao foi possivel gerar o acesso da sala.', detalhes: String(error?.message || 'erro_daily') });
  }
});

app.get('/api/armazenamento/status', async (req, res) => {
  let registrosResumo = {
    total_registros: null,
    total_com_anexo: null,
    total_sem_anexo: null,
    total_payload_base64_bytes: null
  };

  try {
    await ensureUniversalArchiveTable();
    const statsResult = await pool.query(
      `
      SELECT
        COUNT(*)::INT AS total_registros,
        COUNT(*) FILTER (WHERE supabase_path IS NOT NULL)::INT AS total_com_anexo,
        COUNT(*) FILTER (WHERE supabase_path IS NULL)::INT AS total_sem_anexo,
        COALESCE(SUM(octet_length(payload_base64)), 0)::BIGINT AS total_payload_base64_bytes
      FROM armazenamento_universal
      `
    );
    registrosResumo = statsResult.rows[0] || registrosResumo;
  } catch (_) {
    // Mantem endpoint resiliente quando tabela ainda nao foi criada.
  }

  res.json({
    supabase: {
      url_configurada: !!SUPABASE_URL,
      chave_service_role_configurada: !!SUPABASE_SERVICE_ROLE_KEY,
      storage_bucket: SUPABASE_STORAGE_BUCKET,
      storage_habilitado: hasSupabaseStorageClient(),
      encriptacao_app_habilitada: !!SUPABASE_ENCRYPTION_KEY,
      ssl: 'required-via-database-pool-and-https'
    },
    aws_s3: {
      habilitado: hasAwsS3Config(),
      bucket_configurado: Boolean(process.env.AWS_S3_BUCKET),
      regiao_configurada: Boolean(process.env.AWS_REGION),
      modo: 'private-signed-urls'
    },
    cofre_universal: {
      tabela: 'armazenamento_universal',
      formato: 'json+aes-256-gcm',
      suporta_anexos: true,
      suporta_futuro_crescimento: true,
      resumo: registrosResumo,
      estrategia_otimizacao: {
        modo: 'link-first',
        descricao: 'Transicoes externas priorizam URL e metadados para economizar espaco.'
      }
    },
    integracoes_google: {
      drive_habilitado: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
      classroom_habilitado: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
      drive_folder_default: GOOGLE_DRIVE_SHARED_FOLDER_ID || null,
      storage_preferencia_padrao: STORAGE_PREFER_GOOGLE_DRIVE ? 'google_drive' : 'supabase_storage'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/armazenamento/registros', auth, async (req, res) => {
  const tipoRecurso = String(req.query?.tipo_recurso || '').trim() || null;
  const limite = Math.min(Math.max(Number(req.query?.limite || 50) || 50, 1), 200);

  await ensureUniversalArchiveTable();
  const params = [];
  let whereClause = '';
  if (tipoRecurso) {
    params.push(tipoRecurso);
    whereClause = 'WHERE tipo_recurso = $1';
  }

  params.push(limite);

  const { rows } = await pool.query(
    `
    SELECT
      id,
      chave,
      tipo_recurso,
      subtipo,
      encrypted,
      algorithm,
      metadata_json,
      supabase_bucket,
      supabase_path,
      criado_em,
      atualizado_em
    FROM armazenamento_universal
    ${whereClause}
    ORDER BY criado_em DESC
    LIMIT $${params.length}
    `,
    params
  );

  res.json(rows);
});

app.post('/api/armazenamento/registros', auth, async (req, res) => {
  const chave = String(req.body?.chave || '').trim();
  const tipoRecurso = String(req.body?.tipo_recurso || '').trim();
  const subtipo = String(req.body?.subtipo || '').trim() || null;
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

  if (!chave || !tipoRecurso) {
    return res.status(400).json({ erro: 'chave e tipo_recurso sao obrigatorios.' });
  }

  const record = await saveUniversalArchive({
    chave,
    tipoRecurso,
    subtipo,
    payload,
    metadata,
    userId: req.userId
  });

  await logAudit(req, 'armazenar_registro_universal', 'armazenamento', 'armazenamento_universal', record.id, metadata);
  res.status(201).json(record);
});

app.get('/api/armazenamento/registros/:chave', auth, async (req, res) => {
  const chave = String(req.params.chave || '').trim();
  if (!chave) {
    return res.status(400).json({ erro: 'chave invalida.' });
  }

  await ensureUniversalArchiveTable();
  const { rows } = await pool.query(
    `
    SELECT
      id,
      chave,
      tipo_recurso,
      subtipo,
      encrypted,
      algorithm,
      iv,
      auth_tag,
      payload_base64 AS payload,
      metadata_json,
      supabase_bucket,
      supabase_path,
      criado_em,
      atualizado_em
    FROM armazenamento_universal
    WHERE chave = $1
    LIMIT 1
    `,
    [chave]
  );

  const record = rows[0];
  if (!record) {
    return res.status(404).json({ erro: 'Registro nao encontrado.' });
  }

  const payload = decryptPayload(record);
  res.json({
    ...record,
    payload
  });
});

const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => validateUploadFile(file, callback)
});

app.post('/api/armazenamento/anexos', auth, archiveUpload.single('arquivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: 'arquivo e obrigatorio.' });
  }

  const chave = String(req.body?.chave || req.file.originalname || `arquivo-${Date.now()}`).trim();
  const tipoRecurso = String(req.body?.tipo_recurso || 'arquivo').trim();
  const subtipo = String(req.body?.subtipo || '').trim() || null;
  const metadata = {
    ...(req.body?.metadata ? safeJsonParse(req.body.metadata, {}) : {}),
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size
  };

  let bucket = null;
  let bucketPath = null;
  let publicUrl = null;
  let storageProvider = 'inline';

  const requestPreference = String(req.body?.storage_preference || '').trim().toLowerCase();
  const preferGoogleDrive = requestPreference
    ? requestPreference === 'google_drive'
    : STORAGE_PREFER_GOOGLE_DRIVE;

  const canUseGoogleDrive = isGoogleDriveStorageAvailable();
  const canUseSupabase = hasSupabaseStorageClient();
  const canUseAwsS3 = hasAwsS3Config();
  const preferAwsS3 = requestPreference
    ? requestPreference === 'aws_s3'
    : canUseAwsS3;

  if (preferAwsS3 && canUseAwsS3) {
    bucketPath = `${AWS_S3_PREFIX}/${tipoRecurso}/${req.userId}/${Date.now()}-${sanitizeStorageFileName(req.file.originalname)}`;
    await putBufferToS3({
      key: bucketPath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype
    });
    bucket = 'aws-s3';
    storageProvider = 'aws_s3_private';
  }

  if (!bucket && preferGoogleDrive && canUseGoogleDrive) {
    try {
      const uploaded = await uploadBufferToGoogleDrive({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId: GOOGLE_DRIVE_SHARED_FOLDER_ID || null
      });
      publicUrl = uploaded.publicUrl;
      bucket = 'google-drive';
      bucketPath = uploaded.path;
      storageProvider = uploaded.provider;
      metadata.storage_provider = uploaded.provider;
      metadata.google_drive_file_id = uploaded.id;
      metadata.google_drive = uploaded.metadata;
    } catch (error) {
      metadata.google_drive_error = String(error?.message || 'erro_google_drive');
    }
  }

  if (!bucket && !publicUrl && canUseSupabase) {
    bucketPath = `${tipoRecurso}/${Date.now()}-${sanitizeStorageFileName(req.file.originalname)}`;
    publicUrl = await uploadBufferToSupabaseStorage({
      bucket: SUPABASE_STORAGE_BUCKET,
      path: bucketPath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      cacheControl: '3600'
    });
    bucket = SUPABASE_STORAGE_BUCKET;
    storageProvider = 'supabase_storage';
  }

  metadata.storage_provider = storageProvider;

  const record = await saveUniversalArchive({
    chave,
    tipoRecurso,
    subtipo,
    payload: {
      arquivo: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        public_url: publicUrl
      }
    },
    metadata,
    userId: req.userId,
    bucket,
    bucketPath
  });

  await logAudit(req, 'armazenar_anexo_universal', 'armazenamento', 'armazenamento_universal', record.id, metadata);
  res.status(201).json({
    ...record,
    public_url: publicUrl
  });
});

app.post('/api/armazenamento/anexos/presign', auth, async (req, res) => {
  if (!hasAwsS3Config()) return res.status(503).json({ erro: 'Armazenamento AWS S3 nao configurado.' });
  const fileName = sanitizeStorageFileName(req.body?.file_name || 'arquivo');
  const contentType = String(req.body?.content_type || '').toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) return res.status(400).json({ erro: 'Tipo de arquivo nao permitido.' });
  const key = `${AWS_S3_PREFIX}/direct/${req.userId}/${Date.now()}-${fileName}`;
  try {
    const upload = await createPresignedUploadUrl({ key, contentType, expiresIn: 300 });
    res.json({ upload_url: upload.uploadUrl, key: upload.key, expires_in: 300, provider: 'aws_s3_private' });
  } catch (error) {
    res.status(502).json({ erro: 'Nao foi possivel preparar o envio do arquivo.', detalhes: String(error?.message || 'erro_s3') });
  }
});

app.get('/api/armazenamento/anexos/:id/download', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Anexo invalido.' });
  const { rows } = await pool.query('SELECT id, criado_por_id, supabase_bucket, supabase_path FROM armazenamento_universal WHERE id = $1 LIMIT 1', [id]);
  const record = rows[0];
  if (!record) return res.status(404).json({ erro: 'Anexo nao encontrado.' });
  const privileged = ['admin', 'ti'].includes(req.user?.tipo_usuario);
  if (!privileged && Number(record.criado_por_id) !== Number(req.userId)) return res.status(403).json({ erro: 'Sem permissao para este anexo.' });
  if (record.supabase_bucket !== 'aws-s3' || !record.supabase_path) return res.status(409).json({ erro: 'Este anexo nao usa armazenamento privado AWS S3.' });
  try {
    const downloadUrl = await createPresignedDownloadUrl({ key: record.supabase_path, expiresIn: 300 });
    res.json({ download_url: downloadUrl, expires_in: 300 });
  } catch (error) {
    res.status(502).json({ erro: 'Nao foi possivel preparar o download.', detalhes: String(error?.message || 'erro_s3') });
  }
});

app.get('/api/compatibilidade', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    api: {
      style: 'rest',
      transport: 'https',
      content_types: ['application/json'],
      auth: ['bearer-jwt', 'cookie-session'],
      openapi: `${baseUrl}/api/openapi.json`
    },
    language_clients: {
      javascript: true,
      typescript: true,
      python: true,
      java: true,
      csharp: true,
      go: true,
      php: true,
      ruby: true,
      rust: true,
      kotlin: true,
      swift: true
    },
    device_support: {
      pwa: true,
      android_capacitor: false,
      ios_capacitor: false,
      browser_targets: ['chrome', 'firefox', 'safari', 'edge']
    },
    performance: {
      gzip_enabled: true,
      static_cache: true,
      service_worker: '/sw.js'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/openapi.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.type('application/json').send({
    openapi: '3.0.3',
    info: {
      title: 'Ordo Caoti API',
      version: '2026.04',
      description: 'API REST para loja, membros, diario, grimorio e operacao interna.'
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    paths: {
      '/login': {
        post: {
          summary: 'Autenticacao de usuario',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    senha: { type: 'string' },
                    perfil_login: { type: 'string' }
                  },
                  required: ['email', 'senha']
                }
              }
            }
          },
          responses: {
            '200': { description: 'Login concluido' },
            '401': { description: 'Credenciais invalidas' }
          }
        }
      },
      '/api/public/app-config': {
        get: {
          summary: 'Configuracao publica do app',
          responses: { '200': { description: 'Configuracao retornada' } }
        }
      },
      '/api/search': {
        get: {
          summary: 'Busca unificada loja/escola',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, required: true }
          ],
          responses: { '200': { description: 'Resultados da busca' } }
        }
      },
      '/assinatura/me': {
        get: {
          summary: 'Status da assinatura do usuario autenticado',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Assinatura atual' }, '401': { description: 'Nao autenticado' } }
        }
      },
      '/diario/pessoal': {
        get: {
          summary: 'Lista diario pessoal do usuario',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Lista de entradas' } }
        },
        post: {
          summary: 'Cria entrada no diario pessoal',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    conteudo_texto: { type: 'string' },
                    sentimento: { type: 'string' },
                    visivel_para_supervisao: { type: 'boolean' }
                  },
                  required: ['conteudo_texto']
                }
              }
            }
          },
          responses: { '201': { description: 'Entrada criada' }, '400': { description: 'Payload invalido' } }
        }
      },
      '/grimorio/pessoal': {
        get: {
          summary: 'Lista registros do grimorio pessoal',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Lista de registros' } }
        },
        post: {
          summary: 'Cria registro no grimorio pessoal',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    tipo_registro: { type: 'string', enum: ['anotacao', 'ritual', 'estudo', 'referencia'] },
                    conteudo_texto: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    visivel_para_supervisao: { type: 'boolean' }
                  },
                  required: ['conteudo_texto']
                }
              }
            }
          },
          responses: { '201': { description: 'Registro criado' }, '400': { description: 'Payload invalido' } }
        }
      }
    }
  });
});

app.post('/api/consentimentos/lgpd', async (req, res) => {
  const nome = String(req.body?.nome || '').trim() || null;
  const email = String(req.body?.email || '').trim().toLowerCase() || null;
  const versao = String(req.body?.versao_termo || TERMO_PRIVACIDADE_VERSAO).trim();
  const idioma = String(req.body?.idioma || '').trim() || 'pt-BR';
  const origem = String(req.body?.origem || 'site').trim() || 'site';
  const aceito = req.body?.aceito === true;

  if (!aceito) {
    return res.status(400).json({ erro: 'Aceite explicito e obrigatorio.' });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO consentimentos_lgpd_publico
        (nome, email, versao_termo, aceito, origem, ip_origem, user_agent, idioma, criado_em)
      VALUES
        ($1, $2, $3, true, $4, $5, $6, $7, NOW())
      RETURNING id, versao_termo, criado_em
      `,
      [nome, email, versao, origem, getClientIp(req), req.headers['user-agent'] || null, idioma]
    );

    res.status(201).json({
      ok: true,
      consentimento: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao registrar consentimento.' });
  }
});

app.post('/api/recuperar-senha', passwordRecoveryRateLimiter, async (req, res) => {
  const { email } = req.body;

  try {
    const { rows } = await pool.query('SELECT id, nome FROM usuarios WHERE email = $1', [email]);
    const user = rows[0];

    if (!user) {
      return res.json({ ok: true, message: 'Se o e-mail existir, um link foi enviado.' });
    }

    const token = crypto.randomBytes(20).toString('hex');
    const now = new Date();
    now.setHours(now.getHours() + 1);

    await pool.query(
      'UPDATE usuarios SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, now, user.id]
    );

    const link = `http://localhost:3000/redefinir-senha?token=${token}`;
    console.log(`\n[EMAIL SIMULADO] Para: ${email}`);
    console.log(`[EMAIL SIMULADO] Link de recuperacao: ${link}\n`);

    res.json({ ok: true, message: 'Link enviado (verifique o console do servidor).' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao processar solicitacao.' });
  }
});

app.post('/api/redefinir-senha', passwordResetRateLimiter, async (req, res) => {
  const { token, novaSenha } = req.body;

  if (!String(token || '').trim() || !String(novaSenha || '').trim()) {
    return res.status(400).json({ erro: 'token e novaSenha sao obrigatorios.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id FROM usuarios WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({ erro: 'Token invalido ou expirado.' });
    }

    const passwordCheck = validatePasswordStrength(novaSenha);
    if (!passwordCheck.ok) {
      return res.status(400).json({ erro: passwordCheck.erro });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await pool.query(
      'UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [senhaHash, rows[0].id]
    );

    await pool.query(
      `
      UPDATE usuario_sessoes
      SET revogado_em = NOW(), motivo_revogacao = 'password_reset'
      WHERE usuario_id = $1
        AND revogado_em IS NULL
      `,
      [rows[0].id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao redefinir senha.' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(FRONTEND_DIR, 'manifest.webmanifest'));
});

app.get('/sw.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(FRONTEND_DIR, 'sw.js'));
});

app.get('/offline', (_req, res) => sendHtml(res, 'offline.html'));
app.get('/legal/politica-privacidade', (_req, res) => sendHtml(res, 'politica-de-privacidade.html'));
app.get('/legal/termos-de-uso', (_req, res) => sendHtml(res, 'termos-de-uso.html'));
app.get('/legal/acessibilidade', (_req, res) => sendHtml(res, 'acessibilidade-e-inclusao.html'));

app.get('/login', (req, res) => sendHtml(res, 'login.html'));
app.get('/login-ti', (req, res) => sendHtml(res, 'login-ti.html'));
app.get('/inscricao', (req, res) => sendHtml(res, 'regras.html'));
app.get('/registro', (req, res) => sendHtml(res, 'area-matricula.html'));
app.get('/cadastro-membros', (req, res) => sendHtml(res, 'cadastro-membros.html'));
app.get('/cadastro-fundadores', (req, res) => sendHtml(res, 'cadastro-fundadores-bootstrap.html'));
app.get('/cadastro-neofitos', (req, res) => sendHtml(res, 'cadastro-neofitos.html'));
app.get('/cadastro-magos-n1', (req, res) => sendHtml(res, 'cadastro-magos-n1.html'));
app.get('/cadastro-magos-n2', (req, res) => sendHtml(res, 'cadastro-magos-n2.html'));
app.get('/cadastro-sabios', (req, res) => sendHtml(res, 'cadastro-sabios.html'));
app.get('/cadastro-ti', (req, res) => sendHtml(res, 'cadastro-ti.html'));
app.get('/recuperar-senha', (req, res) => sendHtml(res, 'recuperar-senha.html'));
app.get('/recuperar-senha', (req, res) => sendHtml(res, 'recuperar-senha.html'));
app.get('/recuperar-usuario', (req, res) => sendHtml(res, 'esqueci-minha-senha.html'));
app.get('/redefinir-senha', (req, res) => sendHtml(res, 'redefinir-senha.html'));
app.get('/dashboard', (req, res) => sendHtml(res, 'dashboard.html'));
app.get('/dashboard-TI', (req, res) => sendHtml(res, 'dashboard-TI.html'));
app.get('/dashboard-ti', (req, res) => sendHtml(res, 'dashboard-TI.html'));
app.get('/dashboard-aluno', (req, res) => sendHtml(res, 'dashboard-aluno.html'));
app.get('/dashboard-professor', (req, res) => sendHtml(res, 'dashboard-professor.html'));
app.get('/dashboard-cliente', (req, res) => sendHtml(res, 'dashboard-cliente.html'));
app.get('/dashboard-lojista', (req, res) => sendHtml(res, 'dashboard-lojista.html'));
app.get('/manutencao-ti', (req, res) => sendHtml(res, 'manutencao-ti.html'));
app.get('/ti/admin/master', (req, res) => sendHtml(res, 'area-adm-1.html'));
app.get('/ti/admin/anexos', (req, res) => sendHtml(res, 'area-anexar-arquivos.html'));
app.get('/ti/admin/financeiro', (req, res) => sendHtml(res, 'admin-financeiro.html'));
app.get('/ti/admin/aprovacao-registro', (req, res) => sendHtml(res, 'aprovacao-de-registro.html'));
app.get('/ti/professor/anexos', (req, res) => sendHtml(res, 'area-professor-anexos.html'));
app.get('/ti/financeiro/aluno', (req, res) => sendHtml(res, 'area-financeira-aluno.html'));
app.get('/ti/financeiro/professor', (req, res) => sendHtml(res, 'area-financeira-professor.html'));
app.get('/regras', (req, res) => sendHtml(res, 'regras.html'));
app.get('/loja', (req, res) => sendHtml(res, 'loja.html'));
app.get('/recolhimento-de-dados', (req, res) => sendHtml(res, 'recolhimento-de-dados.html'));
app.get('/loja/carrinho', (req, res) => sendHtml(res, 'carrinho-de-compra.html'));
app.get('/loja/checkout', (req, res) => sendHtml(res, 'recolhimento-de-dados-de-pagamento.html'));
app.get('/loja/compra-aprovada', (req, res) => sendHtml(res, 'compra-aprovada.html'));
app.get('/loja/compra-recusada', (req, res) => sendHtml(res, 'compra-recusada.html'));
app.get('/loja/reembolso-e-logistica', (req, res) => sendHtml(res, 'reembolso-e-logistica.html'));
app.get('/logistica/rastreio', (req, res) => sendHtml(res, 'rastreio-correios.html'));
app.get('/lojista/produtos', (req, res) => sendHtml(res, 'cadastro-produtos.html'));
app.get('/loja/cadastro-produtos', (req, res) => sendHtml(res, 'cadastro-produtos.html'));
app.get('/live/central', (req, res) => sendHtml(res, 'live-center.html'));
app.get('/live/reunioes', (req, res) => sendHtml(res, 'reunioes-daily.html'));
app.get('/central-operacoes', (req, res) => sendHtml(res, 'central-operacoes.html'));
app.get('/painel-operacional', (req, res) => sendHtml(res, 'painel-operacional.html'));
app.get('/biblioteca', (req, res) => sendHtml(res, 'biblioteca-livros.html'));
app.get('/biblioteca/livros-view', (req, res) => sendHtml(res, 'biblioteca-livros.html'));
app.get('/acompanhamento', (req, res) => sendHtml(res, 'acompanhamento.html'));
app.get('/diario', (req, res) => sendHtml(res, 'diario.html'));
app.get('/grimorio', (req, res) => sendHtml(res, 'grimorio.html'));
app.get('/inscricao-finalizar', (req, res) => sendHtml(res, 'inscrição-finalizar.html'));
app.get('/inscrição-finalizar', (req, res) => sendHtml(res, 'inscrição-finalizar.html'));
app.get('/admin', (req, res) => res.redirect('/admin/master'));
app.get('/admin/master', (req, res) => sendHtml(res, 'area-adm-1.html'));
app.get('/admin/financeiro', (req, res) => sendHtml(res, 'admin-financeiro.html'));
app.get('/financeiro/aluno', (req, res) => sendHtml(res, 'area-financeira-aluno.html'));
app.get('/financeiro/professor', (req, res) => sendHtml(res, 'area-financeira-professor.html'));
app.get('/admin/aprovacao-registro', (req, res) => sendHtml(res, 'aprovacao-de-registro.html'));
app.get('/admin/aprovacao-de-registro', (req, res) => sendHtml(res, 'aprovacao-de-registro.html'));
app.get('/admin/anexos', (req, res) => sendHtml(res, 'area-anexar-arquivos.html'));
app.get('/admin/loja/produtos', (req, res) => sendHtml(res, 'admin-loja-produtos.html'));
app.get('/professor/area-anexos', (req, res) => sendHtml(res, 'area-professor-anexos.html'));

app.get('/admin/biblioteca', (req, res) => sendHtml(res, 'admin-biblioteca.html'));
app.get('/admin/biblioteca', (req, res) => sendHtml(res, 'admin-biblioteca.html'));

async function startServer() {
  try {
    await Promise.all([
      ensureDisciplineSchema(),
      ensureAcademicSchema(),
      ensureUserTypeSchema(),
      ensurePlatformSchema(),
      ensureUniversalArchiveTable()
    ]);

    await ensureCoreSystemUsers();
    await initializeBibliotecaTemas();
    await initializeBibliotecaLivros();

    const port = Number(process.env.PORT || 3000);
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Servidor em http://0.0.0.0:${port}`);
    });
    // Hardening contra conexoes lentas e ocupacao excessiva de sockets.
    server.requestTimeout = 30 * 1000;
    server.headersTimeout = 35 * 1000;
    server.keepAliveTimeout = 10 * 1000;
  } catch (error) {
    const diagnostic =
      error?.message
      || error?.code
      || (typeof error === 'string' ? error : JSON.stringify(error));
    console.error('Falha ao garantir schemas:', diagnostic);
    process.exit(1);
  }
}

startServer();
