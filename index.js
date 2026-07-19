import express from 'express';
import crypto, { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const roleHierarchy = {
  super_admin: {
    level: 100,
    label: 'Super Administrador',
    permissions: ['*']
  },
  admin: {
    level: 80,
    label: 'Administrador',
    permissions: ['users:create', 'users:read', 'users:update', 'users:delete', 'roles:read']
  },
  gerente: {
    level: 60,
    label: 'Gerente',
    permissions: ['users:create', 'users:read', 'users:update', 'roles:read']
  },
  moderador: {
    level: 40,
    label: 'Moderador',
    permissions: ['users:read', 'users:update', 'roles:read']
  },
  usuario: {
    level: 10,
    label: 'Usuário',
    permissions: ['users:read:self']
  }
};

const roles = new Set(Object.keys(roleHierarchy));
const mainUsers = [
  { name: 'Gabriel Lima', email: 'admin@ordocaoti.com.br', role: 'super_admin' },
  { name: 'Administrador Ordo Caoti', email: 'administrador@ordocaoti.com.br', role: 'admin' },
  { name: 'Gerente Ordo Caoti', email: 'gerente@ordocaoti.com.br', role: 'gerente' },
  { name: 'Moderador Ordo Caoti', email: 'moderador@ordocaoti.com.br', role: 'moderador' }
];

const oauthProviders = {
  google: {
    label: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET'
  },
  apple: {
    label: 'Apple',
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userInfoUrl: null,
    scope: 'name email',
    clientIdEnv: 'APPLE_CLIENT_ID',
    clientSecretEnv: 'APPLE_CLIENT_SECRET'
  },
  microsoft: {
    label: 'Microsoft',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile User.Read',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET'
  },
  github: {
    label: 'GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET'
  },
  oidc: {
    label: 'OIDC Personalizado',
    authorizationUrl: process.env.OIDC_AUTHORIZATION_URL || '',
    tokenUrl: process.env.OIDC_TOKEN_URL || '',
    userInfoUrl: process.env.OIDC_USERINFO_URL || '',
    scope: process.env.OIDC_SCOPE || 'openid email profile',
    clientIdEnv: 'OIDC_CLIENT_ID',
    clientSecretEnv: 'OIDC_CLIENT_SECRET'
  }
};

const mfaMethods = new Set(['totp', 'sms', 'whatsapp']);
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let schemaReady;
let seedReady;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}


function getBaseUrl(req) {
  return process.env.AUTH_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function isProviderConfigured(provider) {
  const config = oauthProviders[provider];
  return Boolean(config && config.authorizationUrl && config.tokenUrl && process.env[config.clientIdEnv] && process.env[config.clientSecretEnv]);
}

function publicProvider(provider) {
  const config = oauthProviders[provider];
  return {
    id: provider,
    label: config.label,
    configured: isProviderConfigured(provider),
    callbackPath: `/auth/${provider}/callback`
  };
}

function randomBase32(length = 32) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, byte => base32Alphabet[byte % base32Alphabet.length]).join('');
}

function decodeBase32(secret) {
  const clean = String(secret).replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';

  for (const char of clean) {
    const value = base32Alphabet.indexOf(char);
    if (value === -1) throw new Error('invalid_base32_secret');
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

function verifyTotp(secret, code) {
  const normalized = String(code || '').replace(/\s+/g, '');
  const now = Date.now();

  return [-1, 0, 1].some(step => generateTotp(secret, now + step * 30_000) === normalized);
}

function buildOtpAuthUrl({ email, secret }) {
  const issuer = 'Ordo Caoti';
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}


function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  const [, payload] = token.split('.');
  if (!payload) return {};

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function serializeRole(role) {
  return {
    id: role,
    ...roleHierarchy[role]
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    hierarchyLevel: roleHierarchy[user.role]?.level ?? 0,
    permissions: roleHierarchy[user.role]?.permissions ?? [],
    createdAt: user.created_at || user.createdAt,
    updatedAt: user.updated_at || user.updatedAt
  };
}

function validateDatabase(res) {
  if (sql) return true;

  res.status(503).json({
    errors: ['DATABASE_URL não está configurada. Conecte o banco Neon ao projeto na Vercel.']
  });
  return false;
}

async function ensureSchema() {
  if (!sql) return;

  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'usuario',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS user_emails (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS user_identities (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        email TEXT,
        profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_user_id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        redirect_uri TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS mfa_factors (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        method TEXT NOT NULL,
        target TEXT,
        secret TEXT,
        is_enabled BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT mfa_method_check CHECK (method IN ('totp', 'sms', 'whatsapp'))
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS mfa_challenges (
        id UUID PRIMARY KEY,
        factor_id UUID NOT NULL REFERENCES mfa_factors(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
    await sql`
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'admin', 'gerente', 'moderador', 'usuario'))
    `;
  })();

  await schemaReady;
}

async function ensureMainUsers() {
  if (!sql) return;

  seedReady ??= (async () => {
    await ensureSchema();

    for (const user of mainUsers) {
      const seeded = await sql`
        INSERT INTO users (id, name, email, role)
        VALUES (${randomUUID()}, ${user.name}, ${normalizeEmail(user.email)}, ${user.role})
        ON CONFLICT (email) DO UPDATE
        SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          updated_at = NOW()
        RETURNING id, email
      `;

      const saved = seeded[0];
      await sql`
        INSERT INTO user_emails (id, user_id, email, is_primary, is_verified)
        VALUES (${randomUUID()}, ${saved.id}, ${saved.email}, true, true)
        ON CONFLICT (email) DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          is_primary = true,
          is_verified = true
      `;
    }
  })();

  await seedReady;
}

function validateUserPayload(payload, { partial = false } = {}) {
  const errors = [];
  const name = typeof payload.name === 'string' ? payload.name.trim() : undefined;
  const email = payload.email === undefined ? undefined : normalizeEmail(payload.email);
  const role = payload.role === undefined ? undefined : String(payload.role).trim().toLowerCase();

  if (!partial || payload.name !== undefined) {
    if (!name) errors.push('name é obrigatório.');
  }

  if (!partial || payload.email !== undefined) {
    if (!email) {
      errors.push('email é obrigatório.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email inválido.');
    }
  }

  if (role !== undefined && !roles.has(role)) {
    errors.push(`role inválido. Use um de: ${Array.from(roles).join(', ')}.`);
  }

  return {
    errors,
    values: {
      name,
      email,
      role: role ?? (partial ? undefined : 'usuario')
    }
  };
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

app.get('/', (_req, res) => {
  res.json({
    name: 'ordo-caoti-backend',
    status: 'ok',
    database: sql ? 'configured' : 'missing_DATABASE_URL',
    endpoints: [
      'GET /health',
      'GET /usuarios',
      'POST /usuarios',
      'GET /usuarios/:id',
      'PATCH /usuarios/:id',
      'DELETE /usuarios/:id',
      'GET /funcoes',
      'GET /hierarquia',
      'GET /roles',
      'GET /usuarios-principais',
      'GET /auth/providers',
      'GET /auth/:provider/login',
      'GET /auth/:provider/callback',
      'GET/POST /usuarios/:id/emails',
      'GET /usuarios/:id/identidades',
      'GET/POST /usuarios/:id/mfa/*',
      'POST /usuarios/:id/mfa/:method/challenge',
      'POST /usuarios/:id/mfa/:method/verify'
    ]
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, database: Boolean(sql) });
});

app.get(['/roles', '/funcoes'], (_req, res) => {
  res.json({
    roles: Object.keys(roleHierarchy).map(serializeRole),
    functions: [
      { method: 'GET', path: '/usuarios', permission: 'users:read', description: 'Lista usuários cadastrados.' },
      { method: 'POST', path: '/usuarios', permission: 'users:create', description: 'Cria usuário com name, email e role opcional.' },
      { method: 'GET', path: '/usuarios/:id', permission: 'users:read', description: 'Busca usuário por id.' },
      { method: 'PATCH', path: '/usuarios/:id', permission: 'users:update', description: 'Atualiza name, email ou role.' },
      { method: 'DELETE', path: '/usuarios/:id', permission: 'users:delete', description: 'Remove usuário.' },
      { method: 'GET', path: '/hierarquia', permission: 'roles:read', description: 'Lista hierarquia de papéis.' },
      { method: 'GET', path: '/usuarios-principais', permission: 'users:read', description: 'Lista usuários principais padrão.' }
    ]
  });
});

app.get('/hierarquia', (_req, res) => {
  res.json({
    hierarchy: Object.keys(roleHierarchy)
      .map(serializeRole)
      .sort((a, b) => b.level - a.level)
  });
});

app.get('/usuarios-principais', asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const users = await sql`
    SELECT id, name, email, role, created_at, updated_at
    FROM users
    WHERE email = ANY(${mainUsers.map(user => normalizeEmail(user.email))})
    ORDER BY
      CASE role
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'gerente' THEN 3
        WHEN 'moderador' THEN 4
        ELSE 5
      END
  `;

  res.json({ users: users.map(serializeUser) });
}));

app.get('/auth/providers', (_req, res) => {
  res.json({
    providers: Object.keys(oauthProviders).map(publicProvider),
    mfaMethods: Array.from(mfaMethods),
    notes: [
      'Google, Apple, Microsoft e GitHub usam OAuth/OIDC por variáveis de ambiente.',
      'Authy e Google Authenticator usam o método TOTP.',
      'SMS e WhatsApp exigem provedor externo de envio configurado separadamente.'
    ]
  });
});

app.get('/auth/:provider/login', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const provider = req.params.provider;
  const config = oauthProviders[provider];

  if (!config) {
    return res.status(404).json({ errors: ['Provedor de login não suportado.'] });
  }

  if (!isProviderConfigured(provider)) {
    return res.status(503).json({
      errors: [`Configure ${config.clientIdEnv} e ${config.clientSecretEnv} nas variáveis de ambiente.`]
    });
  }

  await ensureMainUsers();
  const state = randomUUID();
  const redirectUri = `${getBaseUrl(req)}/auth/${provider}/callback`;
  const afterLoginRedirect = req.query.redirect_uri ? String(req.query.redirect_uri) : null;

  await sql`
    INSERT INTO oauth_states (state, provider, redirect_uri)
    VALUES (${state}, ${provider}, ${afterLoginRedirect})
  `;

  const params = new URLSearchParams({
    client_id: process.env[config.clientIdEnv],
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scope,
    state
  });

  if (provider === 'apple') {
    params.set('response_mode', 'form_post');
  }

  return res.json({ provider, authorizationUrl: `${config.authorizationUrl}?${params.toString()}`, callbackUrl: redirectUri });
}));

app.all('/auth/:provider/callback', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const provider = req.params.provider;
  const config = oauthProviders[provider];
  const code = String(req.query.code || req.body?.code || '');
  const state = String(req.query.state || req.body?.state || '');

  if (!config || !code || !state) {
    return res.status(400).json({ errors: ['Callback OAuth inválido.'] });
  }

  await ensureMainUsers();
  const states = await sql`
    DELETE FROM oauth_states
    WHERE state = ${state} AND provider = ${provider} AND created_at > NOW() - INTERVAL '10 minutes'
    RETURNING redirect_uri
  `;

  if (states.length === 0) {
    return res.status(400).json({ errors: ['State OAuth inválido ou expirado.'] });
  }

  const redirectUri = `${getBaseUrl(req)}/auth/${provider}/callback`;
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env[config.clientIdEnv],
      client_secret: process.env[config.clientSecretEnv],
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  });

  if (!tokenResponse.ok) {
    return res.status(502).json({ errors: ['Falha ao trocar código OAuth por token.'] });
  }

  const token = await tokenResponse.json();
  let profile = decodeJwtPayload(token.id_token);

  if (config.userInfoUrl && token.access_token) {
    const profileResponse = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' }
    });

    if (profileResponse.ok) profile = { ...profile, ...(await profileResponse.json()) };
  }

  const providerUserId = String(profile.sub || profile.id || token.sub || '');
  const email = normalizeEmail(profile.email || token.email || '');
  const name = String(profile.name || profile.login || email || `${config.label} User`);

  if (!providerUserId || !email) {
    return res.status(502).json({ errors: ['O provedor não retornou id/email suficientes para vincular usuário.'] });
  }

  const existingIdentity = await sql`
    SELECT user_id FROM user_identities
    WHERE provider = ${provider} AND provider_user_id = ${providerUserId}
    LIMIT 1
  `;

  let userId = existingIdentity[0]?.user_id;

  if (!userId) {
    const existingEmail = await sql`SELECT user_id FROM user_emails WHERE email = ${email} LIMIT 1`;
    userId = existingEmail[0]?.user_id;
  }

  if (!userId) {
    const created = await sql`
      INSERT INTO users (id, name, email, role)
      VALUES (${randomUUID()}, ${name}, ${email}, 'usuario')
      ON CONFLICT (email) DO UPDATE
      SET updated_at = NOW()
      RETURNING id
    `;
    userId = created[0].id;
  }

  await sql`
    INSERT INTO user_emails (id, user_id, email, is_primary, is_verified)
    VALUES (${randomUUID()}, ${userId}, ${email}, false, true)
    ON CONFLICT (email) DO UPDATE
    SET user_id = EXCLUDED.user_id, is_verified = true
  `;

  await sql`
    INSERT INTO user_identities (id, user_id, provider, provider_user_id, email, profile)
    VALUES (${randomUUID()}, ${userId}, ${provider}, ${providerUserId}, ${email}, ${JSON.stringify(profile)}::jsonb)
    ON CONFLICT (provider, provider_user_id) DO UPDATE
    SET email = EXCLUDED.email, profile = EXCLUDED.profile, updated_at = NOW()
  `;

  const users = await sql`
    SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = ${userId} LIMIT 1
  `;

  return res.json({ user: serializeUser(users[0]), provider, redirectUri: states[0].redirect_uri });
}));

app.get('/usuarios/:id/emails', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const emails = await sql`
    SELECT id, email, is_primary, is_verified, created_at
    FROM user_emails
    WHERE user_id = ${req.params.id}
    ORDER BY is_primary DESC, created_at ASC
  `;

  res.json({ emails });
}));

app.post('/usuarios/:id/emails', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ errors: ['email é obrigatório.'] });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ errors: ['email inválido.'] });

  await ensureMainUsers();
  const saved = await sql`
    INSERT INTO user_emails (id, user_id, email, is_primary, is_verified)
    VALUES (${randomUUID()}, ${req.params.id}, ${email}, false, false)
    RETURNING id, email, is_primary, is_verified, created_at
  `;

  res.status(201).json({ email: saved[0] });
}));

app.get('/usuarios/:id/identidades', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const identities = await sql`
    SELECT id, provider, provider_user_id, email, created_at, updated_at
    FROM user_identities
    WHERE user_id = ${req.params.id}
    ORDER BY created_at ASC
  `;

  res.json({ identities });
}));

app.get('/usuarios/:id/mfa', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const factors = await sql`
    SELECT id, method, target, is_enabled, created_at, updated_at
    FROM mfa_factors
    WHERE user_id = ${req.params.id}
    ORDER BY created_at ASC
  `;

  res.json({ factors });
}));

app.post('/usuarios/:id/mfa/totp/setup', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const users = await sql`SELECT email FROM users WHERE id = ${req.params.id} LIMIT 1`;
  if (users.length === 0) return res.status(404).json({ errors: ['Usuário não encontrado.'] });

  const secret = randomBase32();
  const saved = await sql`
    INSERT INTO mfa_factors (id, user_id, method, target, secret, is_enabled)
    VALUES (${randomUUID()}, ${req.params.id}, 'totp', ${users[0].email}, ${secret}, false)
    RETURNING id, method, target, is_enabled
  `;

  res.status(201).json({ factor: saved[0], secret, otpauthUri: buildOtpAuthUrl({ email: users[0].email, secret }) });
}));

app.post('/usuarios/:id/mfa/totp/verify', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const factors = await sql`
    SELECT id, secret FROM mfa_factors
    WHERE user_id = ${req.params.id} AND method = 'totp' AND id = ${req.body?.factorId}
    LIMIT 1
  `;

  if (factors.length === 0) return res.status(404).json({ errors: ['Fator TOTP não encontrado.'] });
  if (!verifyTotp(factors[0].secret, req.body?.code)) return res.status(400).json({ errors: ['Código TOTP inválido.'] });

  const enabled = await sql`
    UPDATE mfa_factors
    SET is_enabled = true, updated_at = NOW()
    WHERE id = ${factors[0].id}
    RETURNING id, method, target, is_enabled
  `;

  res.json({ factor: enabled[0] });
}));

app.post('/usuarios/:id/mfa/:method/setup', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const method = req.params.method;
  if (!['sms', 'whatsapp'].includes(method)) return res.status(404).json({ errors: ['Método MFA não suportado nesta rota.'] });
  if (!req.body?.target) return res.status(400).json({ errors: ['target é obrigatório. Informe telefone em formato internacional.'] });

  await ensureMainUsers();
  const saved = await sql`
    INSERT INTO mfa_factors (id, user_id, method, target, is_enabled)
    VALUES (${randomUUID()}, ${req.params.id}, ${method}, ${String(req.body.target)}, false)
    RETURNING id, method, target, is_enabled
  `;

  res.status(201).json({
    factor: saved[0],
    status: 'pending_sender_configuration',
    message: 'Fator criado. O envio de códigos por SMS/WhatsApp exige configurar um provedor externo de mensagens.'
  });
}));


app.post('/usuarios/:id/mfa/:method/challenge', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const method = req.params.method;
  if (!['sms', 'whatsapp'].includes(method)) return res.status(404).json({ errors: ['Método MFA não suportado nesta rota.'] });

  await ensureMainUsers();
  const factors = await sql`
    SELECT id, target FROM mfa_factors
    WHERE user_id = ${req.params.id} AND method = ${method} AND id = ${req.body?.factorId}
    LIMIT 1
  `;

  if (factors.length === 0) return res.status(404).json({ errors: ['Fator MFA não encontrado.'] });

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const challenges = await sql`
    INSERT INTO mfa_challenges (id, factor_id, code_hash, expires_at)
    VALUES (${randomUUID()}, ${factors[0].id}, ${codeHash}, NOW() + INTERVAL '10 minutes')
    RETURNING id, expires_at
  `;

  res.status(202).json({
    challenge: challenges[0],
    method,
    target: factors[0].target,
    deliveryStatus: 'pending_sender_configuration',
    message: 'Desafio criado. Configure um provedor externo para enviar o código por SMS/WhatsApp.'
  });
}));

app.post('/usuarios/:id/mfa/:method/verify', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const method = req.params.method;
  if (!['sms', 'whatsapp'].includes(method)) return res.status(404).json({ errors: ['Método MFA não suportado nesta rota.'] });

  await ensureMainUsers();
  const codeHash = crypto.createHash('sha256').update(String(req.body?.code || '')).digest('hex');
  const verified = await sql`
    UPDATE mfa_challenges challenge
    SET consumed_at = NOW()
    FROM mfa_factors factor
    WHERE challenge.id = ${req.body?.challengeId}
      AND challenge.factor_id = factor.id
      AND factor.user_id = ${req.params.id}
      AND factor.method = ${method}
      AND challenge.code_hash = ${codeHash}
      AND challenge.consumed_at IS NULL
      AND challenge.expires_at > NOW()
    RETURNING factor.id
  `;

  if (verified.length === 0) return res.status(400).json({ errors: ['Código MFA inválido ou expirado.'] });

  const enabled = await sql`
    UPDATE mfa_factors
    SET is_enabled = true, updated_at = NOW()
    WHERE id = ${verified[0].id}
    RETURNING id, method, target, is_enabled
  `;

  res.json({ factor: enabled[0] });
}));

app.get(['/usuarios', '/users'], asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const users = await sql`
    SELECT id, name, email, role, created_at, updated_at
    FROM users
    ORDER BY created_at DESC
  `;

  res.json({ users: users.map(serializeUser) });
}));

app.post(['/usuarios', '/users'], asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const { errors, values } = validateUserPayload(req.body || {});

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  await ensureMainUsers();

  const created = await sql`
    INSERT INTO users (id, name, email, role)
    VALUES (${randomUUID()}, ${values.name}, ${values.email}, ${values.role})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, name, email, role, created_at, updated_at
  `;

  if (created.length === 0) {
    return res.status(409).json({ errors: ['Já existe um usuário com este email.'] });
  }

  return res.status(201).json({ user: serializeUser(created[0]) });
}));

app.get(['/usuarios/:id', '/users/:id'], asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const users = await sql`
    SELECT id, name, email, role, created_at, updated_at
    FROM users
    WHERE id = ${req.params.id}
    LIMIT 1
  `;

  if (users.length === 0) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  return res.json({ user: serializeUser(users[0]) });
}));

app.patch(['/usuarios/:id', '/users/:id'], asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  const { errors, values } = validateUserPayload(req.body || {}, { partial: true });

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  await ensureMainUsers();

  const updates = {
    name: values.name,
    email: values.email,
    role: values.role
  };

  const users = await sql`
    UPDATE users
    SET
      name = COALESCE(${updates.name ?? null}, name),
      email = COALESCE(${updates.email ?? null}, email),
      role = COALESCE(${updates.role ?? null}, role),
      updated_at = NOW()
    WHERE id = ${req.params.id}
    RETURNING id, name, email, role, created_at, updated_at
  `;

  if (users.length === 0) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  return res.json({ user: serializeUser(users[0]) });
}));

app.delete(['/usuarios/:id', '/users/:id'], asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;

  await ensureMainUsers();
  const deleted = await sql`
    DELETE FROM users
    WHERE id = ${req.params.id}
    RETURNING id
  `;

  if (deleted.length === 0) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  return res.status(204).send();
}));

app.use((_req, res) => {
  res.status(404).json({ errors: ['Rota não encontrada.'] });
});

app.use((error, _req, res, _next) => {
  if (error?.code === '23505') {
    return res.status(409).json({ errors: ['Já existe um usuário com este email.'] });
  }

  if (error?.code === '22P02') {
    return res.status(400).json({ errors: ['Identificador inválido.'] });
  }

  if (error?.code === '23514') {
    return res.status(400).json({ errors: ['Role inválido para a hierarquia configurada.'] });
  }

  console.error(error);
  return res.status(500).json({ errors: ['Erro interno do servidor.'] });
});

export default app;

if (process.env.NODE_ENV !== 'production' && process.argv[1]?.endsWith('index.js')) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Backend rodando em http://localhost:${port}`);
  });
}
