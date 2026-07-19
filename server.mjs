import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const htmlDir = path.join(frontendDir, 'html');

const staticOptions = {
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  immutable: process.env.NODE_ENV === 'production',
};

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use('/css', express.static(path.join(frontendDir, 'css'), staticOptions));
app.use('/img', express.static(path.join(frontendDir, 'img'), staticOptions));
app.use('/js', express.static(path.join(frontendDir, 'js'), staticOptions));
app.use('/i18n', express.static(path.join(frontendDir, 'i18n'), staticOptions));
app.use('/frontend', express.static(frontendDir, staticOptions));

function sendRootFile(res, fileName, type) {
  if (type) res.type(type);
  return res.sendFile(path.join(rootDir, fileName));
}

function sendHtml(res, fileName) {
  return res.sendFile(path.join(htmlDir, fileName));
}

app.get('/', (_req, res) => sendRootFile(res, 'index.html', 'html'));
app.get('/manifest.webmanifest', (_req, res) => res.sendFile(path.join(frontendDir, 'manifest.webmanifest')));
app.get('/sw.js', (_req, res) => res.type('application/javascript').sendFile(path.join(frontendDir, 'sw.js')));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\n'));
app.get('/favicon.ico', (_req, res) => res.redirect(302, '/img/ordo-caoti-icon.jpeg'));
app.get('/favicon.png', (_req, res) => res.redirect(302, '/img/ordo-caoti-icon.png'));
app.get('/ads.txt', (_req, res) => res.type('text/plain').send(''));
app.get('/app-ads.txt', (_req, res) => res.type('text/plain').send(''));
app.get('/sellers.json', (_req, res) => res.json({ sellers: [] }));

const htmlRoutes = new Map([
  ['/offline', 'offline.html'],
  ['/legal/politica-privacidade', 'politica-de-privacidade.html'],
  ['/legal/termos-de-uso', 'termos-de-uso.html'],
  ['/legal/acessibilidade', 'acessibilidade-e-inclusao.html'],
  ['/login', 'login.html'],
  ['/login-ti', 'login-ti.html'],
  ['/inscricao', 'regras.html'],
  ['/registro', 'area-matricula.html'],
  ['/cadastro-membros', 'cadastro-membros.html'],
  ['/cadastro-fundadores', 'cadastro-fundadores-bootstrap.html'],
  ['/cadastro-neofitos', 'cadastro-neofitos.html'],
  ['/cadastro-magos-n1', 'cadastro-magos-n1.html'],
  ['/cadastro-magos-n2', 'cadastro-magos-n2.html'],
  ['/cadastro-sabios', 'cadastro-sabios.html'],
  ['/cadastro-ti', 'cadastro-ti.html'],
  ['/solicitar-acesso', 'solicitar-acesso.html'],
  ['/recuperar-senha', 'recuperar-senha.html'],
  ['/recuperar-usuario', 'esqueci-minha-senha.html'],
  ['/redefinir-senha', 'redefinir-senha.html'],
  ['/dashboard', 'dashboard.html'],
  ['/dashboard-aluno', 'dashboard-aluno.html'],
  ['/dashboard-professor', 'dashboard-professor.html'],
  ['/dashboard-cliente', 'dashboard-cliente.html'],
  ['/dashboard-lojista', 'dashboard-lojista.html'],
  ['/regras', 'regras.html'],
  ['/loja', 'loja.html'],
  ['/biblioteca', 'biblioteca-livros.html'],
  ['/diario', 'diario.html'],
  ['/grimorio', 'grimorio.html'],
]);

app.get([...htmlRoutes.keys()], (req, res) => sendHtml(res, htmlRoutes.get(req.path)));


const protectedTiHtmlRoutes = new Map([
  ['/dashboard-TI', 'dashboard-TI.html'],
  ['/dashboard-ti', 'dashboard-TI.html'],
  ['/manutencao-ti', 'manutencao-ti.html'],
  ['/admin/aprovacao-registro', 'aprovacao-de-registro.html'],
  ['/admin/aprovacao-de-registro', 'aprovacao-de-registro.html'],
  ['/ti/admin/aprovacao-registro', 'aprovacao-de-registro.html'],
]);

const databaseUrl = String(process.env.DATABASE_URL || process.env.DATABASE1_URL || process.env.POSTGRES_URL || '').trim();
const jwtSecret = String(process.env.JWT_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.IT_SESSION_SECRET || 'ordo-caoti-development-secret').trim();
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  query_timeout: 10000,
}) : null;

let authSchemaReady;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeNivelCodigo(value) {
  const normalized = String(value || 'neofito').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  const aliases = {
    neofito: 'neofito',
    mago_n1: 'mago_n1',
    mago_n2: 'mago_n2',
    elevado: 'mago_n2',
    mago_elevado: 'mago_n2',
    mago_n3: 'mago_n3',
    sabio: 'sabio',
    soberano: 'sabio',
    mestre: 'mestre_fundador',
    mestre_fundador: 'mestre_fundador',
    ti: 'ti',
  };
  return aliases[normalized] || 'neofito';
}

function tipoUsuarioForNivel(nivelCodigo) {
  return nivelCodigo === 'ti' ? 'ti' : 'aluno';
}

function homeRouteForUser(user, nivelCodigo = 'neofito', requestedProfile = '') {
  if (requestedProfile === 'ti' || user.tipo_usuario === 'ti') return '/dashboard-TI';
  if (requestedProfile === 'admin' || user.tipo_usuario === 'admin') return '/admin/master';
  if (requestedProfile === 'professor' || user.tipo_usuario === 'professor') return '/dashboard-professor';
  if (requestedProfile === 'lojista' || user.tipo_usuario === 'lojista') return '/dashboard-lojista';
  if (requestedProfile === 'cliente' || user.tipo_usuario === 'cliente') return '/dashboard-cliente';
  return '/dashboard-aluno';
}

async function ensureAuthSchema() {
  if (!pool) return;
  authSchemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        tipo_usuario VARCHAR(30) NOT NULL DEFAULT 'aluno',
        ativo BOOLEAN NOT NULL DEFAULT true,
        data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuario_niveis (
        usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
        nivel_codigo VARCHAR(30) NOT NULL DEFAULT 'neofito',
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitacoes_acesso (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        senha_hash TEXT NOT NULL,
        tipo_solicitado VARCHAR(30) NOT NULL DEFAULT 'membro',
        nivel_codigo VARCHAR(30) NOT NULL DEFAULT 'neofito',
        observacao TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pendente',
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        decidido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        decidido_em TIMESTAMPTZ,
        motivo_recusa TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (email, status)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuario_sessoes (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        jwt_id TEXT,
        session_type TEXT NOT NULL DEFAULT 'persistent',
        ip_origem TEXT,
        user_agent TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expira_em TIMESTAMPTZ,
        revogado_em TIMESTAMPTZ,
        motivo_revogacao TEXT
      )
    `);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
    const tiEmail = 'g.lima.rocha90@gmail.com';
    const tiPasswordHash = await bcrypt.hash('0000', 10);
    const tiUser = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ('Gabriel Lima Dias Rocha', $1, $2, 'ti', true, NOW(), true)
       ON CONFLICT (email) DO UPDATE
       SET tipo_usuario = 'ti', ativo = true, senha_hash = EXCLUDED.senha_hash, must_change_password = true
       RETURNING id`,
      [tiEmail, tiPasswordHash]
    );
    await pool.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, 'ti', NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = 'ti', atualizado_em = NOW()`,
      [tiUser.rows[0].id]
    );
  })();
  await authSchemaReady;
}

function requireDatabase(res) {
  if (pool) return true;
  res.status(503).json({ erro: 'Banco de dados não configurado. Configure DATABASE_URL, DATABASE1_URL ou POSTGRES_URL.' });
  return false;
}

function publicUser(user, nivelCodigo, profile = '') {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    tipo: user.tipo_usuario,
    tipo_usuario: user.tipo_usuario,
    nivel_codigo: nivelCodigo || 'neofito',
    nivel: { nivel_codigo: nivelCodigo || 'neofito' },
    roles: [user.tipo_usuario, nivelCodigo || 'neofito'].filter(Boolean),
    perfil_login: profile || user.tipo_usuario,
    home_route: homeRouteForUser(user, nivelCodigo, profile),
    must_change_password: Boolean(user.must_change_password),
  };
}

app.post('/api/inscricao-membro', async (req, res) => {
  if (!requireDatabase(res)) return;
  const nome = String(req.body?.nome || '').trim();
  const email = normalizeEmail(req.body?.email);
  const senha = String(req.body?.senha || '');
  const nivelCodigo = normalizeNivelCodigo(req.body?.nivel_codigo);

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await ensureAuthSchema();
    await client.query('BEGIN');
    const exists = await client.query('SELECT id FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [email]);
    if (exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Já existe uma conta com este email.' });
    }
    const senhaHash = await bcrypt.hash(senha, 10);
    const tipoUsuario = tipoUsuarioForNivel(nivelCodigo);
    const inserted = await client.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro`,
      [nome, email, senhaHash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true, usuario: publicUser(user, nivelCodigo) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return res.status(409).json({ erro: 'Já existe uma conta com este email.' });
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar cadastro.' });
  } finally {
    client.release();
  }
});

app.post('/login', async (req, res) => {
  if (!requireDatabase(res)) return;
  const email = normalizeEmail(req.body?.email);
  const senha = String(req.body?.senha || '');
  const requestedProfile = String(req.body?.perfil_login || '').trim().toLowerCase();
  const sessionType = String(req.body?.session_type || 'persistent').trim() === 'session' ? 'session' : 'persistent';

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios.' });
  }

  try {
    await ensureAuthSchema();
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
      return res.status(401).json({ erro: 'Email ou senha inválidos.' });
    }
    if (user.ativo === false) {
      return res.status(403).json({ erro: 'Conta bloqueada. Contate a administração.' });
    }
    const nivelResult = await pool.query('SELECT nivel_codigo FROM usuario_niveis WHERE usuario_id = $1', [user.id]).catch(() => ({ rows: [] }));
    const nivelCodigo = nivelResult.rows[0]?.nivel_codigo || (user.tipo_usuario === 'ti' ? 'ti' : 'neofito');
    const jwtId = crypto.randomUUID();
    const maxAgeMs = sessionType === 'session' ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const token = jwt.sign({ id: user.id, jti: jwtId, session_type: sessionType }, jwtSecret, { expiresIn: sessionType === 'session' ? '12h' : '30d' });
    const expiresAt = new Date(Date.now() + maxAgeMs);
    await pool.query(
      `INSERT INTO usuario_sessoes (usuario_id, jwt_id, session_type, ip_origem, user_agent, criado_em, expira_em)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [user.id, jwtId, sessionType, req.ip || null, req.headers['user-agent'] || null, expiresAt]
    ).catch(() => {});
    res.cookie('oc_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: maxAgeMs, path: '/' });
    res.json({ ok: true, token, expiresAt, user: publicUser(user, nivelCodigo, requestedProfile) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao autenticar.' });
  }
});



function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map((cookie) => {
    const [name, ...value] = cookie.trim().split('=');
    return [name, decodeURIComponent(value.join('='))];
  }));
}

function getBearerOrCookieToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7);
  return parseCookies(req).oc_session || '';
}

async function verifyActiveUserFromRequest(req) {
  if (!pool) return null;
  const token = getBearerOrCookieToken(req);
  if (!token) return null;
  const payload = jwt.verify(token, jwtSecret);
  const { rows } = await pool.query('SELECT id, nome, email, tipo_usuario, ativo, must_change_password FROM usuarios WHERE id = $1 LIMIT 1', [payload.id]);
  const user = rows[0];
  if (!user || user.ativo === false) return null;
  const nivelResult = await pool.query('SELECT nivel_codigo FROM usuario_niveis WHERE usuario_id = $1', [user.id]).catch(() => ({ rows: [] }));
  user.nivel_codigo = nivelResult.rows[0]?.nivel_codigo || (user.tipo_usuario === 'ti' ? 'ti' : 'neofito');
  return user;
}

async function requireTiPage(req, res, next) {
  try {
    await ensureAuthSchema();
    const user = await verifyActiveUserFromRequest(req);
    if (!user || !['ti', 'admin'].includes(String(user.tipo_usuario || '').toLowerCase())) {
      return res.redirect('/login-ti');
    }
    req.user = user;
    next();
  } catch (_error) {
    return res.redirect('/login-ti');
  }
}

app.get([...protectedTiHtmlRoutes.keys()], requireTiPage, (req, res) => sendHtml(res, protectedTiHtmlRoutes.get(req.path)));

async function authenticateRequest(req, res, next) {
  if (!requireDatabase(res)) return;
  try {
    await ensureAuthSchema();
    const user = await verifyActiveUserFromRequest(req);
    if (!user) return res.status(401).json({ erro: 'Sessão inválida.' });
    req.user = user;
    req.userNivel = user.nivel_codigo;
    next();
  } catch (_error) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

function requireAdminOrTi(req, res, next) {
  if (!['admin', 'ti'].includes(String(req.user?.tipo_usuario || '').toLowerCase())) {
    return res.status(403).json({ erro: 'Acesso restrito a admin ou T.I.' });
  }
  next();
}

function resolveRequestedAccess(body = {}) {
  const raw = String(body.tipo_solicitado || body.tipo || body.perfil || 'membro').trim().toLowerCase();
  if (raw === 'cliente') return { tipoSolicitado: 'cliente', tipoUsuario: 'cliente', nivelCodigo: 'cliente' };
  if (raw === 'ti' || raw === 't.i.') return { tipoSolicitado: 'ti', tipoUsuario: 'ti', nivelCodigo: 'ti' };
  const nivelCodigo = normalizeNivelCodigo(body.nivel_codigo || raw || 'neofito');
  return { tipoSolicitado: 'membro', tipoUsuario: 'aluno', nivelCodigo };
}

app.post('/api/solicitacoes-acesso', async (req, res) => {
  if (!requireDatabase(res)) return;
  const nome = String(req.body?.nome || '').trim();
  const email = normalizeEmail(req.body?.email);
  const senha = String(req.body?.senha || '');
  const observacao = String(req.body?.observacao || '').trim() || null;
  const { tipoSolicitado, nivelCodigo } = resolveRequestedAccess(req.body || {});

  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });

  try {
    await ensureAuthSchema();
    const existingUser = await pool.query('SELECT id FROM usuarios WHERE lower(email) = lower($1) LIMIT 1', [email]);
    if (existingUser.rows.length) return res.status(409).json({ erro: 'Já existe usuário com este email. Use o login ou solicite recuperação de senha.' });
    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO solicitacoes_acesso (nome, email, senha_hash, tipo_solicitado, nivel_codigo, observacao, status, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente', NOW())
       ON CONFLICT (email, status) DO UPDATE
       SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo_solicitado = EXCLUDED.tipo_solicitado,
           nivel_codigo = EXCLUDED.nivel_codigo, observacao = EXCLUDED.observacao, criado_em = NOW()
       RETURNING id, nome, email, tipo_solicitado, nivel_codigo, status, criado_em`,
      [nome, email, senhaHash, tipoSolicitado, nivelCodigo, observacao]
    );
    res.status(201).json({ ok: true, solicitacao: result.rows[0], mensagem: 'Solicitação enviada para aprovação de admin/T.I.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao registrar solicitação.' });
  }
});

app.get('/admin/solicitacoes-acesso', authenticateRequest, requireAdminOrTi, async (req, res) => {
  const status = String(req.query?.status || 'pendente').trim().toLowerCase();
  try {
    await ensureAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, nome, email, tipo_solicitado, nivel_codigo, observacao, status, criado_em, decidido_em, motivo_recusa
       FROM solicitacoes_acesso
       WHERE status = $1
       ORDER BY criado_em ASC`,
      [status]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao listar solicitações.' });
  }
});

app.post('/admin/solicitacoes-acesso/:id/aprovar', authenticateRequest, requireAdminOrTi, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Solicitação inválida.' });
  const client = await pool.connect();
  try {
    await ensureAuthSchema();
    await client.query('BEGIN');
    const requestResult = await client.query('SELECT * FROM solicitacoes_acesso WHERE id = $1 FOR UPDATE', [id]);
    const request = requestResult.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Solicitação não encontrada.' });
    }
    if (request.status !== 'pendente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Solicitação já processada.' });
    }
    const { tipoUsuario, nivelCodigo } = resolveRequestedAccess(request);
    const inserted = await client.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo_usuario = EXCLUDED.tipo_usuario, ativo = true
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro`,
      [request.nome, request.email, request.senha_hash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    await client.query(
      `UPDATE solicitacoes_acesso
       SET status = 'aprovado', usuario_id = $2, decidido_por = $3, decidido_em = NOW()
       WHERE id = $1`,
      [id, user.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, usuario: publicUser(user, nivelCodigo), solicitacao_id: id });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ erro: 'Falha ao aprovar solicitação.' });
  } finally {
    client.release();
  }
});

app.post('/admin/solicitacoes-acesso/:id/rejeitar', authenticateRequest, requireAdminOrTi, async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || null;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Solicitação inválida.' });
  try {
    await ensureAuthSchema();
    const result = await pool.query(
      `UPDATE solicitacoes_acesso
       SET status = 'rejeitado', motivo_recusa = $2, decidido_por = $3, decidido_em = NOW()
       WHERE id = $1 AND status = 'pendente'
       RETURNING id, nome, email, status`,
      [id, motivo, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Solicitação pendente não encontrada.' });
    res.json({ ok: true, solicitacao: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao rejeitar solicitação.' });
  }
});

app.get('/admin/membros-pendentes', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  try {
    await ensureAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, nome, email, tipo_solicitado, nivel_codigo, criado_em AS data_cadastro
       FROM solicitacoes_acesso
       WHERE status = 'pendente'
       ORDER BY criado_em ASC`
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao carregar membros pendentes.' });
  }
});

app.post('/admin/aprovar-membro', authenticateRequest, requireAdminOrTi, async (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Solicitação inválida.' });
  const client = await pool.connect();
  try {
    await ensureAuthSchema();
    await client.query('BEGIN');
    const requestResult = await client.query('SELECT * FROM solicitacoes_acesso WHERE id = $1 FOR UPDATE', [id]);
    const request = requestResult.rows[0];
    if (!request || request.status !== 'pendente') {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Solicitação pendente não encontrada.' });
    }
    const { tipoUsuario, nivelCodigo } = resolveRequestedAccess(request);
    const inserted = await client.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo_usuario = EXCLUDED.tipo_usuario, ativo = true
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro`,
      [request.nome, request.email, request.senha_hash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    await client.query(
      `UPDATE solicitacoes_acesso SET status = 'aprovado', usuario_id = $2, decidido_por = $3, decidido_em = NOW() WHERE id = $1`,
      [id, user.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, usuario: publicUser(user, nivelCodigo), solicitacao_id: id });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ erro: 'Falha ao aprovar membro.' });
  } finally {
    client.release();
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, name: 'ordo-caoti', mode: 'landing-safe-auth', database: pool ? 'configured' : 'missing' });
});

app.use((_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

export default app;
