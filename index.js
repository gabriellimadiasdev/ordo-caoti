import express from 'express';
import { readFile } from 'node:fs/promises';
import crypto, { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const roleHierarchy = {
  mestre: {
    level: 100,
    label: 'Mestre',
    legacyLabels: [],
    permissions: ['*']
  },
  ti: {
    level: 90,
    label: 'T.I.',
    legacyLabels: [],
    permissions: ['health:read', 'users:request_create', 'users:impersonate_lower_roles', 'integrations:read']
  },
  soberano: {
    level: 80,
    label: 'Soberano',
    legacyLabels: ['Sábio', 'Mago N3', 'Mago nível 3'],
    permissions: ['users:create', 'users:read', 'users:update', 'roles:read']
  },
  elevado: {
    level: 60,
    label: 'Elevado',
    legacyLabels: ['Mago nível 2', 'Mago N2', 'mago n2'],
    permissions: ['users:read', 'users:update', 'roles:read']
  },
  mago_iniciado: {
    level: 40,
    label: 'Mago Iniciado',
    legacyLabels: ['Mago N1', 'mago nível 1'],
    permissions: ['users:read:self', 'roles:read']
  },
  neofito: {
    level: 10,
    label: 'Neófito',
    legacyLabels: [],
    permissions: ['users:read:self']
  }
};

const roles = new Set(Object.keys(roleHierarchy));
const seedPasswordHashes = {
  temporary: process.env.SEED_TEMP_PASSWORD_HASH || '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0',
  demo: process.env.DEMO_PASSWORD_HASH || '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea'
};
const mainUsers = [
  { name: 'Dayenne Kennedy', username: 'dayeenix', email: 'dayeekennedy@gmail.com', role: 'mestre', passwordHash: seedPasswordHashes.temporary, mustChangePassword: true },
  { name: 'Caio Eckert dos Santos Zanoni', username: 'delerix', email: 'contatocaiozanoni@gmail.com', role: 'mestre', passwordHash: seedPasswordHashes.temporary, mustChangePassword: true },
  { name: 'Gabriel Lima Dias Rocha', username: 'Luminis Luxblade', email: 'g.lima.rocha90@gmail.com', role: 'ti', passwordHash: seedPasswordHashes.temporary, mustChangePassword: true, canImpersonateRoles: ['neofito', 'mago_iniciado', 'elevado', 'ti'] },
  { name: 'Usuário Demonstração', username: '666', email: 'demo@demo.com', role: 'neofito', passwordHash: seedPasswordHashes.demo, mustChangePassword: false }
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

function hasRoleAtLeast(user, role) {
  return (roleHierarchy[user?.role]?.level || 0) >= (roleHierarchy[role]?.level || 0);
}

function canTiImpersonateRole(role) {
  return ['neofito', 'mago_iniciado', 'elevado', 'ti'].includes(role);
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
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
        username TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'neofito',
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

    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE`;
    await sql`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'neofito'`;
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
    await sql`
      UPDATE users
      SET role = CASE
        WHEN role IN ('super_admin', 'admin') THEN 'mestre'
        WHEN role = 'gerente' THEN 'elevado'
        WHEN role = 'moderador' THEN 'mago_iniciado'
        WHEN role = 'usuario' THEN 'neofito'
        ELSE role
      END
    `;
    await sql`
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('mestre', 'ti', 'soberano', 'elevado', 'mago_iniciado', 'neofito'))
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        must_change_password BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS admin_approval_requests (
        id UUID PRIMARY KEY,
        requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ
      )
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
        INSERT INTO users (id, name, username, email, role)
        VALUES (${randomUUID()}, ${user.name}, ${user.username}, ${normalizeEmail(user.email)}, ${user.role})
        ON CONFLICT (email) DO UPDATE
        SET
          name = EXCLUDED.name,
          username = EXCLUDED.username,
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

      await sql`
        INSERT INTO user_credentials (user_id, password_hash, must_change_password)
        VALUES (${saved.id}, ${user.passwordHash}, ${Boolean(user.mustChangePassword)})
        ON CONFLICT (user_id) DO UPDATE
        SET
          password_hash = EXCLUDED.password_hash,
          must_change_password = user_credentials.must_change_password OR EXCLUDED.must_change_password,
          updated_at = NOW()
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
      role: role ?? (partial ? undefined : 'neofito')
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

const publicEndpoints = [
  'GET /health',
  'GET /api/status',
  'GET /status',
  'GET /ti/login',
  'GET /biblioteca',
  'GET /portability/manifest',
  'GET /catalog/items',
  'GET /meetings'
];

function landingPage() {
  const dbStatus = sql ? '<span class="status ok">Banco configurado</span>' : '<span class="status warn">Banco pendente</span>';
  return htmlPage('Ordo Caoti', `
    <section class="hero card">
      <p class="muted">Plataforma Ordo Caoti</p>
      <h1>Portal operacional, loja, biblioteca e sala digital</h1>
      <p class="muted">Backend ativo na Vercel com módulos de usuários, T.I., biblioteca, loja, pagamentos, aulas/reuniões e integrações configuráveis.</p>
      <p>${dbStatus}</p>
      <div class="actions">
        <a class="button" href="/ti/login">Entrar na área de T.I.</a>
        <a class="button secondary" href="/biblioteca">Abrir biblioteca</a>
        <a class="button secondary" href="/status">Ver status</a>
      </div>
    </section>
    <section class="grid" style="margin-top: 18px;">
      <div class="card"><h2>Loja</h2><p>Produtos, serviços, pedidos, Mercado Pago, Mercado Livre, frete e repasse a vendedores.</p></div>
      <div class="card"><h2>Sala digital</h2><p>Aulas, reuniões, chat, lousa, reações, provas, gravações e salas paralelas.</p></div>
      <div class="card"><h2>Biblioteca</h2><p>Livros, materiais, embeds autorizados e fontes científicas como SciELO e PubMed.</p></div>
      <div class="card"><h2>Governança</h2><p>Hierarquia Mestre, T.I., Soberano, Elevado, Mago Iniciado e Neófito com aprovação de Mestres.</p></div>
    </section>
    <section class="card" style="margin-top: 18px;">
      <h2>Configuração pendente</h2>
      <p class="muted">Se o painel indicar banco pendente, aceite os termos da Neon e conecte a variável <code>DATABASE_URL</code> em produção. A página inicial continuará funcionando enquanto isso.</p>
    </section>`);
}

app.get('/', asyncRoute(async (_req, res) => {
  try {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    return res.type('html').send(html);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return res.type('html').send(landingPage());
  }
}));

app.get('/api/status', (_req, res) => {
  res.json({
    name: 'ordo-caoti-backend',
    status: 'ok',
    database: sql ? 'configured' : 'missing_DATABASE_URL',
    endpoints: publicEndpoints
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

const commerceIntegrations = {
  mercado_pago: {
    label: 'Mercado Pago',
    accessTokenEnv: 'MERCADO_PAGO_ACCESS_TOKEN',
    publicKeyEnv: 'MERCADO_PAGO_PUBLIC_KEY',
    webhookSecretEnv: 'MERCADO_PAGO_WEBHOOK_SECRET'
  },
  mercado_livre: {
    label: 'Mercado Livre',
    clientIdEnv: 'MERCADO_LIVRE_CLIENT_ID',
    clientSecretEnv: 'MERCADO_LIVRE_CLIENT_SECRET',
    accessTokenEnv: 'MERCADO_LIVRE_ACCESS_TOKEN',
    refreshTokenEnv: 'MERCADO_LIVRE_REFRESH_TOKEN'
  },
  generic_store: {
    label: 'Loja genérica',
    apiUrlEnv: 'STORE_API_URL',
    apiKeyEnv: 'STORE_API_KEY'
  },
  pos: {
    label: 'Venda presencial',
    apiUrlEnv: 'POS_API_URL',
    apiKeyEnv: 'POS_API_KEY'
  }
};

const classroomProviders = {
  daily: {
    label: 'Daily.co',
    apiKeyEnv: 'DAILY_API_KEY',
    apiUrl: 'https://api.daily.co/v1'
  },
  livekit: {
    label: 'LiveKit',
    apiUrlEnv: 'LIVEKIT_API_URL',
    apiKeyEnv: 'LIVEKIT_API_KEY',
    apiSecretEnv: 'LIVEKIT_API_SECRET'
  },
  generic_video: {
    label: 'Provedor de vídeo genérico',
    apiUrlEnv: 'VIDEO_PROVIDER_API_URL',
    apiKeyEnv: 'VIDEO_PROVIDER_API_KEY'
  }
};


function isCommerceConfigured(provider) {
  const config = commerceIntegrations[provider];
  if (!config) return false;
  if (provider === 'mercado_pago') return Boolean(process.env[config.accessTokenEnv]);
  if (provider === 'mercado_livre') return Boolean(process.env[config.accessTokenEnv] || (process.env[config.clientIdEnv] && process.env[config.clientSecretEnv]));
  return Boolean(process.env[config.apiUrlEnv] && process.env[config.apiKeyEnv]);
}

function isClassroomProviderConfigured(provider) {
  const config = classroomProviders[provider];
  if (!config) return false;
  if (provider === 'daily') return Boolean(process.env[config.apiKeyEnv]);
  if (provider === 'livekit') return Boolean(process.env[config.apiUrlEnv] && process.env[config.apiKeyEnv] && process.env[config.apiSecretEnv]);
  return Boolean(process.env[config.apiUrlEnv] && process.env[config.apiKeyEnv]);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function createMercadoPagoPreference(order) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) return null;

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      external_reference: order.id,
      items: order.items.map(item => ({
        id: item.item_id,
        title: item.name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        currency_id: order.currency || 'BRL'
      })),
      back_urls: {
        success: process.env.CHECKOUT_SUCCESS_URL,
        pending: process.env.CHECKOUT_PENDING_URL,
        failure: process.env.CHECKOUT_FAILURE_URL
      },
      notification_url: process.env.MERCADO_PAGO_WEBHOOK_URL
    })
  });

  if (!response.ok) throw new Error('mercado_pago_preference_failed');
  return response.json();
}

async function createDailyRoom(meeting) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: meeting.id,
      privacy: 'private',
      properties: {
        enable_chat: true,
        enable_screenshare: true,
        enable_recording: 'cloud',
        enable_breakout_rooms: true,
        exp: Math.floor(new Date(meeting.ends_at).getTime() / 1000)
      }
    })
  });

  if (!response.ok) throw new Error('daily_room_creation_failed');
  return response.json();
}

async function ensureCommerceAndClassroomSchema() {
  await ensureSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BRL',
      inventory_quantity INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT catalog_item_type_check CHECK (type IN ('product', 'service'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sales_channels (
      id UUID PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      channel TEXT NOT NULL DEFAULT 'digital',
      status TEXT NOT NULL DEFAULT 'draft',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BRL',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BRL',
      provider_reference TEXT,
      checkout_url TEXT,
      raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meetings (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      host_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      provider TEXT NOT NULL DEFAULT 'daily',
      provider_room_id TEXT,
      join_url TEXT,
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      joined_at TIMESTAMPTZ,
      left_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meeting_rooms (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'main',
      provider_room_id TEXT,
      join_url TEXT,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT meeting_room_type_check CHECK (type IN ('main', 'breakout'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meeting_messages (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      room_id UUID REFERENCES meeting_rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS whiteboard_events (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      room_id UUID REFERENCES meeting_rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meeting_recordings (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      recording_url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meeting_reactions (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      room_id UUID REFERENCES meeting_rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reaction TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS classroom_activities (
      id UUID PRIMARY KEY,
      meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT classroom_activity_type_check CHECK (type IN ('exam', 'quiz', 'poll', 'question', 'assignment'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS classroom_responses (
      id UUID PRIMARY KEY,
      activity_id UUID NOT NULL REFERENCES classroom_activities(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      score NUMERIC(8,2),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function serializeCatalogItem(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    currency: item.currency,
    inventoryQuantity: item.inventory_quantity,
    isActive: item.is_active,
    metadata: item.metadata,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function serializeMeeting(meeting) {
  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    hostUserId: meeting.host_user_id,
    provider: meeting.provider,
    providerRoomId: meeting.provider_room_id,
    joinUrl: meeting.join_url,
    startsAt: meeting.starts_at,
    endsAt: meeting.ends_at,
    settings: meeting.settings,
    createdAt: meeting.created_at,
    updatedAt: meeting.updated_at
  };
}

app.get('/commerce/integrations', (_req, res) => {
  res.json({
    integrations: Object.entries(commerceIntegrations).map(([id, config]) => ({
      id,
      label: config.label,
      configured: isCommerceConfigured(id)
    }))
  });
});

app.get('/catalog/items', asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const items = await sql`SELECT * FROM catalog_items ORDER BY created_at DESC`;
  res.json({ items: items.map(serializeCatalogItem) });
}));

app.post('/catalog/items', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();

  const type = String(req.body?.type || 'product');
  const name = String(req.body?.name || '').trim();
  if (!['product', 'service'].includes(type)) return res.status(400).json({ errors: ['type deve ser product ou service.'] });
  if (!name) return res.status(400).json({ errors: ['name é obrigatório.'] });

  const saved = await sql`
    INSERT INTO catalog_items (id, type, name, description, price, currency, inventory_quantity, metadata)
    VALUES (${randomUUID()}, ${type}, ${name}, ${req.body?.description || null}, ${toNumber(req.body?.price)}, ${req.body?.currency || 'BRL'}, ${req.body?.inventoryQuantity ?? null}, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;

  res.status(201).json({ item: serializeCatalogItem(saved[0]) });
}));

app.post('/orders', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ errors: ['items é obrigatório.'] });

  const normalizedItems = items.map(item => ({
    item_id: item.itemId || null,
    name: String(item.name || 'Item'),
    quantity: Math.max(1, Number.parseInt(item.quantity || 1, 10)),
    unit_price: toNumber(item.unitPrice ?? item.price),
    metadata: item.metadata || {}
  })).map(item => ({ ...item, total: item.quantity * item.unit_price }));

  const total = normalizedItems.reduce((sum, item) => sum + item.total, 0);
  const orders = await sql`
    INSERT INTO orders (id, user_id, channel, status, subtotal, total, currency, metadata)
    VALUES (${randomUUID()}, ${req.body?.userId || null}, ${req.body?.channel || 'digital'}, 'pending_payment', ${total}, ${total}, ${req.body?.currency || 'BRL'}, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;

  for (const item of normalizedItems) {
    await sql`
      INSERT INTO order_items (id, order_id, item_id, name, quantity, unit_price, total, metadata)
      VALUES (${randomUUID()}, ${orders[0].id}, ${item.item_id}, ${item.name}, ${item.quantity}, ${item.unit_price}, ${item.total}, ${JSON.stringify(item.metadata)}::jsonb)
    `;
  }

  res.status(201).json({ order: orders[0], items: normalizedItems });
}));

app.get('/orders/:id', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const orders = await sql`SELECT * FROM orders WHERE id = ${req.params.id} LIMIT 1`;
  if (orders.length === 0) return res.status(404).json({ errors: ['Pedido não encontrado.'] });
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${req.params.id} ORDER BY created_at ASC`;
  const payments = await sql`SELECT * FROM payments WHERE order_id = ${req.params.id} ORDER BY created_at DESC`;
  res.json({ order: orders[0], items, payments });
}));

app.post('/orders/:id/payments/:provider', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();

  const provider = req.params.provider;
  if (!commerceIntegrations[provider]) return res.status(404).json({ errors: ['Provedor de pagamento/venda não suportado.'] });

  const orders = await sql`SELECT * FROM orders WHERE id = ${req.params.id} LIMIT 1`;
  if (orders.length === 0) return res.status(404).json({ errors: ['Pedido não encontrado.'] });
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${req.params.id} ORDER BY created_at ASC`;

  let providerResponse = null;
  let checkoutUrl = null;
  let status = 'pending_configuration';

  if (provider === 'mercado_pago' && isCommerceConfigured(provider)) {
    providerResponse = await createMercadoPagoPreference({ ...orders[0], items });
    checkoutUrl = providerResponse.init_point || providerResponse.sandbox_init_point || null;
    status = 'checkout_created';
  }

  const payments = await sql`
    INSERT INTO payments (id, order_id, provider, status, amount, currency, provider_reference, checkout_url, raw_response)
    VALUES (${randomUUID()}, ${orders[0].id}, ${provider}, ${status}, ${orders[0].total}, ${orders[0].currency}, ${providerResponse?.id || null}, ${checkoutUrl}, ${JSON.stringify(providerResponse || {})}::jsonb)
    RETURNING *
  `;

  res.status(201).json({ payment: payments[0], checkoutUrl, configured: isCommerceConfigured(provider) });
}));

app.post('/webhooks/mercado-pago', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  res.json({ received: true, provider: 'mercado_pago', event: req.body || {} });
}));

app.post('/webhooks/mercado-livre', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  res.json({ received: true, provider: 'mercado_livre', event: req.body || {} });
}));

app.get('/classroom/providers', (_req, res) => {
  res.json({
    providers: Object.entries(classroomProviders).map(([id, config]) => ({
      id,
      label: config.label,
      configured: isClassroomProviderConfigured(id)
    })),
    capabilities: ['audio', 'video', 'chat', 'whiteboard', 'screenshare', 'breakout_rooms', 'recording', 'backgrounds', 'appearance_filters', 'reactions', 'live_exams', 'quizzes', 'polls', 'questions']
  });
});

app.get('/meetings', asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const meetings = await sql`SELECT * FROM meetings ORDER BY starts_at DESC`;
  res.json({ meetings: meetings.map(serializeMeeting) });
}));

app.post('/meetings', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();

  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ errors: ['title é obrigatório.'] });

  const meetingId = randomUUID();
  const provider = req.body?.provider || 'daily';
  const startsAt = req.body?.startsAt || new Date().toISOString();
  const endsAt = req.body?.endsAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const baseSettings = {
    chat: true,
    whiteboard: true,
    screenshare: true,
    audio: true,
    video: true,
    breakoutRooms: true,
    recording: true,
    virtualBackgrounds: true,
    appearanceFilters: true,
    reactions: true,
    liveActivities: true,
    ...(req.body?.settings || {})
  };

  let providerRoom = null;
  if (provider === 'daily' && isClassroomProviderConfigured('daily')) {
    providerRoom = await createDailyRoom({ id: meetingId, ends_at: endsAt });
  }

  const meetings = await sql`
    INSERT INTO meetings (id, title, description, host_user_id, provider, provider_room_id, join_url, starts_at, ends_at, settings)
    VALUES (${meetingId}, ${title}, ${req.body?.description || null}, ${req.body?.hostUserId || null}, ${provider}, ${providerRoom?.id || providerRoom?.name || null}, ${providerRoom?.url || null}, ${startsAt}, ${endsAt}, ${JSON.stringify(baseSettings)}::jsonb)
    RETURNING *
  `;

  await sql`
    INSERT INTO meeting_rooms (id, meeting_id, name, type, provider_room_id, join_url, settings)
    VALUES (${randomUUID()}, ${meetingId}, 'Sala principal', 'main', ${providerRoom?.id || providerRoom?.name || null}, ${providerRoom?.url || null}, ${JSON.stringify(baseSettings)}::jsonb)
  `;

  res.status(201).json({ meeting: serializeMeeting(meetings[0]), providerConfigured: isClassroomProviderConfigured(provider) });
}));

app.get('/meetings/:id', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const meetings = await sql`SELECT * FROM meetings WHERE id = ${req.params.id} LIMIT 1`;
  if (meetings.length === 0) return res.status(404).json({ errors: ['Reunião/aula não encontrada.'] });
  const rooms = await sql`SELECT * FROM meeting_rooms WHERE meeting_id = ${req.params.id} ORDER BY created_at ASC`;
  const activities = await sql`SELECT * FROM classroom_activities WHERE meeting_id = ${req.params.id} ORDER BY created_at DESC`;
  res.json({ meeting: serializeMeeting(meetings[0]), rooms, activities });
}));

app.post('/meetings/:id/breakout-rooms', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();

  const count = Math.max(1, Number.parseInt(req.body?.count || 1, 10));
  const created = [];
  for (let index = 1; index <= count; index += 1) {
    const rooms = await sql`
      INSERT INTO meeting_rooms (id, meeting_id, name, type, settings)
      VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.prefix || 'Sala'} || ' ' || ${index}, 'breakout', ${JSON.stringify(req.body?.settings || {})}::jsonb)
      RETURNING *
    `;
    created.push(rooms[0]);
  }

  res.status(201).json({ rooms: created });
}));

app.get('/meetings/:id/messages', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const messages = await sql`SELECT * FROM meeting_messages WHERE meeting_id = ${req.params.id} ORDER BY created_at ASC`;
  res.json({ messages });
}));

app.post('/meetings/:id/messages', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ errors: ['message é obrigatório.'] });
  const saved = await sql`
    INSERT INTO meeting_messages (id, meeting_id, room_id, user_id, message)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.roomId || null}, ${req.body?.userId || null}, ${message})
    RETURNING *
  `;
  res.status(201).json({ message: saved[0] });
}));

app.post('/meetings/:id/whiteboard/events', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const saved = await sql`
    INSERT INTO whiteboard_events (id, meeting_id, room_id, user_id, event_type, payload)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.roomId || null}, ${req.body?.userId || null}, ${req.body?.eventType || 'draw'}, ${JSON.stringify(req.body?.payload || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ event: saved[0] });
}));

app.post('/meetings/:id/reactions', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const reaction = String(req.body?.reaction || '').trim();
  if (!reaction) return res.status(400).json({ errors: ['reaction é obrigatório.'] });
  const saved = await sql`
    INSERT INTO meeting_reactions (id, meeting_id, room_id, user_id, reaction)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.roomId || null}, ${req.body?.userId || null}, ${reaction})
    RETURNING *
  `;
  res.status(201).json({ reaction: saved[0] });
}));

app.post('/meetings/:id/recordings', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const saved = await sql`
    INSERT INTO meeting_recordings (id, meeting_id, provider, status, metadata)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.provider || 'daily'}, 'requested', ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;
  res.status(202).json({ recording: saved[0], providerConfigured: isClassroomProviderConfigured(req.body?.provider || 'daily') });
}));

app.post('/meetings/:id/activities', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const type = String(req.body?.type || 'quiz');
  const title = String(req.body?.title || '').trim();
  if (!['exam', 'quiz', 'poll', 'question', 'assignment'].includes(type)) return res.status(400).json({ errors: ['type inválido.'] });
  if (!title) return res.status(400).json({ errors: ['title é obrigatório.'] });
  const saved = await sql`
    INSERT INTO classroom_activities (id, meeting_id, type, title, questions, settings, starts_at, ends_at)
    VALUES (${randomUUID()}, ${req.params.id}, ${type}, ${title}, ${JSON.stringify(req.body?.questions || [])}::jsonb, ${JSON.stringify(req.body?.settings || {})}::jsonb, ${req.body?.startsAt || null}, ${req.body?.endsAt || null})
    RETURNING *
  `;
  res.status(201).json({ activity: saved[0] });
}));

app.post('/activities/:id/responses', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureCommerceAndClassroomSchema();
  const saved = await sql`
    INSERT INTO classroom_responses (id, activity_id, user_id, answers, score)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.userId || null}, ${JSON.stringify(req.body?.answers || {})}::jsonb, ${req.body?.score ?? null})
    RETURNING *
  `;
  res.status(201).json({ response: saved[0] });
}));

const itAdminEmail = process.env.IT_ADMIN_EMAIL || 'g.lima.rocha90@gmail.com';
const itSessionCookie = 'ordo_ti_session';

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { margin: 0; background: #070b13; color: #e5edf7; }
    main { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    .card { background: #101827; border: 1px solid #233047; border-radius: 18px; padding: 24px; box-shadow: 0 18px 60px rgba(0,0,0,.3); }
    h1, h2 { margin: 0 0 16px; }
    label { display: block; margin: 12px 0 6px; color: #9fb0c7; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; border: 1px solid #334155; background: #0b1220; color: #f8fafc; }
    button, .button { display: inline-block; margin-top: 16px; padding: 12px 16px; border-radius: 12px; border: 0; background: #38bdf8; color: #00111f; font-weight: 700; cursor: pointer; text-decoration: none; } .button.secondary { background: #1e293b; color: #e5edf7; border: 1px solid #334155; } .hero h1 { font-size: clamp(32px, 8vw, 72px); line-height: .95; max-width: 900px; } .actions { display: flex; flex-wrap: wrap; gap: 10px; } code { color: #7dd3fc; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .status { border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }
    .ok { background: #064e3b; color: #a7f3d0; }
    .warn { background: #713f12; color: #fde68a; }
    .fail { background: #7f1d1d; color: #fecaca; }
    pre { white-space: pre-wrap; background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 10px; border-bottom: 1px solid #233047; }
    .muted { color: #94a3b8; }
  </style>
  <script>
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  </script>
  <script defer src="/_vercel/insights/script.js"></script>
</head>
<body><main>${body}</main></body>
</html>`;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const [name, ...value] = cookie.trim().split('=');
    return [name, decodeURIComponent(value.join('='))];
  }));
}

function getItSessionSecret() {
  return process.env.IT_SESSION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'development-only-change-me';
}

function signItSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getItSessionSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyItSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getItSessionSecret()).update(body).digest('base64url');
  const provided = Buffer.from(signature || '');
  const valid = Buffer.from(expected);
  if (provided.length !== valid.length || !crypto.timingSafeEqual(provided, valid)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.email !== itAdminEmail) return null;
    return payload;
  } catch {
    return null;
  }
}

function isItAuthenticated(req) {
  return Boolean(verifyItSession(parseCookies(req)[itSessionCookie]));
}

function requireItAuth(req, res) {
  if (isItAuthenticated(req)) return true;
  res.redirect('/ti/login');
  return false;
}

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function getUserCredentialByEmail(email) {
  if (!sql) return null;
  await ensureMainUsers();
  const users = await sql`
    SELECT users.id, users.name, users.username, users.email, users.role, credentials.password_hash, credentials.must_change_password
    FROM users
    LEFT JOIN user_credentials credentials ON credentials.user_id = users.id
    WHERE users.email = ${email}
    LIMIT 1
  `;
  return users[0] || null;
}

async function verifyItPassword(email, password) {
  const user = await getUserCredentialByEmail(email);
  const submittedHash = hashPassword(password);

  if (user?.password_hash && submittedHash === user.password_hash && user.role === 'ti') {
    return { ok: true, user, mustChangePassword: Boolean(user.must_change_password) };
  }

  const configuredHash = process.env.IT_ADMIN_PASSWORD_HASH || seedPasswordHashes.temporary;
  if (email === itAdminEmail && submittedHash === configuredHash) {
    return { ok: true, user, mustChangePassword: true };
  }

  return { ok: false };
}

async function updateUserPassword(userId, password) {
  await ensureMainUsers();
  await sql`
    INSERT INTO user_credentials (user_id, password_hash, must_change_password)
    VALUES (${userId}, ${hashPassword(password)}, false)
    ON CONFLICT (user_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, must_change_password = false, updated_at = NOW()
  `;
}

async function getHealthReport(req) {
  const checks = [];
  const started = Date.now();

  checks.push({ name: 'backend', status: 'ok', message: 'Servidor Express respondeu.' });
  checks.push({ name: 'database_url', status: sql ? 'ok' : 'fail', message: sql ? 'DATABASE_URL configurada.' : 'DATABASE_URL ausente.' });

  if (sql) {
    try {
      await ensureCommerceAndClassroomSchema();
      const result = await sql`SELECT NOW() AS now`;
      checks.push({ name: 'database_connection', status: 'ok', message: `Banco respondeu em ${result[0].now}.` });
    } catch (error) {
      checks.push({ name: 'database_connection', status: 'fail', message: error.message });
    }
  }

  const envChecks = [
    ['Neon/Postgres', 'DATABASE_URL'],
    ['Google OAuth', 'GOOGLE_CLIENT_ID'],
    ['Apple OAuth', 'APPLE_CLIENT_ID'],
    ['Microsoft OAuth', 'MICROSOFT_CLIENT_ID'],
    ['Mercado Pago', 'MERCADO_PAGO_ACCESS_TOKEN'],
    ['Mercado Livre', 'MERCADO_LIVRE_ACCESS_TOKEN'],
    ['Daily vídeo', 'DAILY_API_KEY'],
    ['Segredo sessão T.I.', 'IT_SESSION_SECRET'],
    ['Senha T.I.', 'IT_ADMIN_PASSWORD_HASH']
  ];

  for (const [name, key] of envChecks) {
    checks.push({ name, status: process.env[key] ? 'ok' : 'warn', message: process.env[key] ? `${key} configurada.` : `${key} não configurada.` });
  }

  const publicUrl = process.env.SITE_HEALTH_URL || process.env.AUTH_BASE_URL || `${req.protocol}://${req.get('host')}/health`;
  try {
    const response = await fetch(publicUrl, { method: 'GET' });
    checks.push({ name: 'site_public_url', status: response.ok ? 'ok' : 'warn', message: `${publicUrl} retornou HTTP ${response.status}.` });
  } catch (error) {
    checks.push({ name: 'site_public_url', status: 'warn', message: `${publicUrl}: ${error.message}` });
  }

  return {
    ok: checks.every(check => check.status !== 'fail'),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks
  };
}

app.get('/ti/login', (req, res) => {
  if (isItAuthenticated(req)) return res.redirect('/ti');
  res.type('html').send(htmlPage('Login T.I. Ordo Caoti', `
    <div class="card" style="max-width: 460px; margin: 10vh auto 0;">
      <h1>Área de T.I.</h1>
      <p class="muted">Acesso restrito para monitorar saúde do projeto e do site.</p>
      <form method="post" action="/ti/login">
        <label>E-mail</label>
        <input name="email" type="email" value="${itAdminEmail}" autocomplete="username" required />
        <label>Senha</label>
        <input name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Entrar</button>
      </form>
      <p class="muted">Configure a senha com <code>IT_ADMIN_PASSWORD_HASH</code> ou <code>IT_ADMIN_PASSWORD</code>.</p>
    </div>`));
});

app.post('/ti/login', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const auth = await verifyItPassword(email, password);
  if (email !== itAdminEmail || !auth.ok) {
    return res.status(401).type('html').send(htmlPage('Login T.I. Ordo Caoti', `
      <div class="card" style="max-width: 460px; margin: 10vh auto 0;">
        <h1>Acesso negado</h1>
        <p class="muted">E-mail ou senha inválidos.</p>
        <a class="button" href="/ti/login">Tentar novamente</a>
      </div>`));
  }

  const token = signItSession({ email, userId: auth.user?.id, role: 'ti', mustChangePassword: auth.mustChangePassword, exp: Date.now() + 8 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `${itSessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; Secure`);
  return res.redirect(auth.mustChangePassword ? '/ti/password' : '/ti');
}));

app.get('/ti/password', (req, res) => {
  if (!requireItAuth(req, res)) return;
  res.type('html').send(htmlPage('Alterar senha T.I.', `
    <div class="card" style="max-width: 520px; margin: 10vh auto 0;">
      <h1>Alterar senha de T.I.</h1>
      <p class="muted">A senha temporária deve ser trocada no primeiro acesso.</p>
      <form method="post" action="/ti/password">
        <label>Nova senha</label>
        <input name="password" type="password" minlength="8" autocomplete="new-password" required />
        <label>Confirmar senha</label>
        <input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required />
        <button type="submit">Salvar senha</button>
      </form>
    </div>`));
});

app.post('/ti/password', asyncRoute(async (req, res) => {
  const session = verifyItSession(parseCookies(req)[itSessionCookie]);
  if (!session) return res.redirect('/ti/login');
  if (!sql) return res.status(503).type('html').send(htmlPage('Banco indisponível', '<div class="card"><h1>Banco não configurado</h1><p>Configure DATABASE_URL antes de trocar a senha.</p></div>'));
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (password.length < 8 || password !== confirmPassword) {
    return res.status(400).type('html').send(htmlPage('Alterar senha T.I.', '<div class="card"><h1>Senha inválida</h1><p>A senha precisa ter pelo menos 8 caracteres e a confirmação deve ser igual.</p><a class="button" href="/ti/password">Voltar</a></div>'));
  }
  const user = await getUserCredentialByEmail(session.email);
  if (!user?.id) return res.status(404).type('html').send(htmlPage('Usuário não encontrado', '<div class="card"><h1>Usuário não encontrado</h1></div>'));
  await updateUserPassword(user.id, password);
  const token = signItSession({ email: session.email, userId: user.id, role: 'ti', mustChangePassword: false, exp: Date.now() + 8 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `${itSessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; Secure`);
  res.redirect('/ti');
}));

app.post('/ti/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${itSessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`);
  res.redirect('/ti/login');
});

app.get('/ti/health.json', asyncRoute(async (req, res) => {
  if (!isItAuthenticated(req)) return res.status(401).json({ errors: ['Não autenticado.'] });
  res.json(await getHealthReport(req));
}));

app.get('/ti', asyncRoute(async (req, res) => {
  if (!requireItAuth(req, res)) return;
  const session = verifyItSession(parseCookies(req)[itSessionCookie]);
  if (session?.mustChangePassword) return res.redirect('/ti/password');
  const report = await getHealthReport(req);
  const rows = report.checks.map(check => `<tr><td>${check.name}</td><td><span class="status ${check.status}">${check.status}</span></td><td>${check.message}</td></tr>`).join('');
  res.type('html').send(htmlPage('Painel T.I. Ordo Caoti', `
    <div class="card">
      <h1>Painel de saúde T.I.</h1>
      <p class="muted">Gerado em ${report.generatedAt} em ${report.durationMs}ms.</p>
      <div class="grid">
        <div class="card"><h2>Status geral</h2><p><span class="status ${report.ok ? 'ok' : 'fail'}">${report.ok ? 'ok' : 'atenção'}</span></p></div>
        <div class="card"><h2>Banco</h2><p>${sql ? 'Configurado' : 'Ausente'}</p></div>
        <div class="card"><h2>Usuário T.I.</h2><p>${itAdminEmail}</p></div>
      </div>
      <h2 style="margin-top: 24px;">Checks</h2>
      <table><thead><tr><th>Item</th><th>Status</th><th>Mensagem</th></tr></thead><tbody>${rows}</tbody></table>
      <p><a class="button" href="/ti/health.json">Ver JSON</a></p>
      <form method="post" action="/ti/logout"><button type="submit">Sair</button></form>
    </div>`));
}));

app.post('/ti/users/requests', asyncRoute(async (req, res) => {
  if (!isItAuthenticated(req)) return res.status(401).json({ errors: ['Não autenticado.'] });
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const session = verifyItSession(parseCookies(req)[itSessionCookie]);
  const requestedBy = await getUserCredentialByEmail(session.email);
  const payload = {
    name: req.body?.name,
    username: req.body?.username,
    email: normalizeEmail(req.body?.email),
    role: req.body?.role || 'neofito'
  };
  if (!payload.email || !payload.name) return res.status(400).json({ errors: ['name e email são obrigatórios.'] });
  const requests = await sql`
    INSERT INTO admin_approval_requests (id, requested_by_user_id, action, payload)
    VALUES (${randomUUID()}, ${requestedBy?.id || null}, 'create_user', ${JSON.stringify(payload)}::jsonb)
    RETURNING *
  `;
  res.status(202).json({ request: requests[0], status: 'pending_master_approval' });
}));

app.get('/approval-requests', asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const requests = await sql`SELECT * FROM admin_approval_requests ORDER BY created_at DESC`;
  res.json({ requests });
}));

app.post('/approval-requests/:id/approve', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const masters = await sql`SELECT * FROM users WHERE id = ${req.body?.masterUserId} AND role = 'mestre' LIMIT 1`;
  if (masters.length === 0) return res.status(403).json({ errors: ['Somente Mestre pode aprovar esta ação.'] });
  const requests = await sql`SELECT * FROM admin_approval_requests WHERE id = ${req.params.id} AND status = 'pending' LIMIT 1`;
  if (requests.length === 0) return res.status(404).json({ errors: ['Solicitação pendente não encontrada.'] });
  const request = requests[0];
  let createdUser = null;
  if (request.action === 'create_user') {
    const payload = request.payload;
    const role = roles.has(payload.role) ? payload.role : 'neofito';
    const users = await sql`
      INSERT INTO users (id, name, username, email, role)
      VALUES (${randomUUID()}, ${payload.name}, ${payload.username || null}, ${normalizeEmail(payload.email)}, ${role})
      ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name, username = EXCLUDED.username, role = EXCLUDED.role, updated_at = NOW()
      RETURNING id, name, username, email, role, created_at, updated_at
    `;
    createdUser = users[0];
  }
  const updated = await sql`
    UPDATE admin_approval_requests
    SET status = 'approved', approved_by_user_id = ${masters[0].id}, decided_at = NOW(), target_user_id = ${createdUser?.id || request.target_user_id}
    WHERE id = ${request.id}
    RETURNING *
  `;
  res.json({ request: updated[0], user: createdUser ? serializeUser(createdUser) : null });
}));

app.post('/approval-requests/:id/reject', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const masters = await sql`SELECT id FROM users WHERE id = ${req.body?.masterUserId} AND role = 'mestre' LIMIT 1`;
  if (masters.length === 0) return res.status(403).json({ errors: ['Somente Mestre pode rejeitar esta ação.'] });
  const updated = await sql`
    UPDATE admin_approval_requests
    SET status = 'rejected', approved_by_user_id = ${masters[0].id}, decided_at = NOW()
    WHERE id = ${req.params.id} AND status = 'pending'
    RETURNING *
  `;
  if (updated.length === 0) return res.status(404).json({ errors: ['Solicitação pendente não encontrada.'] });
  res.json({ request: updated[0] });
}));


async function ensureAdvancedSiteSchema() {
  await ensureCommerceAndClassroomSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id UUID PRIMARY KEY,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'site',
      external_id TEXT,
      notification_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS integration_import_jobs (
      id UUID PRIMARY KEY,
      requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_configuration',
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS uploaded_assets (
      id UUID PRIMARY KEY,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      related_type TEXT,
      related_id UUID,
      kind TEXT NOT NULL,
      title TEXT,
      description TEXT,
      url TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS seller_payout_accounts (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_type TEXT NOT NULL,
      account_label TEXT NOT NULL,
      payout_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shipping_quotes (
      id UUID PRIMARY KEY,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'manual',
      origin_postal_code TEXT,
      destination_postal_code TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BRL',
      delivery_estimate TEXT,
      raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS lgpd_requests (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      email TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT lgpd_request_type_check CHECK (type IN ('access', 'export', 'rectification', 'delete', 'consent_withdrawal'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS library_items (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      item_type TEXT NOT NULL DEFAULT 'book',
      access_type TEXT NOT NULL DEFAULT 'external',
      source_url TEXT,
      embed_url TEXT,
      cover_url TEXT,
      price NUMERIC(12,2),
      currency TEXT NOT NULL DEFAULT 'BRL',
      rights_status TEXT NOT NULL DEFAULT 'requires_review',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function requireMasterPayload(req, res) {
  if (!req.body?.masterUserId) {
    res.status(403).json({ errors: ['Ação exige autorização secundária de Mestre.'] });
    return null;
  }
  return req.body.masterUserId;
}

async function assertMaster(masterUserId, res) {
  const masters = await sql`SELECT id, role FROM users WHERE id = ${masterUserId} AND role = 'mestre' LIMIT 1`;
  if (masters.length === 0) {
    res.status(403).json({ errors: ['Somente Mestre pode executar ou aprovar esta ação.'] });
    return null;
  }
  return masters[0];
}

app.get('/status', (_req, res) => {
  res.type('html').send(htmlPage('Status Ordo Caoti', `
    <div class="card">
      <h1>Status público</h1>
      <p class="muted">Página responsiva de status do projeto.</p>
      <div class="grid">
        <div class="card"><h2>Backend</h2><p><span class="status ok">online</span></p></div>
        <div class="card"><h2>Health</h2><p><a class="button" href="/health">Abrir /health</a></p></div>
        <div class="card"><h2>Área T.I.</h2><p><a class="button" href="/ti/login">Login T.I.</a></p></div>
      </div>
    </div>`));
});

app.get('/agenda/integrations', (_req, res) => {
  res.json({
    integrations: [
      { id: 'gmail', configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), capability: 'envio e leitura autorizada por OAuth' },
      { id: 'google_calendar', configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), capability: 'sincronização de agenda' },
      { id: 'whatsapp', configured: Boolean(process.env.WHATSAPP_API_TOKEN), capability: 'notificações' },
      { id: 'alexa', configured: Boolean(process.env.ALEXA_SKILL_ID), capability: 'alarmes/notificações em dispositivos compatíveis' }
    ]
  });
});

app.post('/agenda/events', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const masterUserId = requireMasterPayload(req, res);
  if (!masterUserId) return;
  const master = await assertMaster(masterUserId, res);
  if (!master) return;
  const title = String(req.body?.title || '').trim();
  if (!title || !req.body?.startsAt) return res.status(400).json({ errors: ['title e startsAt são obrigatórios.'] });
  const events = await sql`
    INSERT INTO schedule_events (id, owner_user_id, title, description, starts_at, ends_at, source, notification_channels, metadata)
    VALUES (${randomUUID()}, ${master.id}, ${title}, ${req.body?.description || null}, ${req.body.startsAt}, ${req.body?.endsAt || null}, ${req.body?.source || 'site'}, ${JSON.stringify(req.body?.notificationChannels || ['gmail','google_calendar','whatsapp','alexa'])}::jsonb, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ event: events[0], deliveryStatus: 'pending_provider_configuration' });
}));

app.post('/imports/:provider', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const master = await assertMaster(req.body?.masterUserId, res);
  if (!master) return;
  const provider = req.params.provider;
  if (!['google_drive', 'google_classroom', 'gmail', 'google_calendar'].includes(provider)) return res.status(400).json({ errors: ['provider inválido.'] });
  const jobs = await sql`
    INSERT INTO integration_import_jobs (id, requested_by_user_id, provider, source, filters)
    VALUES (${randomUUID()}, ${master.id}, ${provider}, ${req.body?.source || provider}, ${JSON.stringify(req.body?.filters || {})}::jsonb)
    RETURNING *
  `;
  res.status(202).json({ job: jobs[0], status: 'pending_oauth_provider_configuration' });
}));

app.post('/uploads/assets', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const kind = String(req.body?.kind || 'file');
  const assets = await sql`
    INSERT INTO uploaded_assets (id, owner_user_id, related_type, related_id, kind, title, description, url, mime_type, size_bytes, metadata)
    VALUES (${randomUUID()}, ${req.body?.ownerUserId || null}, ${req.body?.relatedType || null}, ${req.body?.relatedId || null}, ${kind}, ${req.body?.title || null}, ${req.body?.description || null}, ${req.body?.url || null}, ${req.body?.mimeType || null}, ${req.body?.sizeBytes || null}, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ asset: assets[0], storageRecommendation: 'Use Vercel Blob para arquivos, imagens, fotos e gravações.' });
}));

app.post('/catalog/items/:id/assets', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const assets = await sql`
    INSERT INTO uploaded_assets (id, owner_user_id, related_type, related_id, kind, title, description, url, mime_type, metadata)
    VALUES (${randomUUID()}, ${req.body?.ownerUserId || null}, 'catalog_item', ${req.params.id}, ${req.body?.kind || 'image'}, ${req.body?.title || null}, ${req.body?.description || null}, ${req.body?.url || null}, ${req.body?.mimeType || null}, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ asset: assets[0] });
}));

app.post('/sellers/:userId/payout-accounts', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const accounts = await sql`
    INSERT INTO seller_payout_accounts (id, user_id, provider, account_type, account_label, payout_config, is_verified)
    VALUES (${randomUUID()}, ${req.params.userId}, ${req.body?.provider || 'bank'}, ${req.body?.accountType || 'bank_account'}, ${req.body?.accountLabel || 'Conta de repasse'}, ${JSON.stringify(req.body?.payoutConfig || {})}::jsonb, false)
    RETURNING id, user_id, provider, account_type, account_label, is_verified, created_at, updated_at
  `;
  res.status(201).json({ payoutAccount: accounts[0], security: 'Dados sensíveis devem ser tokenizados pelo provedor de pagamento.' });
}));

app.post('/orders/:id/shipping-quotes', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const amount = toNumber(req.body?.amount);
  const quotes = await sql`
    INSERT INTO shipping_quotes (id, order_id, provider, origin_postal_code, destination_postal_code, amount, currency, delivery_estimate, raw_response)
    VALUES (${randomUUID()}, ${req.params.id}, ${req.body?.provider || 'manual'}, ${req.body?.originPostalCode || null}, ${req.body?.destinationPostalCode || null}, ${amount}, ${req.body?.currency || 'BRL'}, ${req.body?.deliveryEstimate || null}, ${JSON.stringify(req.body?.rawResponse || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ shippingQuote: quotes[0] });
}));

app.post('/lgpd/requests', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const email = normalizeEmail(req.body?.email);
  const type = String(req.body?.type || 'access');
  if (!email || !['access', 'export', 'rectification', 'delete', 'consent_withdrawal'].includes(type)) return res.status(400).json({ errors: ['email/type inválidos.'] });
  const requests = await sql`
    INSERT INTO lgpd_requests (id, user_id, email, type, payload)
    VALUES (${randomUUID()}, ${req.body?.userId || null}, ${email}, ${type}, ${JSON.stringify(req.body?.payload || {})}::jsonb)
    RETURNING *
  `;
  res.status(202).json({ request: requests[0], privacy: 'Solicitação registrada para tratamento seguro conforme LGPD.' });
}));

app.get('/biblioteca', asyncRoute(async (_req, res) => {
  const links = [
    ['SciELO', '/biblioteca/fontes/scielo'],
    ['PubMed', '/biblioteca/fontes/pubmed'],
    ['Google Scholar', '/biblioteca/fontes/google-scholar']
  ].map(([label, href]) => `<a class="button" href="${href}">${label}</a>`).join(' ');
  res.type('html').send(htmlPage('Biblioteca Ordo Caoti', `
    <div class="card">
      <h1>Biblioteca</h1>
      <p class="muted">Livros, artigos e materiais com revisão de direitos/autorização antes de venda ou incorporação por embed/iframe.</p>
      <div class="grid">
        <div class="card"><h2>Comprar livros</h2><p>Use produtos do catálogo com tipo livro/material.</p></div>
        <div class="card"><h2>Embed legal</h2><p>Apenas materiais próprios, licenciados, domínio público ou com autorização.</p></div>
        <div class="card"><h2>Fontes científicas</h2><p>${links}</p></div>
      </div>
    </div>`));
}));

app.post('/biblioteca/items', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureAdvancedSiteSchema();
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ errors: ['title é obrigatório.'] });
  const items = await sql`
    INSERT INTO library_items (id, title, author, description, item_type, access_type, source_url, embed_url, cover_url, price, currency, rights_status, metadata)
    VALUES (${randomUUID()}, ${title}, ${req.body?.author || null}, ${req.body?.description || null}, ${req.body?.itemType || 'book'}, ${req.body?.accessType || 'external'}, ${req.body?.sourceUrl || null}, ${req.body?.embedUrl || null}, ${req.body?.coverUrl || null}, ${req.body?.price ?? null}, ${req.body?.currency || 'BRL'}, ${req.body?.rightsStatus || 'requires_review'}, ${JSON.stringify(req.body?.metadata || {})}::jsonb)
    RETURNING *
  `;
  res.status(201).json({ item: items[0], legalNotice: 'Hospede/iframe apenas conteúdo próprio, licenciado, domínio público ou autorizado.' });
}));

app.get('/biblioteca/fontes/:source', (req, res) => {
  const sources = {
    scielo: 'https://www.scielo.br/',
    pubmed: 'https://pubmed.ncbi.nlm.nih.gov/',
    'google-scholar': 'https://scholar.google.com/'
  };
  const target = sources[req.params.source];
  if (!target) return res.status(404).json({ errors: ['Fonte não encontrada.'] });
  res.redirect(target);
});

app.get('/portability/manifest', (_req, res) => {
  res.json({
    backend: 'Node.js/Express on Vercel Functions',
    apiStyle: 'REST/JSON',
    database: 'Postgres via DATABASE_URL',
    frontendTargets: ['HTML responsivo', 'React', 'Angular', 'Vue', 'Svelte'],
    backendTargets: ['Node.js', 'Ruby', 'Python', 'PHP', 'Go'],
    notes: ['Contratos REST documentados pelas rotas.', 'Migração para outros frontends consome os mesmos endpoints JSON.']
  });
});


app.post('/auth/password/login', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const login = normalizeEmail(req.body?.email || req.body?.username);
  const users = await sql`
    SELECT users.id, users.name, users.username, users.email, users.role, credentials.password_hash, credentials.must_change_password
    FROM users
    LEFT JOIN user_credentials credentials ON credentials.user_id = users.id
    WHERE users.email = ${login} OR users.username = ${String(req.body?.username || '')}
    LIMIT 1
  `;
  const user = users[0];
  if (!user?.password_hash || user.password_hash !== hashPassword(String(req.body?.password || ''))) {
    return res.status(401).json({ errors: ['Credenciais inválidas.'] });
  }
  const sessionToken = signItSession({ email: user.email, userId: user.id, role: user.role, mustChangePassword: Boolean(user.must_change_password), exp: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ user: serializeUser(user), sessionToken, mustChangePassword: Boolean(user.must_change_password) });
}));

app.post('/auth/password/change', asyncRoute(async (req, res) => {
  if (!validateDatabase(res)) return;
  await ensureMainUsers();
  const session = verifyItSession(String(req.body?.sessionToken || ''));
  if (!session?.userId) return res.status(401).json({ errors: ['Sessão inválida.'] });
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (password.length < 8 || password !== confirmPassword) return res.status(400).json({ errors: ['Senha inválida ou confirmação divergente.'] });
  await updateUserPassword(session.userId, password);
  res.json({ ok: true });
}));

app.post('/ti/impersonate', asyncRoute(async (req, res) => {
  if (!isItAuthenticated(req)) return res.status(401).json({ errors: ['Não autenticado.'] });
  const targetRole = String(req.body?.role || '');
  if (!canTiImpersonateRole(targetRole)) return res.status(403).json({ errors: ['T.I. só pode simular Neófito, Mago Iniciado, Elevado ou T.I.'] });
  const session = verifyItSession(parseCookies(req)[itSessionCookie]);
  const token = signItSession({ email: session.email, userId: session.userId, role: targetRole, impersonatedBy: 'ti', exp: Date.now() + 60 * 60 * 1000 });
  res.json({ role: targetRole, sessionToken: token });
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
