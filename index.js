import express from 'express';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const app = express();

app.use(express.json());

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

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let schemaReady;
let seedReady;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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
      await sql`
        INSERT INTO users (id, name, email, role)
        VALUES (${randomUUID()}, ${user.name}, ${normalizeEmail(user.email)}, ${user.role})
        ON CONFLICT (email) DO UPDATE
        SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
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
      'GET /usuarios-principais'
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
