import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();

app.use(express.json());

const users = new Map();
const roles = new Set(['admin', 'usuario']);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function findUserByEmail(email) {
  for (const user of users.values()) {
    if (user.email === email) return user;
  }

  return null;
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
      role: role || 'usuario'
    }
  };
}

app.get('/', (_req, res) => {
  res.json({
    name: 'ordo-caoti-backend',
    status: 'ok',
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
  res.json({ ok: true });
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

app.get(['/usuarios', '/users'], (_req, res) => {
  res.json({ users: Array.from(users.values()).map(serializeUser) });
});

app.post(['/usuarios', '/users'], (req, res) => {
  const { errors, values } = validateUserPayload(req.body || {});

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  if (findUserByEmail(values.email)) {
    return res.status(409).json({ errors: ['Já existe um usuário com este email.'] });
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    name: values.name,
    email: values.email,
    role: values.role,
    createdAt: now,
    updatedAt: now
  };

  users.set(user.id, user);

  return res.status(201).json({ user: serializeUser(user) });
});

app.get(['/usuarios/:id', '/users/:id'], (req, res) => {
  const user = users.get(req.params.id);

  if (!user) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  return res.json({ user: serializeUser(user) });
});

app.patch(['/usuarios/:id', '/users/:id'], (req, res) => {
  const user = users.get(req.params.id);

  if (!user) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  const { errors, values } = validateUserPayload(req.body || {}, { partial: true });

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  if (values.email && values.email !== user.email && findUserByEmail(values.email)) {
    return res.status(409).json({ errors: ['Já existe um usuário com este email.'] });
  }

  if (values.name) user.name = values.name;
  if (values.email) user.email = values.email;
  if (values.role) user.role = values.role;
  user.updatedAt = new Date().toISOString();

  return res.json({ user: serializeUser(user) });
});

app.delete(['/usuarios/:id', '/users/:id'], (req, res) => {
  if (!users.has(req.params.id)) {
    return res.status(404).json({ errors: ['Usuário não encontrado.'] });
  }

  users.delete(req.params.id);
  return res.status(204).send();
});

app.use((_req, res) => {
  res.status(404).json({ errors: ['Rota não encontrada.'] });
});

export default app;

if (process.env.NODE_ENV !== 'production' && process.argv[1]?.endsWith('index.js')) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Backend rodando em http://localhost:${port}`);
  });
}
