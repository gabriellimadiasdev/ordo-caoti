import express from 'express';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const app = express();

app.use(express.json());

const roles = new Set(['admin', 'usuario']);
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let schemaReady;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
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

  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'usuario',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_role_check CHECK (role IN ('admin', 'usuario'))
    )
  `;

  await schemaReady;
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
      'GET /funcoes'
    ]
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, database: Boolean(sql) });
});

app.get('/funcoes', (_req, res) => {
  res.json({
    roles: Array.from(roles),
    functions: [
      { method: 'GET', path: '/usuarios', description: 'Lista usuários cadastrados.' },
      { method: 'POST', path: '/usuarios', description: 'Cria usuário com name, email e role opcional.' },
      { method: 'GET', path: '/usuarios/:id', description: 'Busca usuário por id.' },
      { method: 'PATCH', path: '/usuarios/:id', description: 'Atualiza name, email ou role.' },
      { method: 'DELETE', path: '/usuarios/:id', description: 'Remove usuário.' }
    ]
  });
});

app.get(['/usuarios', '/users'], asyncRoute(async (_req, res) => {
  if (!validateDatabase(res)) return;

  await ensureSchema();
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

  await ensureSchema();

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

  await ensureSchema();
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

  await ensureSchema();

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

  await ensureSchema();
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
