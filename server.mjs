import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const htmlDir = path.join(frontendDir, 'html');
const siteMemoryPath = path.join(rootDir, 'site-memory.json');
const siteMemory = fs.existsSync(siteMemoryPath) ? JSON.parse(fs.readFileSync(siteMemoryPath, 'utf8')) : { routes: [] };
const deployVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || Date.now().toString();

const staticOptions = {
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  immutable: process.env.NODE_ENV === 'production',
};

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Ordo-Caoti-Version', deployVersion);
  next();
});
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
  ['/login/ti', 'login-ti.html'],
  ['/login/loja/cliente', 'login-loja-cliente.html'],
  ['/login/loja/lojista', 'login-loja-lojista.html'],
  ['/inscricao', 'regras.html'],
  ['/registro', 'area-matricula.html'],
  ['/cadastro-membros', 'cadastro-membros.html'],
  ['/cadastro-fundadores', 'cadastro-fundadores-bootstrap.html'],
  ['/cadastro-neofitos', 'cadastro-neofitos.html'],
  ['/cadastro-magos-n1', 'cadastro-magos-n1.html'],
  ['/cadastro-magos-n2', 'cadastro-magos-n2.html'],
  ['/cadastro-magos-n3', 'cadastro-sabios.html'],
  ['/cadastro-mago-soberano', 'cadastro-sabios.html'],
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
  ['/ti/criar-login', 'ti-criar-login.html'],
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

function hashPassword(value) {
  return 'sha256$' + crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function verifyPassword(value, storedHash) {
  const hash = String(storedHash || '');
  if (hash.startsWith('sha256$')) return hashPassword(value) === hash;
  return false;
}

function normalizeNivelCodigo(value) {
  const normalized = String(value || 'neofito').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  const aliases = {
    neofito: 'neofito',
    mago_n1: 'mago_n1',
    mago_iniciado: 'mago_n1',
    iniciado: 'mago_n1',
    mago_n2: 'mago_n2',
    elevado: 'mago_n2',
    mago_elevado: 'mago_n2',
    mago_n3: 'mago_n3',
    mago_soberano: 'mago_n3',
    soberano: 'mago_n3',
    mestre: 'mestre_fundador',
    mestre_fundador: 'mestre_fundador',
    ti: 'ti',
  };
  return aliases[normalized] || 'neofito';
}

function tipoUsuarioForNivel(nivelCodigo) {
  return nivelCodigo === 'ti' ? 'ti' : 'aluno';
}


const profileCatalog = {
  cliente: { id: 'cliente', label: 'Cliente', home_route: '/dashboard-cliente' },
  neofito: { id: 'neofito', label: 'Neófito', home_route: '/dashboard-aluno' },
  mago_n1: { id: 'mago_n1', label: 'Mago Iniciado', home_route: '/dashboard-aluno' },
  mago_n2: { id: 'mago_n2', label: 'Mago Elevado', home_route: '/dashboard-aluno' },
  mago_n3: { id: 'mago_n3', label: 'Mago Soberano', home_route: '/dashboard-aluno' },
  mestre_fundador: { id: 'mestre_fundador', label: 'Mestre', home_route: '/admin/master' },
  lojista: { id: 'lojista', label: 'Lojista', home_route: '/dashboard-lojista' },
  professor: { id: 'professor', label: 'Professor', home_route: '/dashboard-professor' },
  admin: { id: 'admin', label: 'Admin', home_route: '/admin/master' },
  ti: { id: 'ti', label: 'T.I.', home_route: '/dashboard-TI' },
};

const hierarchyProfiles = ['neofito', 'mago_n1', 'mago_n2', 'mago_n3', 'mestre_fundador'];

function availableProfilesForUser(user = {}, nivelCodigo = 'neofito') {
  const profiles = new Set();
  const tipo = String(user.tipo_usuario || '').toLowerCase();
  const nivel = normalizeNivelCodigo(nivelCodigo);

  if (tipo === 'cliente') profiles.add('cliente');
  if (tipo === 'lojista') profiles.add('lojista');
  if (tipo === 'professor') profiles.add('professor');
  if (tipo === 'admin') profiles.add('admin');
  if (tipo === 'ti') profiles.add('ti');

  if (tipo === 'aluno' || tipo === 'admin' || tipo === 'ti') {
    const idx = hierarchyProfiles.indexOf(nivel);
    const max = idx >= 0 ? idx : 0;
    hierarchyProfiles.slice(0, max + 1).forEach((profile) => profiles.add(profile));
  }

  if (tipo === 'admin') profiles.add('ti');
  if (tipo === 'ti') ['neofito', 'mago_n1', 'mago_n2', 'mago_n3'].forEach((profile) => profiles.add(profile));

  return [...profiles].filter((id) => profileCatalog[id]).map((id) => profileCatalog[id]);
}

function homeRouteForUser(user, nivelCodigo = 'neofito', requestedProfile = '') {
  const available = availableProfilesForUser(user, nivelCodigo);
  const requested = String(requestedProfile || '').toLowerCase();
  const selected = available.find((profile) => profile.id === requested) || available[0] || profileCatalog.neofito;
  return selected.home_route;
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ti_manutencoes (
        id SERIAL PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT,
        motivo TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'ativa',
        global BOOLEAN NOT NULL DEFAULT false,
        alvos JSONB NOT NULL DEFAULT '[]'::jsonb,
        criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        inicio_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        previsao_retorno_em TIMESTAMPTZ,
        encerrado_em TIMESTAMPTZ,
        encerrado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
    const tiEmail = 'g.lima.rocha90@gmail.com';
    const tiPasswordHash = hashPassword('0000');
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

    const masterPasswordHash = hashPassword('0000');
    const masterSeeds = [
      { nome: 'Caio Zanoni', email: 'contatocaiozanoni@gmail.com' },
      { nome: 'Dayenne Kennedy', email: 'dayeekennedy@gmail.com' },
    ];
    for (const master of masterSeeds) {
      const savedMaster = await pool.query(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
         VALUES ($1, $2, $3, 'admin', true, NOW(), true)
         ON CONFLICT (email) DO UPDATE
         SET tipo_usuario = 'admin', ativo = true, senha_hash = EXCLUDED.senha_hash, must_change_password = true
         RETURNING id`,
        [master.nome, master.email, masterPasswordHash]
      );
      await pool.query(
        `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
         VALUES ($1, 'mestre_fundador', NOW())
         ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = 'mestre_fundador', atualizado_em = NOW()`,
        [savedMaster.rows[0].id]
      );
    }
  })();
  await authSchemaReady;
}

function requireDatabase(res) {
  if (pool) return true;
  res.status(503).json({ erro: 'Banco de dados não configurado. Configure DATABASE_URL, DATABASE1_URL ou POSTGRES_URL.' });
  return false;
}

function publicUser(user, nivelCodigo, profile = '') {
  const perfisDisponiveis = availableProfilesForUser(user, nivelCodigo);
  const requested = String(profile || '').toLowerCase();
  const selected = perfisDisponiveis.find((item) => item.id === requested) || perfisDisponiveis[0] || profileCatalog.neofito;
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    tipo: user.tipo_usuario,
    tipo_usuario: user.tipo_usuario,
    nivel_codigo: nivelCodigo || 'neofito',
    nivel: { nivel_codigo: nivelCodigo || 'neofito' },
    roles: [user.tipo_usuario, nivelCodigo || 'neofito', ...perfisDisponiveis.map((item) => item.id)].filter(Boolean),
    perfil_login: selected.id,
    perfil_ativo: selected,
    perfis_disponiveis: perfisDisponiveis,
    home_route: selected.home_route,
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
    const senhaHash = hashPassword(senha);
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
    if (!user || !(await verifyPassword(senha, user.senha_hash))) {
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
    const senhaHash = hashPassword(senha);
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


async function databaseHealth() {
  if (!pool) return { status: 'missing', message: 'DATABASE_URL/DATABASE1_URL/POSTGRES_URL ausente.' };
  const started = Date.now();
  try {
    await ensureAuthSchema();
    const result = await pool.query('SELECT NOW() AS now');
    return { status: 'ok', latency_ms: Date.now() - started, now: result.rows[0]?.now };
  } catch (error) {
    return { status: 'erro', latency_ms: Date.now() - started, message: error.message };
  }
}


async function ensureCoreTables() {
  if (!pool) return;
  await ensureAuthSchema();
  await pool.query(`CREATE TABLE IF NOT EXISTS produtos (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, preco NUMERIC(12,2) NOT NULL DEFAULT 0, tipo TEXT DEFAULT 'digital', estoque INTEGER DEFAULT 0, ativo BOOLEAN DEFAULT true, vendedor_id INTEGER, deleted_at TIMESTAMPTZ, data_criacao TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, usuario_id INTEGER, descricao TEXT, total NUMERIC(12,2) DEFAULT 0, status TEXT DEFAULT 'pendente', data_pedido TIMESTAMPTZ DEFAULT NOW(), metadata JSONB DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS diario_pessoal (id SERIAL PRIMARY KEY, usuario_id INTEGER, titulo TEXT, conteudo_texto TEXT, sentimento TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS grimorio_pessoal (id SERIAL PRIMARY KEY, usuario_id INTEGER, titulo TEXT, tipo_registro TEXT DEFAULT 'anotacao', conteudo_texto TEXT, tags JSONB DEFAULT '[]'::jsonb, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS biblioteca_temas (id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE, ativo BOOLEAN DEFAULT true, ordem_exibicao INTEGER DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS biblioteca_livros (id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, autores JSONB DEFAULT '[]'::jsonb, tema_id INTEGER, descricao TEXT, capa_url TEXT, ativo BOOLEAN DEFAULT true, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS biblioteca_recursos (id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, descricao TEXT, tipo_recurso TEXT DEFAULT 'link', url TEXT, status TEXT DEFAULT 'ativo', criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS turmas (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, ativo BOOLEAN DEFAULT true, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS materias (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, turma_id INTEGER, professor_id INTEGER, tipo_materia TEXT DEFAULT 'obrigatoria', ativo BOOLEAN DEFAULT true, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS live_salas (id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, descricao TEXT, turma_id INTEGER, materia_id INTEGER, professor_id INTEGER, provider TEXT DEFAULT 'internal', status TEXT DEFAULT 'pendente', link_sala TEXT, inicio_previsto TIMESTAMPTZ, fim_previsto TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS anexos_academicos (id SERIAL PRIMARY KEY, materia_id INTEGER, autor_id INTEGER, tipo_material TEXT DEFAULT 'texto', titulo TEXT NOT NULL, url TEXT, status_moderacao TEXT DEFAULT 'pendente', comentario_moderacao TEXT, data_criacao TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`INSERT INTO biblioteca_temas (nome, ordem_exibicao) VALUES ('Fundamentos', 1), ('Magia do Caos', 2), ('Grimório', 3) ON CONFLICT (nome) DO NOTHING`);
}

function noDbFallback(res, payload) {
  return res.json({ ok: true, offline: true, ...payload });
}

async function optionalUser(req) {
  try { return await verifyActiveUserFromRequest(req); } catch { return null; }
}


app.get('/me/perfis', authenticateRequest, async (req, res) => {
  res.json({ ok: true, user: publicUser(req.user, req.userNivel, req.user?.perfil_login), perfis: availableProfilesForUser(req.user, req.userNivel) });
});

app.post('/perfil/trocar', authenticateRequest, async (req, res) => {
  const requested = String(req.body?.perfil_login || req.body?.perfil || '').trim().toLowerCase();
  const perfis = availableProfilesForUser(req.user, req.userNivel);
  const selected = perfis.find((profile) => profile.id === requested);
  if (!selected) {
    return res.status(403).json({ erro: 'Perfil indisponível para este usuário.', perfis_disponiveis: perfis });
  }
  res.json({ ok: true, user: publicUser(req.user, req.userNivel, selected.id), perfil_ativo: selected, perfis_disponiveis: perfis });
});


app.get('/site-memory.json', (_req, res) => res.json(siteMemory));
app.get('/api/site-memory', (_req, res) => res.json({ ok: true, version: deployVersion, ...siteMemory }));
app.get('/api/site-version', (_req, res) => res.json({ ok: true, version: deployVersion, generated_at: new Date().toISOString() }));

app.get('/api/route-exists', (req, res) => {
  const route = String(req.query?.route || '/').trim() || '/';
  const found = siteMemory.routes.find((item) => item.route === route || `/${path.basename(item.file || '')}` === route);
  res.json({ ok: true, route, exists: Boolean(found), match: found || null });
});

app.post('/logout', (_req, res) => {
  res.cookie('oc_session', '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 0, path: '/' });
  res.json({ ok: true });
});

app.get('/produtos', async (_req, res) => {
  if (!pool) return noDbFallback(res, { produtos: [], message: 'Banco offline; catálogo vazio.' });
  try {
    await ensureCoreTables();
    const { rows } = await pool.query("SELECT id, nome, descricao, preco, tipo, estoque, ativo FROM produtos WHERE ativo = true AND deleted_at IS NULL ORDER BY id DESC LIMIT 100");
    res.json(rows.length ? rows : [{ id: 1, nome: 'Boas-vindas Ordo Caoti', descricao: 'Produto demonstrativo até o catálogo ser cadastrado.', preco: '0.00', tipo: 'digital', estoque: 999, ativo: true }]);
  } catch (error) { res.status(500).json({ erro: 'Falha ao carregar produtos.', detalhe: error.message }); }
});

app.post('/loja/carrinho', async (req, res) => {
  res.status(201).json({ ok: true, item: req.body || {}, carrinho_id: crypto.randomUUID() });
});

app.post('/loja/checkout', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { pedido_id: 0, status: 'pendente' });
  try {
    await ensureCoreTables();
    const total = Number(req.body?.total || req.body?.valor || 0);
    const result = await pool.query('INSERT INTO pedidos (usuario_id, descricao, total, status, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [req.user.id, 'Checkout Ordo Caoti', total, 'pendente', JSON.stringify(req.body || {})]);
    res.status(201).json({ ok: true, pedido_id: result.rows[0].id, pedido: result.rows[0], mercado_pago: { configured: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN) } });
  } catch (error) { res.status(500).json({ erro: 'Falha no checkout.', detalhe: error.message }); }
});

app.get('/loja/pedidos/:id', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { pedido: null });
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM pedidos WHERE id = $1 AND (usuario_id = $2 OR $3 = ANY($4::text[]))', [Number(req.params.id), req.user.id, req.user.tipo_usuario, ['admin','ti']]);
  if (!rows.length) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json(rows[0]);
});

app.post('/loja/pedidos/:id/sincronizar-ordem', authenticateRequest, async (req, res) => {
  res.json({ ok: true, pedido_id: Number(req.params.id), status: 'pendente', mercado_pago: { configured: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN) } });
});

app.get('/financeiro/historico', authenticateRequest, async (req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const target = req.query?.usuario_id && ['admin','ti'].includes(req.user.tipo_usuario) ? Number(req.query.usuario_id) : req.user.id;
  const { rows } = await pool.query('SELECT * FROM pedidos WHERE usuario_id = $1 ORDER BY data_pedido DESC LIMIT 100', [target]);
  res.json(rows);
});
app.get('/api/financeiro', authenticateRequest, async (req, res) => app._router.handle(Object.assign(req, { url: '/financeiro/historico', originalUrl: '/financeiro/historico' }), res, () => {}));

app.get('/minhas-turmas', authenticateRequest, async (_req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM turmas WHERE ativo = true ORDER BY id DESC LIMIT 50');
  res.json(rows);
});
app.get('/api/materias-disponiveis', authenticateRequest, async (_req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM materias WHERE ativo = true ORDER BY id DESC LIMIT 100');
  res.json(rows);
});
app.get('/api/boletim', authenticateRequest, (_req, res) => res.json([]));
app.get('/aluno/materias', authenticateRequest, async (_req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM materias WHERE ativo = true ORDER BY id DESC LIMIT 100');
  res.json(rows);
});
app.get('/aluno/avaliacoes-v2', authenticateRequest, (_req, res) => res.json([]));
app.get('/aluno/faltas/minhas', authenticateRequest, (_req, res) => res.json([]));
app.get('/aluno/gamificacao/progresso', authenticateRequest, (_req, res) => res.json({ pontos: 0, nivel: 'inicial', conquistas: [] }));
app.get('/aluno/gamificacao/top10', authenticateRequest, (_req, res) => res.json([]));

app.get('/diario/pessoal', authenticateRequest, async (req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM diario_pessoal WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 100', [req.user.id]);
  res.json(rows);
});
app.post('/diario/pessoal', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { entrada: req.body });
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO diario_pessoal (usuario_id,titulo,conteudo_texto,sentimento) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, req.body?.titulo || null, req.body?.conteudo_texto || '', req.body?.sentimento || null]);
  res.status(201).json(rows[0]);
});
app.get('/grimorio/pessoal', authenticateRequest, async (req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM grimorio_pessoal WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 100', [req.user.id]);
  res.json(rows);
});
app.post('/grimorio/pessoal', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { registro: req.body });
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO grimorio_pessoal (usuario_id,titulo,tipo_registro,conteudo_texto,tags) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [req.user.id, req.body?.titulo || null, req.body?.tipo_registro || 'anotacao', req.body?.conteudo_texto || '', JSON.stringify(req.body?.tags || [])]);
  res.status(201).json(rows[0]);
});

app.get('/biblioteca/temas', async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM biblioteca_temas WHERE ativo = true ORDER BY ordem_exibicao,nome'); res.json(rows); });
app.post('/biblioteca/temas', authenticateRequest, requireAdminOrTi, async (req, res) => { await ensureCoreTables(); const { rows } = await pool.query('INSERT INTO biblioteca_temas (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo = true RETURNING *', [String(req.body?.nome || '').trim()]); res.status(201).json(rows[0]); });
app.get('/biblioteca/recursos', authenticateRequest, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query("SELECT * FROM biblioteca_recursos WHERE status = 'ativo' ORDER BY criado_em DESC LIMIT 100"); res.json(rows); });
app.post('/biblioteca/recursos', authenticateRequest, async (req, res) => { if (!pool) return noDbFallback(res, { recurso: req.body }); await ensureCoreTables(); const { rows } = await pool.query('INSERT INTO biblioteca_recursos (titulo,descricao,tipo_recurso,url,criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.body?.titulo || 'Recurso', req.body?.descricao || null, req.body?.tipo_recurso || 'link', req.body?.url || null, req.user.id]); res.status(201).json(rows[0]); });
app.get('/biblioteca/livros', authenticateRequest, async (_req, res) => { if (!pool) return res.json({ data: [], page: 1 }); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM biblioteca_livros WHERE ativo = true ORDER BY criado_em DESC LIMIT 100'); res.json({ data: rows, page: 1, total: rows.length }); });
app.get('/biblioteca/livros/:id', authenticateRequest, async (req, res) => { if (!pool) return res.status(404).json({ erro: 'Livro não encontrado.' }); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM biblioteca_livros WHERE id=$1', [Number(req.params.id)]); if (!rows.length) return res.status(404).json({ erro: 'Livro não encontrado.' }); res.json(rows[0]); });
app.post('/biblioteca/livros/:id/leitura', authenticateRequest, (req, res) => res.json({ ok: true, livro_id: Number(req.params.id), status: req.body?.status || 'lendo' }));

app.get('/live/salas', authenticateRequest, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM live_salas ORDER BY criado_em DESC LIMIT 100'); res.json(rows); });
app.post('/live/salas', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { sala: req.body });
  await ensureCoreTables();
  const provider = String(req.body?.provider || req.body?.provedor_sala || 'internal').toLowerCase();
  const link = provider === 'daily' && process.env.DAILY_API_KEY ? null : `/live/sala/${crypto.randomUUID()}`;
  const { rows } = await pool.query('INSERT INTO live_salas (titulo,descricao,turma_id,materia_id,professor_id,provider,status,link_sala,inicio_previsto,fim_previsto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [req.body?.titulo || 'Aula ao vivo', req.body?.descricao || null, req.body?.turma_id || null, req.body?.materia_id || null, req.user.id, provider, req.user.tipo_usuario === 'admin' ? 'agendada' : 'pendente', link, req.body?.inicio_previsto || null, req.body?.fim_previsto || null]);
  res.status(201).json(rows[0]);
});
app.post('/live/salas/:id/entrar', authenticateRequest, (req, res) => res.json({ ok: true, id: Number(req.params.id), link_sala: `/live/sala/${req.params.id}`, providers: { daily: Boolean(process.env.DAILY_API_KEY), google_meet: Boolean(process.env.GOOGLE_CLIENT_ID), zoom: Boolean(process.env.ZOOM_CLIENT_ID), teams: Boolean(process.env.MICROSOFT_CLIENT_ID) } }));
app.post('/live/salas/:id/gerar-link', authenticateRequest, (req, res) => res.json({ ok: true, id: Number(req.params.id), link_sala: `/live/sala/${req.params.id}` }));
app.post('/live/salas/:id/encerrar', authenticateRequest, async (req, res) => { if (pool) { await ensureCoreTables(); await pool.query("UPDATE live_salas SET status='realizada' WHERE id=$1", [Number(req.params.id)]); } res.json({ ok: true, id: Number(req.params.id), gravacao: { status: 'pendente_configuracao_provider' } }); });
app.get('/api/daily/config', authenticateRequest, (_req, res) => res.json({ enabled: Boolean(process.env.DAILY_API_KEY), provider: 'daily' }));
app.get('/api/meetings/providers', authenticateRequest, (_req, res) => res.json({ daily: Boolean(process.env.DAILY_API_KEY), google_meet: Boolean(process.env.GOOGLE_CLIENT_ID), zoom: Boolean(process.env.ZOOM_CLIENT_ID), teams: Boolean(process.env.MICROSOFT_CLIENT_ID), fallback: 'internal_link' }));


app.get('/lojista/meus-produtos', authenticateRequest, async (req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM produtos WHERE vendedor_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 100', [req.user.id]);
  res.json(rows);
});
app.post('/lojista/produtos', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { produto: req.body });
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO produtos (nome,descricao,preco,tipo,estoque,ativo,vendedor_id) VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING *', [req.body?.nome || 'Produto', req.body?.descricao || null, Number(req.body?.preco || 0), req.body?.tipo || 'digital', Number(req.body?.estoque || 0), req.user.id]);
  res.status(201).json(rows[0]);
});
app.put('/lojista/produtos/:id', authenticateRequest, async (req, res) => {
  if (!pool) return noDbFallback(res, { produto: { id: Number(req.params.id), ...req.body } });
  await ensureCoreTables();
  const { rows } = await pool.query('UPDATE produtos SET nome=COALESCE($2,nome), descricao=COALESCE($3,descricao), preco=COALESCE($4,preco), tipo=COALESCE($5,tipo), estoque=COALESCE($6,estoque) WHERE id=$1 AND (vendedor_id=$7 OR $8 = ANY($9::text[])) RETURNING *', [Number(req.params.id), req.body?.nome || null, req.body?.descricao || null, req.body?.preco ?? null, req.body?.tipo || null, req.body?.estoque ?? null, req.user.id, req.user.tipo_usuario, ['admin','ti']]);
  if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
  res.json(rows[0]);
});
app.delete('/lojista/produtos/:id', authenticateRequest, async (req, res) => {
  if (pool) { await ensureCoreTables(); await pool.query('UPDATE produtos SET deleted_at=NOW(), ativo=false WHERE id=$1 AND (vendedor_id=$2 OR $3 = ANY($4::text[]))', [Number(req.params.id), req.user.id, req.user.tipo_usuario, ['admin','ti']]); }
  res.json({ ok: true });
});

app.get('/professor/materias', authenticateRequest, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM materias WHERE ativo=true ORDER BY id DESC'); res.json(rows); });
app.get('/professor/anexos', authenticateRequest, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM anexos_academicos ORDER BY data_criacao DESC LIMIT 100'); res.json(rows); });
app.post('/professor/anexos', authenticateRequest, async (req, res) => { if (!pool) return noDbFallback(res, { anexo: req.body }); await ensureCoreTables(); const { rows } = await pool.query('INSERT INTO anexos_academicos (materia_id,autor_id,tipo_material,titulo,url,status_moderacao) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.body?.materia_id || null, req.user.id, req.body?.tipo_material || 'texto', req.body?.titulo || 'Material', req.body?.url || null, 'pendente']); res.status(201).json(rows[0]); });
app.get('/professor/faltas/pendentes', authenticateRequest, (_req, res) => res.json([]));

app.get('/admin/professores', authenticateRequest, requireAdminOrTi, async (_req, res) => { if (!pool) return res.json([]); const { rows } = await pool.query("SELECT id,nome,email,ativo FROM usuarios WHERE tipo_usuario='professor' ORDER BY nome"); res.json(rows); });
app.get('/admin/turmas', authenticateRequest, requireAdminOrTi, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM turmas ORDER BY id DESC'); res.json(rows); });
app.post('/admin/turmas', authenticateRequest, requireAdminOrTi, async (req, res) => { await ensureCoreTables(); const { rows } = await pool.query('INSERT INTO turmas (nome,descricao) VALUES ($1,$2) RETURNING *', [req.body?.nome || 'Turma', req.body?.descricao || null]); res.status(201).json(rows[0]); });
app.get('/admin/materias', authenticateRequest, requireAdminOrTi, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query('SELECT * FROM materias ORDER BY id DESC'); res.json(rows); });
app.post('/admin/materias', authenticateRequest, requireAdminOrTi, async (req, res) => { await ensureCoreTables(); const { rows } = await pool.query('INSERT INTO materias (nome,turma_id,professor_id,tipo_materia) VALUES ($1,$2,$3,$4) RETURNING *', [req.body?.nome || 'Matéria', req.body?.turma_id || null, req.body?.professor_id || null, req.body?.tipo_materia || 'obrigatoria']); res.status(201).json(rows[0]); });
app.get('/admin/anexos/pendentes', authenticateRequest, requireAdminOrTi, async (_req, res) => { if (!pool) return res.json([]); await ensureCoreTables(); const { rows } = await pool.query("SELECT * FROM anexos_academicos WHERE status_moderacao='pendente' ORDER BY data_criacao ASC"); res.json(rows); });
app.post('/admin/anexos/:id/aprovar', authenticateRequest, requireAdminOrTi, async (req, res) => { if (pool) await pool.query("UPDATE anexos_academicos SET status_moderacao='aprovado', comentario_moderacao=$2 WHERE id=$1", [Number(req.params.id), req.body?.comentario || null]); res.json({ ok: true }); });
app.post('/admin/anexos/:id/reprovar', authenticateRequest, requireAdminOrTi, async (req, res) => { if (pool) await pool.query("UPDATE anexos_academicos SET status_moderacao='reprovado', comentario_moderacao=$2 WHERE id=$1", [Number(req.params.id), req.body?.comentario || null]); res.json({ ok: true }); });
app.get('/admin/financeiro/usuarios', authenticateRequest, requireAdminOrTi, async (_req, res) => { if (!pool) return res.json([]); const { rows } = await pool.query('SELECT id,nome,email,tipo_usuario,ativo,data_cadastro FROM usuarios ORDER BY data_cadastro DESC LIMIT 100'); res.json(rows); });
app.get('/admin/inscricoes-lista', authenticateRequest, requireAdminOrTi, (_req, res) => res.json([]));
app.post('/admin/decisao-inscricao', authenticateRequest, requireAdminOrTi, (req, res) => res.json({ ok: true, id: req.body?.id, status: req.body?.status || 'pendente' }));
app.get('/admin/disciplinar/alunos', authenticateRequest, requireAdminOrTi, (_req, res) => res.json([]));
app.get('/admin/disciplinar/casos', authenticateRequest, requireAdminOrTi, (_req, res) => res.json([]));
app.get('/admin/suprema/painel', authenticateRequest, requireAdminOrTi, (_req, res) => res.json({ ok: true, resumo: {}, membros: [] }));

app.post('/api/loja/clientes/cadastro-rapido', async (req, res) => { req.body = { ...req.body, tipo_solicitado: 'cliente' }; return app._router.handle(Object.assign(req, { url: '/api/solicitacoes-acesso', originalUrl: '/api/solicitacoes-acesso' }), res, () => {}); });
app.post('/api/bootstrap/fundadores', async (_req, res) => res.status(410).json({ erro: 'Bootstrap privilegiado desativado. Use aprovação T.I./admin.' }));
app.post('/concluir-cadastro', async (req, res) => res.json({ ok: true, message: 'Cadastro recebido.', payload: req.body || {} }));
app.post('/inscricao', async (_req, res) => res.status(201).json({ ok: true, status: 'pendente' }));
app.get('/ti/webhooks/mercadopago/resumo', authenticateRequest, requireAdminOrTi, (_req, res) => res.json({ resumo: { taxa_sucesso_percentual: 100, total: 0 }, eventos: [] }));

app.get('/ti/saude', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  const db = await databaseHealth();
  let manutencaoAtiva = 0;
  try {
    if (pool) {
      const result = await pool.query("SELECT COUNT(*)::int AS total FROM ti_manutencoes WHERE status = 'ativa'");
      manutencaoAtiva = Number(result.rows[0]?.total || 0);
    }
  } catch (_error) {}
  res.json({
    ok: db.status === 'ok',
    generated_at: new Date().toISOString(),
    resumo: { saude: db.status === 'ok' ? 'saudavel' : 'degradado' },
    db,
    backend: { status: 'online', runtime: 'vercel-serverless', mode: 'safe-auth' },
    manutencao: { ativa_total: manutencaoAtiva },
  });
});

app.get('/ti/manutencoes/ativas', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  try {
    await ensureAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, titulo, descricao, motivo, status, global, alvos, inicio_em, previsao_retorno_em
       FROM ti_manutencoes
       WHERE status = 'ativa'
       ORDER BY inicio_em DESC`
    );
    res.json(rows.map((row) => ({
      ...row,
      alvos: Array.isArray(row.alvos) ? row.alvos : [],
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao listar manutenções.' });
  }
});

app.post('/ti/manutencoes/pause-global', authenticateRequest, requireAdminOrTi, async (req, res) => {
  try {
    await ensureAuthSchema();
    const titulo = String(req.body?.titulo || 'Manutenção global').trim();
    const descricao = String(req.body?.descricao || '').trim() || null;
    const motivo = String(req.body?.motivo || 'Operação T.I.').trim();
    const previsao = req.body?.previsao_retorno_em || null;
    const { rows } = await pool.query(
      `INSERT INTO ti_manutencoes (titulo, descricao, motivo, global, alvos, criado_por, previsao_retorno_em)
       VALUES ($1, $2, $3, true, $4::jsonb, $5, $6)
       RETURNING *`,
      [titulo, descricao, motivo, JSON.stringify([{ rota_alvo: '*' }]), req.user.id, previsao]
    );
    res.status(201).json({ ok: true, manutencao: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar manutenção global.' });
  }
});

app.post('/ti/manutencoes', authenticateRequest, requireAdminOrTi, async (req, res) => {
  try {
    await ensureAuthSchema();
    const titulo = String(req.body?.titulo || 'Manutenção de rota').trim();
    const descricao = String(req.body?.descricao || '').trim() || null;
    const motivo = String(req.body?.motivo || 'Operação T.I.').trim();
    const previsao = req.body?.previsao_retorno_em || null;
    const alvos = Array.isArray(req.body?.alvos) ? req.body.alvos : [];
    const normalizedTargets = alvos.map((rota) => ({ rota_alvo: String(rota || '').trim() })).filter((item) => item.rota_alvo);
    if (!normalizedTargets.length) return res.status(400).json({ erro: 'Informe pelo menos uma rota alvo.' });
    const { rows } = await pool.query(
      `INSERT INTO ti_manutencoes (titulo, descricao, motivo, global, alvos, criado_por, previsao_retorno_em)
       VALUES ($1, $2, $3, false, $4::jsonb, $5, $6)
       RETURNING *`,
      [titulo, descricao, motivo, JSON.stringify(normalizedTargets), req.user.id, previsao]
    );
    res.status(201).json({ ok: true, manutencao: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar manutenção.' });
  }
});

app.post('/ti/manutencoes/:id/encerrar', authenticateRequest, requireAdminOrTi, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Manutenção inválida.' });
  try {
    await ensureAuthSchema();
    const { rows } = await pool.query(
      `UPDATE ti_manutencoes
       SET status = 'encerrada', encerrado_em = NOW(), encerrado_por = $2
       WHERE id = $1 AND status = 'ativa'
       RETURNING *`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Manutenção ativa não encontrada.' });
    res.json({ ok: true, manutencao: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao encerrar manutenção.' });
  }
});

app.get('/manutencao/status', async (req, res) => {
  const rota = String(req.query?.rota || '/').trim() || '/';
  try {
    await ensureAuthSchema();
    if (!pool) return res.json({ ok: true, rota, manutencao: false, db: 'missing' });
    const { rows } = await pool.query(
      `SELECT id, titulo, motivo, global, alvos, inicio_em, previsao_retorno_em
       FROM ti_manutencoes
       WHERE status = 'ativa'
       ORDER BY inicio_em DESC`
    );
    const match = rows.find((row) => {
      if (row.global) return true;
      const targets = Array.isArray(row.alvos) ? row.alvos : [];
      return targets.some((target) => String(target.rota_alvo || '') === rota);
    });
    res.json({ ok: true, rota, manutencao: Boolean(match), detalhe: match || null });
  } catch (error) {
    res.status(200).json({ ok: true, rota, manutencao: false, aviso: error.message });
  }
});


function coerceUserTypeAndLevel(body = {}) {
  const requested = resolveRequestedAccess(body);
  const tipo = String(body.tipo_usuario || requested.tipoUsuario || 'aluno').trim().toLowerCase();
  if (['cliente','lojista','professor','admin','ti'].includes(tipo)) {
    return { tipoUsuario: tipo, nivelCodigo: tipo === 'ti' ? 'ti' : (body.nivel_codigo ? normalizeNivelCodigo(body.nivel_codigo) : (tipo === 'cliente' ? 'cliente' : 'neofito')) };
  }
  return { tipoUsuario: requested.tipoUsuario, nivelCodigo: requested.nivelCodigo };
}

app.post('/admin/criar-login', authenticateRequest, requireAdminOrTi, async (req, res) => {
  if (!requireDatabase(res)) return;
  const nome = String(req.body?.nome || '').trim();
  const email = normalizeEmail(req.body?.email);
  const senha = String(req.body?.senha || '');
  const ativo = req.body?.ativo !== false;
  const { tipoUsuario, nivelCodigo } = coerceUserTypeAndLevel(req.body || {});
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
  if (senha.length < 4) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 4 caracteres.' });
  try {
    await ensureAuthSchema();
    const senhaHash = hashPassword(senha);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ($1,$2,$3,$4,$5,NOW(),true)
       ON CONFLICT (email) DO UPDATE
       SET nome=EXCLUDED.nome, senha_hash=EXCLUDED.senha_hash, tipo_usuario=EXCLUDED.tipo_usuario, ativo=EXCLUDED.ativo, must_change_password=true
       RETURNING id,nome,email,tipo_usuario,ativo,must_change_password`,
      [nome, email, senhaHash, tipoUsuario, ativo]
    );
    const user = rows[0];
    await pool.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1,$2,NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo=EXCLUDED.nivel_codigo, atualizado_em=NOW()`,
      [user.id, nivelCodigo]
    );
    res.status(201).json({ ok: true, usuario: publicUser(user, nivelCodigo) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar login.' });
  }
});

app.get('/admin/usuarios-resumo', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  if (!pool) return res.json([]);
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT u.id,u.nome,u.email,u.tipo_usuario,u.ativo,u.must_change_password,n.nivel_codigo,u.data_cadastro
     FROM usuarios u LEFT JOIN usuario_niveis n ON n.usuario_id=u.id
     ORDER BY u.data_cadastro DESC LIMIT 200`
  );
  res.json(rows);
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/ti') || req.path.includes('.')) return next();
  const route = siteMemory.routes.find((item) => item.route === req.path && item.file && fs.existsSync(path.join(rootDir, item.file)));
  if (route) return res.sendFile(path.join(rootDir, route.file));
  return next();
});

app.get('/api/status', async (_req, res) => {
  const db = await databaseHealth();
  res.json({ ok: true, name: 'ordo-caoti', mode: 'landing-safe-auth', backend: 'online', database: db.status, db });
});

app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.status(200).sendFile(path.join(rootDir, 'index.html'));
  }
  res.status(404).json({ erro: 'Rota não encontrada.', route: req.path, fallback: 'site-memory' });
});

export default app;
