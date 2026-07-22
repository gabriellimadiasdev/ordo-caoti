import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  ['/alterar-senha', 'alterar-senha.html'],
  ['/primeiro-acesso', 'alterar-senha.html'],
  ['/regras', 'regras.html'],
  ['/loja', 'loja.html'],
]);

app.get([...htmlRoutes.keys()], (req, res) => sendHtml(res, htmlRoutes.get(req.path)));


const protectedUserHtmlRoutes = new Map([
  ['/dashboard', 'dashboard-aluno.html'],
  ['/dashboard-aluno', 'dashboard-aluno.html'],
  ['/dashboard-neofito', 'dashboard-aluno.html'],
  ['/dashboard-mago-n1', 'dashboard-aluno.html'],
  ['/dashboard-mago-n2', 'dashboard-aluno.html'],
  ['/dashboard-mago-n3', 'dashboard-aluno.html'],
  ['/dashboard-professor', 'dashboard-professor.html'],
  ['/dashboard-mentor', 'dashboard-professor.html'],
  ['/dashboard-cliente', 'dashboard-cliente.html'],
  ['/dashboard-cliente/reembolso', 'dashboard-cliente-reembolso.html'],
  ['/cliente/reembolso', 'dashboard-cliente-reembolso.html'],
  ['/dashboard-lojista', 'dashboard-lojista.html'],
  ['/lojista/financeiro', 'lojista-financeiro.html'],
  ['/biblioteca', 'biblioteca-livros.html'],
  ['/biblioteca-livros', 'biblioteca-livros.html'],
  ['/diario', 'diario.html'],
  ['/grimorio', 'grimorio.html'],
  ['/grimorio-publico', 'grimorio-publico.html'],
  ['/chat-alunos', 'chat-alunos.html'],
  ['/arquivos', 'arquivos.html'],
  ['/dados-primeiro-acesso', 'dados-primeiro-acesso.html'],
  ['/aulas', 'live-center.html'],
  ['/live-center', 'live-center.html'],
  ['/financeiro-escolar', 'financeiro-escolar.html'],
  ['/area-financeira-aluno', 'area-financeira-aluno.html'],
  ['/loja-checkout', 'loja-checkout.html'],
]);


const protectedTiHtmlRoutes = new Map([
  ['/dashboard-TI', 'dashboard-TI.html'],
  ['/dashboard-ti', 'dashboard-TI.html'],
  ['/manutencao-ti', 'manutencao-ti.html'],
  ['/ti/criar-login', 'ti-criar-login.html'],
  ['/admin/master', 'area-adm-1.html'],
  ['/admin/area-adm-1', 'area-adm-1.html'],
  ['/ti/admin/master', 'area-adm-1.html'],
  ['/admin/aprovacao-registro', 'aprovacao-de-registro.html'],
  ['/admin/aprovacao-de-registro', 'aprovacao-de-registro.html'],
  ['/ti/admin/aprovacao-registro', 'aprovacao-de-registro.html'],
  ['/admin/biblioteca', 'admin-biblioteca.html'],
  ['/admin/financeiro', 'admin-financeiro.html'],
  ['/admin/inscricoes-ordem', 'admin-inscricoes-ordem.html'],
  ['/admin/loja-produtos', 'admin-loja-produtos.html'],
  ['/admin/aprovacao-financeira', 'aprovacao-financeira.html'],
  ['/admin/area-financeira', 'area-financeira-adm.html'],
  ['/admin/anexar-arquivos', 'area-anexar-arquivos.html'],
  ['/ti/manutencao', 'manutencao-ti.html'],
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
  mentor: { id: 'mentor', label: 'Mentor', home_route: '/dashboard-professor' },
  admin: { id: 'admin', label: 'Admin', home_route: '/admin/master' },
  ti: { id: 'ti', label: 'T.I.', home_route: '/dashboard-TI' },
};

const hierarchyProfiles = ['neofito', 'mago_n1', 'mago_n2', 'mago_n3', 'mestre_fundador'];

function availableProfilesForUser(user = {}, nivelCodigo = 'neofito') {
  const profiles = new Set();
  const assigned = Array.isArray(user.perfis_atribuidos) ? normalizeProfileIds(user.perfis_atribuidos) : [];
  if (assigned.length) return assigned.map((id) => profileCatalog[id]);
  const tipo = String(user.tipo_usuario || '').toLowerCase();
  const nivel = normalizeNivelCodigo(nivelCodigo);

  if (tipo === 'cliente') profiles.add('cliente');
  if (tipo === 'lojista') profiles.add('lojista');
  if (tipo === 'professor') profiles.add('professor');
  if (tipo === 'mentor') profiles.add('mentor');
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

function normalizeProfileIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => profileCatalog[value]))];
}

function defaultProfileIdsForAccess(tipoUsuario = 'aluno', nivelCodigo = 'neofito') {
  return availableProfilesForUser({ tipo_usuario: tipoUsuario }, nivelCodigo).map((profile) => profile.id);
}

async function getAssignedProfileIds(usuarioId, fallbackUser = {}, nivelCodigo = 'neofito') {
  if (!pool || !usuarioId) return defaultProfileIdsForAccess(fallbackUser.tipo_usuario, nivelCodigo);
  const { rows } = await pool.query('SELECT perfil_codigo FROM usuario_perfis WHERE usuario_id = $1 ORDER BY perfil_codigo', [usuarioId]).catch(() => ({ rows: [] }));
  const stored = normalizeProfileIds(rows.map((row) => row.perfil_codigo));
  return stored.length ? stored : defaultProfileIdsForAccess(fallbackUser.tipo_usuario, nivelCodigo);
}

async function assignUserProfiles(client, usuarioId, profiles = [], tipoUsuario = 'aluno', nivelCodigo = 'neofito') {
  const selected = normalizeProfileIds(profiles);
  const finalProfiles = selected.length ? selected : defaultProfileIdsForAccess(tipoUsuario, nivelCodigo);
  await client.query('DELETE FROM usuario_perfis WHERE usuario_id = $1', [usuarioId]);
  for (const profileId of finalProfiles) {
    await client.query(
      `INSERT INTO usuario_perfis (usuario_id, perfil_codigo, criado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id, perfil_codigo) DO NOTHING`,
      [usuarioId, profileId]
    );
  }
  return finalProfiles;
}

async function ensureUserHasProfiles(client, usuarioId, profiles = [], tipoUsuario = 'aluno', nivelCodigo = 'neofito') {
  const existing = await client.query('SELECT 1 FROM usuario_perfis WHERE usuario_id = $1 LIMIT 1', [usuarioId]).catch(() => ({ rows: [] }));
  if (existing.rows.length) return getAssignedProfileIds(usuarioId, { tipo_usuario: tipoUsuario }, nivelCodigo);
  return assignUserProfiles(client, usuarioId, profiles, tipoUsuario, nivelCodigo);
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
      CREATE TABLE IF NOT EXISTS usuario_perfis (
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        perfil_codigo VARCHAR(30) NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (usuario_id, perfil_codigo)
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
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cadastro_completo BOOLEAN NOT NULL DEFAULT false`);
    const tiEmail = 'g.lima.rocha90@gmail.com';
    const tiPasswordHash = hashPassword('0000');
    const tiUser = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ('Gabriel Lima Dias Rocha', $1, $2, 'ti', true, NOW(), true)
       ON CONFLICT (email) DO UPDATE
       SET nome = COALESCE(usuarios.nome, EXCLUDED.nome), tipo_usuario = 'ti', ativo = true
       RETURNING id`,
      [tiEmail, tiPasswordHash]
    );
    await pool.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, 'ti', NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = 'ti', atualizado_em = NOW()`,
      [tiUser.rows[0].id]
    );
    await ensureUserHasProfiles(pool, tiUser.rows[0].id, ['ti', 'neofito', 'mago_n1'], 'ti', 'ti');

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
         SET nome = COALESCE(usuarios.nome, EXCLUDED.nome), tipo_usuario = 'admin', ativo = true
         RETURNING id`,
        [master.nome, master.email, masterPasswordHash]
      );
      await pool.query(
        `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
         VALUES ($1, 'mestre_fundador', NOW())
         ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = 'mestre_fundador', atualizado_em = NOW()`,
        [savedMaster.rows[0].id]
      );
      await ensureUserHasProfiles(pool, savedMaster.rows[0].id, ['admin', 'mestre_fundador', 'ti'], 'admin', 'mestre_fundador');
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
    must_complete_profile: user.cadastro_completo === false,
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
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ($1, $2, $3, $4, true, NOW(), true)
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro, must_change_password, cadastro_completo`,
      [nome, email, senhaHash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    user.perfis_atribuidos = await assignUserProfiles(client, user.id, [], tipoUsuario, nivelCodigo);
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
    user.perfis_atribuidos = await getAssignedProfileIds(user.id, user, nivelCodigo);
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
  const { rows } = await pool.query('SELECT id, nome, email, tipo_usuario, ativo, must_change_password, cadastro_completo, codigo_id FROM usuarios WHERE id = $1 LIMIT 1', [payload.id]);
  const user = rows[0];
  if (!user || user.ativo === false) return null;
  const nivelResult = await pool.query('SELECT nivel_codigo FROM usuario_niveis WHERE usuario_id = $1', [user.id]).catch(() => ({ rows: [] }));
  user.nivel_codigo = nivelResult.rows[0]?.nivel_codigo || (user.tipo_usuario === 'ti' ? 'ti' : 'neofito');
  user.perfis_atribuidos = await getAssignedProfileIds(user.id, user, user.nivel_codigo);
  return user;
}


async function requireUserPage(req, res, next) {
  try {
    await ensureAuthSchema();
    const user = await verifyActiveUserFromRequest(req);
    if (!user) return res.redirect('/login');
    req.user = user;
    next();
  } catch (_error) {
    return res.redirect('/login');
  }
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

app.get([...protectedUserHtmlRoutes.keys()], requireUserPage, (req, res) => sendHtml(res, protectedUserHtmlRoutes.get(req.path)));

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
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ($1, $2, $3, $4, true, NOW(), true)
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo_usuario = EXCLUDED.tipo_usuario, ativo = true, must_change_password = true
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro, must_change_password, cadastro_completo`,
      [request.nome, request.email, request.senha_hash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    user.perfis_atribuidos = await assignUserProfiles(client, user.id, [], tipoUsuario, nivelCodigo);
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
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ($1, $2, $3, $4, true, NOW(), true)
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo_usuario = EXCLUDED.tipo_usuario, ativo = true, must_change_password = true
       RETURNING id, nome, email, tipo_usuario, ativo, data_cadastro, must_change_password, cadastro_completo`,
      [request.nome, request.email, request.senha_hash, tipoUsuario]
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo = EXCLUDED.nivel_codigo, atualizado_em = NOW()`,
      [user.id, nivelCodigo]
    );
    user.perfis_atribuidos = await assignUserProfiles(client, user.id, [], tipoUsuario, nivelCodigo);
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
  await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'loja'`);
  await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS politica_entrega TEXT`);
  await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fiscal_metadata JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_publicacoes (id SERIAL PRIMARY KEY, produto_id INTEGER, lojista_id INTEGER, canal TEXT NOT NULL, status TEXT DEFAULT 'rascunho', checkout_url TEXT, payload JSONB DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS lojista_saldos (lojista_id INTEGER PRIMARY KEY, saldo_disponivel NUMERIC(12,2) DEFAULT 0, saldo_pendente NUMERIC(12,2) DEFAULT 0, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS repasses_lojista (id SERIAL PRIMARY KEY, lojista_id INTEGER, valor NUMERIC(12,2) NOT NULL, metodo TEXT NOT NULL, destino TEXT, status TEXT DEFAULT 'pendente', criado_em TIMESTAMPTZ DEFAULT NOW(), processado_em TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS produto_assistente_memoria (id SERIAL PRIMARY KEY, lojista_id INTEGER, produto_id INTEGER, pergunta TEXT, resposta TEXT, sugestao JSONB DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ DEFAULT NOW())`);
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
  await pool.query(`ALTER TABLE turmas ADD COLUMN IF NOT EXISTS codigo TEXT UNIQUE`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_id TEXT UNIQUE`);
  await pool.query(`CREATE TABLE IF NOT EXISTS auditoria_eventos (id SERIAL PRIMARY KEY, usuario_id INTEGER, acao TEXT NOT NULL, alvo_tipo TEXT, alvo_id TEXT, ip_origem TEXT, user_agent TEXT, metadata JSONB DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pessoa_dados_sensiveis (usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE, cpf_token TEXT, rg_token TEXT, dados_criptografados TEXT NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS aluno_matriculas (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL, codigo_aluno TEXT UNIQUE, status TEXT DEFAULT 'ativo', criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS materia_matriculas (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, materia_id INTEGER REFERENCES materias(id) ON DELETE CASCADE, tipo TEXT DEFAULT 'obrigatoria', status TEXT DEFAULT 'matriculado', criado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(usuario_id,materia_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workshops (id SERIAL PRIMARY KEY, codigo TEXT UNIQUE, titulo TEXT NOT NULL, descricao TEXT, obrigatorio BOOLEAN DEFAULT false, inicio_em TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workshop_matriculas (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, workshop_id INTEGER REFERENCES workshops(id) ON DELETE CASCADE, status TEXT DEFAULT 'matriculado', criado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(usuario_id,workshop_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS avaliacoes_alunos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL, nota NUMERIC(5,2), tipo TEXT DEFAULT 'avaliacao', observacao TEXT, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS presencas_alunos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL, aula_id INTEGER REFERENCES live_salas(id) ON DELETE SET NULL, presente BOOLEAN DEFAULT true, justificativa TEXT, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gamificacao_eventos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, tipo TEXT NOT NULL, pontos INTEGER DEFAULT 0, descricao TEXT, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS disciplina_eventos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, tipo TEXT NOT NULL, descricao TEXT, pontos INTEGER DEFAULT 0, visivel_para_usuario BOOLEAN DEFAULT true, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_canais (id SERIAL PRIMARY KEY, codigo TEXT UNIQUE, nome TEXT NOT NULL, escopo TEXT DEFAULT 'alunos', criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_mensagens (id SERIAL PRIMARY KEY, canal_id INTEGER REFERENCES chat_canais(id) ON DELETE CASCADE, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, mensagem TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS grimorio_publico (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, titulo TEXT NOT NULL, tipo_registro TEXT DEFAULT 'estudo', conteudo_texto TEXT NOT NULL, tags JSONB DEFAULT '[]'::jsonb, status TEXT DEFAULT 'publicado', criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS arquivos_nuvem (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, nome_original TEXT NOT NULL, mime_type TEXT, tamanho_bytes INTEGER DEFAULT 0, storage_provider TEXT DEFAULT 'postgres_fallback', storage_key TEXT, conteudo_base64 TEXT, publico BOOLEAN DEFAULT false, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`INSERT INTO chat_canais (codigo,nome,escopo) VALUES ('alunos-geral','Chat geral de alunos','alunos') ON CONFLICT (codigo) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_contratos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, tipo TEXT NOT NULL DEFAULT 'mensalidade', status TEXT DEFAULT 'ativo', valor_base NUMERIC(12,2) NOT NULL DEFAULT 0, dia_vencimento INTEGER DEFAULT 10, recorrencia TEXT DEFAULT 'mensal', inicio_em DATE DEFAULT CURRENT_DATE, fim_em DATE, metadata JSONB DEFAULT '{}'::jsonb, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_bolsas_descontos (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, contrato_id INTEGER REFERENCES financeiro_contratos(id) ON DELETE SET NULL, tipo TEXT NOT NULL DEFAULT 'desconto', descricao TEXT, percentual NUMERIC(6,2), valor NUMERIC(12,2), inicio_em DATE DEFAULT CURRENT_DATE, fim_em DATE, status TEXT DEFAULT 'ativo', criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_cobrancas (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, contrato_id INTEGER REFERENCES financeiro_contratos(id) ON DELETE SET NULL, pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL, origem TEXT DEFAULT 'manual', descricao TEXT NOT NULL, valor_original NUMERIC(12,2) NOT NULL DEFAULT 0, valor_desconto NUMERIC(12,2) NOT NULL DEFAULT 0, valor_final NUMERIC(12,2) NOT NULL DEFAULT 0, vencimento DATE NOT NULL, status TEXT DEFAULT 'aberta', serasa_status TEXT DEFAULT 'nao_elegivel', notificacoes_count INTEGER DEFAULT 0, metadata JSONB DEFAULT '{}'::jsonb, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_boletos (id SERIAL PRIMARY KEY, cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE, linha_digitavel TEXT NOT NULL, codigo_barras TEXT NOT NULL, nosso_numero TEXT NOT NULL, valor NUMERIC(12,2) NOT NULL, vencimento DATE NOT NULL, status TEXT DEFAULT 'emitido', criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_pagamentos (id SERIAL PRIMARY KEY, cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE SET NULL, pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, metodo TEXT NOT NULL DEFAULT 'interno', valor NUMERIC(12,2) NOT NULL DEFAULT 0, status TEXT DEFAULT 'pendente', referencia TEXT, comprovante_url TEXT, metadata JSONB DEFAULT '{}'::jsonb, pago_em TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_notificacoes (id SERIAL PRIMARY KEY, cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, canal TEXT DEFAULT 'interno', tipo TEXT DEFAULT 'vencimento', mensagem TEXT NOT NULL, status TEXT DEFAULT 'pendente', agendada_para TIMESTAMPTZ DEFAULT NOW(), enviada_em TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS financeiro_negativacao_eventos (id SERIAL PRIMARY KEY, cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, status TEXT DEFAULT 'preparado', motivo TEXT, payload JSONB DEFAULT '{}'::jsonb, criado_por INTEGER, criado_em TIMESTAMPTZ DEFAULT NOW())`);
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


app.post('/me/alterar-senha', authenticateRequest, async (req, res) => {
  const senhaAtual = String(req.body?.senha_atual || req.body?.senhaAtual || '');
  const novaSenha = String(req.body?.nova_senha || req.body?.novaSenha || '');
  if (!senhaAtual || !novaSenha) return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias.' });
  if (novaSenha.length < 6) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  if (senhaAtual === novaSenha) return res.status(400).json({ erro: 'A nova senha precisa ser diferente da senha atual.' });
  try {
    await ensureAuthSchema();
    const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1 LIMIT 1', [req.user.id]);
    if (!rows[0] || !(await verifyPassword(senhaAtual, rows[0].senha_hash))) {
      return res.status(401).json({ erro: 'Senha atual inválida.' });
    }
    await pool.query('UPDATE usuarios SET senha_hash = $2, must_change_password = false WHERE id = $1', [req.user.id, hashPassword(novaSenha)]);
    req.user.must_change_password = false;
    res.json({ ok: true, user: publicUser(req.user, req.userNivel, req.user?.perfil_login) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Falha ao alterar senha.' });
  }
});


function sensitiveKey() {
  return crypto.createHash('sha256').update(String(process.env.SUPABASE_ENCRYPTION_KEY || jwtSecret || 'ordo-caoti-sensitive-fallback')).digest();
}
function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sensitiveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value || {}), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}
function decryptJson(payload) {
  const raw = String(payload || '');
  const [, iv64, tag64, data64] = raw.split(':');
  if (!iv64 || !tag64 || !data64) return {};
  const decipher = crypto.createDecipheriv('aes-256-gcm', sensitiveKey(), Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data64, 'base64')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
function tokenHash(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}
function canReadSensitive(req, usuarioId) {
  const own = Number(req.user?.id) === Number(usuarioId);
  const role = String(req.user?.tipo_usuario || '').toLowerCase();
  const nivel = String(req.userNivel || req.user?.nivel_codigo || '').toLowerCase();
  return own || ['ti','admin'].includes(role) || ['mestre_fundador','mestre'].includes(nivel);
}
async function auditEvent(req, acao, alvoTipo = null, alvoId = null, metadata = {}) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO auditoria_eventos (usuario_id, acao, alvo_tipo, alvo_id, ip_origem, user_agent, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [req.user?.id || null, acao, alvoTipo, alvoId ? String(alvoId) : null, req.ip || null, req.headers['user-agent'] || null, JSON.stringify(metadata || {})]
  ).catch(() => {});
}

app.post('/api/auditoria/movimento', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  await auditEvent(req, 'page_view', 'route', req.body?.path || req.headers.referer || null, { title: req.body?.title || null });
  res.json({ ok: true });
});

app.get('/admin/auditoria', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query(`SELECT a.*, u.nome, u.email FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.criado_em DESC LIMIT 300`);
  res.json(rows);
});

app.get('/me/dados-completos', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT dados_criptografados, atualizado_em FROM pessoa_dados_sensiveis WHERE usuario_id=$1', [req.user.id]);
  const dados = rows[0]?.dados_criptografados ? decryptJson(rows[0].dados_criptografados) : null;
  res.json({ ok: true, completo: Boolean(dados), dados, atualizado_em: rows[0]?.atualizado_em || null });
});

app.put('/me/dados-completos', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const dados = {
    nome_completo: req.body?.nome_completo || req.user.nome,
    email: req.body?.email || req.user.email,
    whatsapp: req.body?.whatsapp || null,
    telefones_extras: Array.isArray(req.body?.telefones_extras) ? req.body.telefones_extras : [],
    endereco: req.body?.endereco || {},
    cpf: req.body?.cpf || null,
    rg: req.body?.rg || null,
    data_nascimento: req.body?.data_nascimento || null,
    foto_url: req.body?.foto_url || null,
    pagamento_cobranca: req.body?.pagamento_cobranca || {},
    consentimento_lgpd: Boolean(req.body?.consentimento_lgpd),
    atualizado_em: new Date().toISOString()
  };
  if (!dados.consentimento_lgpd) return res.status(400).json({ erro: 'Consentimento LGPD é obrigatório para salvar dados pessoais.' });
  await pool.query(
    `INSERT INTO pessoa_dados_sensiveis (usuario_id, cpf_token, rg_token, dados_criptografados, atualizado_em)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET cpf_token=EXCLUDED.cpf_token, rg_token=EXCLUDED.rg_token, dados_criptografados=EXCLUDED.dados_criptografados, atualizado_em=NOW()`,
    [req.user.id, tokenHash(dados.cpf), tokenHash(dados.rg), encryptJson(dados)]
  );
  await pool.query('UPDATE usuarios SET cadastro_completo=true WHERE id=$1', [req.user.id]);
  await auditEvent(req, 'personal_data_saved', 'usuario', req.user.id, { fields: Object.keys(dados).filter((key) => dados[key] !== null) });
  req.user.cadastro_completo = true;
  res.json({ ok: true, user: publicUser(req.user, req.userNivel, req.user?.perfil_login) });
});

app.get('/admin/dados-pessoais/:usuarioId', authenticateRequest, async (req, res) => {
  const usuarioId = Number(req.params.usuarioId);
  if (!canReadSensitive(req, usuarioId)) return res.status(403).json({ erro: 'Dados restritos ao próprio usuário, T.I. e mestres.' });
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT dados_criptografados, atualizado_em FROM pessoa_dados_sensiveis WHERE usuario_id=$1', [usuarioId]);
  if (!rows.length) return res.status(404).json({ erro: 'Dados não encontrados.' });
  await auditEvent(req, 'personal_data_read', 'usuario', usuarioId);
  res.json({ ok: true, dados: decryptJson(rows[0].dados_criptografados), atualizado_em: rows[0].atualizado_em });
});

app.get('/aluno/perfil-academico', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const usuarioId = req.user.id;
  const [matricula, materias, workshopsRows, notas, presencas, gamificacao, disciplina] = await Promise.all([
    pool.query(`SELECT am.*, t.nome AS turma_nome, t.codigo AS turma_codigo FROM aluno_matriculas am LEFT JOIN turmas t ON t.id=am.turma_id WHERE am.usuario_id=$1 ORDER BY am.criado_em DESC LIMIT 1`, [usuarioId]),
    pool.query(`SELECT mm.*, m.nome, m.tipo_materia, t.nome AS turma_nome FROM materia_matriculas mm JOIN materias m ON m.id=mm.materia_id LEFT JOIN turmas t ON t.id=m.turma_id WHERE mm.usuario_id=$1 ORDER BY m.nome`, [usuarioId]),
    pool.query(`SELECT wm.*, w.codigo, w.titulo, w.obrigatorio, w.inicio_em FROM workshop_matriculas wm JOIN workshops w ON w.id=wm.workshop_id WHERE wm.usuario_id=$1 ORDER BY w.inicio_em NULLS LAST`, [usuarioId]),
    pool.query(`SELECT * FROM avaliacoes_alunos WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 100`, [usuarioId]),
    pool.query(`SELECT * FROM presencas_alunos WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 100`, [usuarioId]),
    pool.query(`SELECT COALESCE(SUM(pontos),0)::int AS pontos, json_agg(gamificacao_eventos ORDER BY criado_em DESC) AS eventos FROM gamificacao_eventos WHERE usuario_id=$1`, [usuarioId]),
    pool.query(`SELECT * FROM disciplina_eventos WHERE usuario_id=$1 AND (visivel_para_usuario=true OR $2=ANY($3::text[])) ORDER BY criado_em DESC LIMIT 100`, [usuarioId, req.user.tipo_usuario, ['admin','ti']])
  ]);
  res.json({ ok: true, codigo_id: req.user.codigo_id || matricula.rows[0]?.codigo_aluno || `OC-${usuarioId}`, matricula: matricula.rows[0] || null, materias: materias.rows, workshops: workshopsRows.rows, notas: notas.rows, presencas: presencas.rows, faltas: presencas.rows.filter((p) => !p.presente), gamificacao: gamificacao.rows[0] || { pontos: 0, eventos: [] }, disciplina: disciplina.rows });
});

app.post('/admin/alunos/:usuarioId/matricula', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const usuarioId = Number(req.params.usuarioId);
  const codigoAluno = String(req.body?.codigo_aluno || `OC-${usuarioId}`).trim();
  const turmaId = req.body?.turma_id || null;
  const { rows } = await pool.query(
    `INSERT INTO aluno_matriculas (usuario_id,turma_id,codigo_aluno,status) VALUES ($1,$2,$3,$4)
     ON CONFLICT (codigo_aluno) DO UPDATE SET turma_id=EXCLUDED.turma_id,status=EXCLUDED.status
     RETURNING *`,
    [usuarioId, turmaId, codigoAluno, req.body?.status || 'ativo']
  );
  await pool.query('UPDATE usuarios SET codigo_id=COALESCE(codigo_id,$2) WHERE id=$1', [usuarioId, codigoAluno]);
  await auditEvent(req, 'student_enrollment_saved', 'usuario', usuarioId, { turma_id: turmaId });
  res.status(201).json({ ok: true, matricula: rows[0] });
});

app.post('/admin/alunos/:usuarioId/nota', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO avaliacoes_alunos (usuario_id,materia_id,nota,tipo,observacao,criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [Number(req.params.usuarioId), req.body?.materia_id || null, req.body?.nota ?? null, req.body?.tipo || 'avaliacao', req.body?.observacao || null, req.user.id]);
  await auditEvent(req, 'student_grade_saved', 'usuario', req.params.usuarioId);
  res.status(201).json({ ok: true, nota: rows[0] });
});

app.post('/admin/alunos/:usuarioId/presenca', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO presencas_alunos (usuario_id,materia_id,aula_id,presente,justificativa,criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [Number(req.params.usuarioId), req.body?.materia_id || null, req.body?.aula_id || null, req.body?.presente !== false, req.body?.justificativa || null, req.user.id]);
  await auditEvent(req, 'student_attendance_saved', 'usuario', req.params.usuarioId);
  res.status(201).json({ ok: true, presenca: rows[0] });
});

app.get('/grimorio/publico', authenticateRequest, async (_req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query(`SELECT gp.*, u.nome AS autor_nome FROM grimorio_publico gp LEFT JOIN usuarios u ON u.id=gp.usuario_id WHERE gp.status='publicado' ORDER BY gp.criado_em DESC LIMIT 100`);
  res.json(rows);
});

app.post('/grimorio/publico', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const allowed = new Set(['mago_n1','mago_n2','mago_n3','mestre_fundador','mentor','professor','admin','ti']);
  const userProfiles = availableProfilesForUser(req.user, req.userNivel).map((p) => p.id);
  if (!userProfiles.some((profile) => allowed.has(profile))) return res.status(403).json({ erro: 'Publicação restrita a magos iniciados, elevados, soberanos, mestres e mentores.' });
  const { rows } = await pool.query('INSERT INTO grimorio_publico (usuario_id,titulo,tipo_registro,conteudo_texto,tags,status) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *', [req.user.id, req.body?.titulo || 'Registro público', req.body?.tipo_registro || 'estudo', req.body?.conteudo_texto || '', JSON.stringify(req.body?.tags || []), 'publicado']);
  await auditEvent(req, 'public_grimoire_posted', 'grimorio_publico', rows[0].id);
  res.status(201).json(rows[0]);
});

app.get('/chat/alunos/canais', authenticateRequest, async (_req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query("SELECT * FROM chat_canais WHERE escopo='alunos' ORDER BY nome");
  res.json(rows);
});
app.get('/chat/alunos/:canalCodigo/mensagens', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query(`SELECT cm.*, u.nome AS autor_nome FROM chat_mensagens cm JOIN chat_canais cc ON cc.id=cm.canal_id LEFT JOIN usuarios u ON u.id=cm.usuario_id WHERE cc.codigo=$1 ORDER BY cm.criado_em DESC LIMIT 100`, [req.params.canalCodigo]);
  res.json(rows.reverse());
});
app.post('/chat/alunos/:canalCodigo/mensagens', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const channel = await pool.query('SELECT id FROM chat_canais WHERE codigo=$1 LIMIT 1', [req.params.canalCodigo]);
  if (!channel.rows.length) return res.status(404).json({ erro: 'Canal não encontrado.' });
  const mensagem = String(req.body?.mensagem || '').trim();
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem obrigatória.' });
  const { rows } = await pool.query('INSERT INTO chat_mensagens (canal_id,usuario_id,mensagem) VALUES ($1,$2,$3) RETURNING *', [channel.rows[0].id, req.user.id, mensagem.slice(0, 4000)]);
  await auditEvent(req, 'chat_message_sent', 'chat_canal', req.params.canalCodigo);
  res.status(201).json(rows[0]);
});

app.get('/api/arquivos', authenticateRequest, async (_req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query(`SELECT id,nome_original,mime_type,tamanho_bytes,storage_provider,publico,criado_em FROM arquivos_nuvem ORDER BY criado_em DESC LIMIT 100`);
  res.json(rows);
});
app.post('/api/arquivos/upload', authenticateRequest, upload.single('arquivo'), async (req, res) => {
  await ensureCoreTables();
  if (!req.file) return res.status(400).json({ erro: 'Arquivo obrigatório.' });
  const provider = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase_configured_fallback_saved' : 'postgres_fallback';
  const { rows } = await pool.query('INSERT INTO arquivos_nuvem (usuario_id,nome_original,mime_type,tamanho_bytes,storage_provider,storage_key,conteudo_base64,publico) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nome_original,mime_type,tamanho_bytes,storage_provider,criado_em', [req.user.id, req.file.originalname, req.file.mimetype, req.file.size, provider, crypto.randomUUID(), req.file.buffer.toString('base64'), req.body?.publico === 'true']);
  await auditEvent(req, 'file_uploaded', 'arquivo', rows[0].id, { nome: req.file.originalname, bytes: req.file.size });
  res.status(201).json({ ok: true, arquivo: rows[0] });
});
app.get('/api/arquivos/:id/download', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM arquivos_nuvem WHERE id=$1', [Number(req.params.id)]);
  const file = rows[0];
  if (!file) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  await auditEvent(req, 'file_downloaded', 'arquivo', file.id);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(file.nome_original || 'arquivo').replace(/"/g, '')}"`);
  res.send(Buffer.from(file.conteudo_base64 || '', 'base64'));
});

app.get('/api/integracoes/status', authenticateRequest, (_req, res) => {
  res.json({ ok: true, providers: { daily: Boolean(process.env.DAILY_API_KEY), google: Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_SERVICE_ACCOUNT_JSON), zoom: Boolean(process.env.ZOOM_CLIENT_ID), teams: Boolean(process.env.MICROSOFT_CLIENT_ID), supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), aws_s3: Boolean(process.env.AWS_S3_BUCKET) }, fallback_interno: true });
});
app.post('/api/google/importar-classroom', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await auditEvent(req, 'google_classroom_import_requested', 'integration', 'google_classroom');
  res.json({ ok: true, imported: false, provider_configured: Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_SERVICE_ACCOUNT_JSON), fallback: 'Importação manual disponível: envie CSV/JSON pelo módulo de arquivos até configurar credenciais Google.' });
});
app.post('/api/google/importar-drive', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await auditEvent(req, 'google_drive_import_requested', 'integration', 'google_drive');
  res.json({ ok: true, imported: false, provider_configured: Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_SERVICE_ACCOUNT_JSON), fallback: 'Drive externo exige credenciais Google; uploads internos já funcionam em /arquivos/upload.' });
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


function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}
function internalBoleto(cobranca) {
  const id = String(cobranca.id || Date.now()).padStart(8, '0');
  const value = String(Math.round(money(cobranca.valor_final) * 100)).padStart(10, '0');
  const due = String(cobranca.vencimento || '').replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
  const nossoNumero = `OC${id}`;
  return {
    nosso_numero: nossoNumero,
    codigo_barras: `23790${id}${due}${value}`,
    linha_digitavel: `23790.0000${id.slice(-4)} ${due.slice(0,4)}.${due.slice(4)} ${value.slice(0,5)}.${value.slice(5)} 1 ${value}`
  };
}
async function financialDiscountFor(usuarioId, contratoId, valorBase) {
  const { rows } = await pool.query(
    `SELECT * FROM financeiro_bolsas_descontos
     WHERE usuario_id=$1 AND status='ativo' AND ($2::int IS NULL OR contrato_id IS NULL OR contrato_id=$2)
       AND (fim_em IS NULL OR fim_em >= CURRENT_DATE)
     ORDER BY criado_em DESC`,
    [usuarioId, contratoId || null]
  );
  return rows.reduce((total, item) => total + (item.percentual ? money(valorBase) * Number(item.percentual) / 100 : money(item.valor)), 0);
}
async function createCharge({ usuarioId, contratoId = null, pedidoId = null, origem = 'manual', descricao, valor, vencimento, metadata = {}, criadoPor = null }) {
  const desconto = contratoId ? await financialDiscountFor(usuarioId, contratoId, valor) : 0;
  const finalValue = Math.max(0, money(valor) - money(desconto));
  const { rows } = await pool.query(
    `INSERT INTO financeiro_cobrancas (usuario_id, contrato_id, pedido_id, origem, descricao, valor_original, valor_desconto, valor_final, vencimento, metadata, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
    [usuarioId, contratoId, pedidoId, origem, descricao, money(valor), money(desconto), finalValue, vencimento, JSON.stringify(metadata || {}), criadoPor]
  );
  const cobranca = rows[0];
  const boleto = internalBoleto(cobranca);
  await pool.query(
    `INSERT INTO financeiro_boletos (cobranca_id, linha_digitavel, codigo_barras, nosso_numero, valor, vencimento)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [cobranca.id, boleto.linha_digitavel, boleto.codigo_barras, boleto.nosso_numero, cobranca.valor_final, cobranca.vencimento]
  ).catch(() => {});
  await pool.query(
    `INSERT INTO financeiro_notificacoes (cobranca_id, usuario_id, canal, tipo, mensagem, agendada_para)
     VALUES ($1,$2,'interno','vencimento',$3,($4::date - INTERVAL '3 days')),($1,$2,'interno','vencimento',$5,$4::date),($1,$2,'interno','atraso',$6,($4::date + INTERVAL '7 days'))`,
    [cobranca.id, usuarioId, `Lembrete: ${descricao} vence em ${vencimento}.`, `Pagamento vence hoje: ${descricao}.`, `Pagamento em atraso: ${descricao}.`, vencimento]
  ).catch(() => {});
  return cobranca;
}

app.post('/admin/financeiro/contratos', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const usuarioId = Number(req.body?.usuario_id);
  if (!usuarioId) return res.status(400).json({ erro: 'usuario_id obrigatório.' });
  const { rows } = await pool.query(
    `INSERT INTO financeiro_contratos (usuario_id,tipo,status,valor_base,dia_vencimento,recorrencia,inicio_em,fim_em,metadata,criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
    [usuarioId, req.body?.tipo || 'mensalidade', req.body?.status || 'ativo', money(req.body?.valor_base), Number(req.body?.dia_vencimento || 10), req.body?.recorrencia || 'mensal', req.body?.inicio_em || new Date().toISOString().slice(0,10), req.body?.fim_em || null, JSON.stringify(req.body?.metadata || {}), req.user.id]
  );
  await auditEvent(req, 'financial_contract_created', 'usuario', usuarioId, { contrato_id: rows[0].id });
  res.status(201).json({ ok: true, contrato: rows[0] });
});

app.post('/admin/financeiro/bolsas-descontos', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const usuarioId = Number(req.body?.usuario_id);
  if (!usuarioId) return res.status(400).json({ erro: 'usuario_id obrigatório.' });
  const { rows } = await pool.query(
    `INSERT INTO financeiro_bolsas_descontos (usuario_id,contrato_id,tipo,descricao,percentual,valor,inicio_em,fim_em,status,criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [usuarioId, req.body?.contrato_id || null, req.body?.tipo || 'desconto', req.body?.descricao || null, req.body?.percentual ?? null, req.body?.valor ?? null, req.body?.inicio_em || new Date().toISOString().slice(0,10), req.body?.fim_em || null, req.body?.status || 'ativo', req.user.id]
  );
  await auditEvent(req, 'scholarship_discount_saved', 'usuario', usuarioId, { desconto_id: rows[0].id });
  res.status(201).json({ ok: true, desconto: rows[0] });
});

app.post('/admin/financeiro/cobrancas', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const usuarioId = Number(req.body?.usuario_id);
  if (!usuarioId || !req.body?.descricao || !req.body?.vencimento) return res.status(400).json({ erro: 'usuario_id, descricao e vencimento são obrigatórios.' });
  const cobranca = await createCharge({ usuarioId, contratoId: req.body?.contrato_id || null, origem: req.body?.origem || 'manual', descricao: req.body.descricao, valor: req.body?.valor, vencimento: req.body.vencimento, metadata: req.body?.metadata || {}, criadoPor: req.user.id });
  await auditEvent(req, 'charge_created', 'usuario', usuarioId, { cobranca_id: cobranca.id });
  res.status(201).json({ ok: true, cobranca });
});

app.post('/admin/financeiro/gerar-mensalidades', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const competencia = String(req.body?.competencia || new Date().toISOString().slice(0,7));
  const { rows: contratos } = await pool.query("SELECT * FROM financeiro_contratos WHERE status='ativo' AND tipo='mensalidade'");
  const criadas = [];
  for (const contrato of contratos) {
    const due = `${competencia}-${String(contrato.dia_vencimento || 10).padStart(2,'0')}`;
    const exists = await pool.query("SELECT id FROM financeiro_cobrancas WHERE contrato_id=$1 AND metadata->>'competencia'=$2 LIMIT 1", [contrato.id, competencia]);
    if (exists.rows.length) continue;
    criadas.push(await createCharge({ usuarioId: contrato.usuario_id, contratoId: contrato.id, origem: 'mensalidade', descricao: `Mensalidade ${competencia}`, valor: contrato.valor_base, vencimento: due, metadata: { competencia }, criadoPor: req.user.id }));
  }
  await auditEvent(req, 'monthly_charges_generated', 'financeiro', competencia, { total: criadas.length });
  res.json({ ok: true, competencia, criadas });
});

app.get('/financeiro/cobrancas', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const isAdmin = ['admin','ti'].includes(String(req.user.tipo_usuario).toLowerCase());
  const usuarioId = isAdmin && req.query?.usuario_id ? Number(req.query.usuario_id) : req.user.id;
  const { rows } = await pool.query(`SELECT c.*, b.linha_digitavel, b.codigo_barras, b.nosso_numero FROM financeiro_cobrancas c LEFT JOIN financeiro_boletos b ON b.cobranca_id=c.id WHERE c.usuario_id=$1 ORDER BY c.vencimento DESC LIMIT 200`, [usuarioId]);
  res.json(rows);
});

app.post('/financeiro/cobrancas/:id/pagar-interno', authenticateRequest, async (req, res) => {
  await ensureCoreTables();
  const id = Number(req.params.id);
  const charge = await pool.query('SELECT * FROM financeiro_cobrancas WHERE id=$1', [id]);
  const cobranca = charge.rows[0];
  if (!cobranca) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
  if (cobranca.usuario_id !== req.user.id && !['admin','ti'].includes(req.user.tipo_usuario)) return res.status(403).json({ erro: 'Cobrança restrita.' });
  const { rows } = await pool.query('INSERT INTO financeiro_pagamentos (cobranca_id,usuario_id,metodo,valor,status,referencia,metadata,pago_em) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) RETURNING *', [id, cobranca.usuario_id, req.body?.metodo || 'interno', money(req.body?.valor || cobranca.valor_final), req.body?.status || 'confirmado', req.body?.referencia || crypto.randomUUID(), JSON.stringify(req.body?.metadata || {})]);
  await pool.query("UPDATE financeiro_cobrancas SET status='paga' WHERE id=$1", [id]);
  await auditEvent(req, 'internal_payment_registered', 'cobranca', id);
  res.status(201).json({ ok: true, pagamento: rows[0] });
});

app.post('/admin/financeiro/notificacoes/processar', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const { rows } = await pool.query("UPDATE financeiro_notificacoes SET status='enviada', enviada_em=NOW() WHERE status='pendente' AND agendada_para <= NOW() RETURNING *");
  for (const row of rows) await pool.query('UPDATE financeiro_cobrancas SET notificacoes_count=notificacoes_count+1 WHERE id=$1', [row.cobranca_id]).catch(() => {});
  res.json({ ok: true, enviadas: rows });
});

app.post('/admin/financeiro/cobrancas/:id/preparar-negativacao', authenticateRequest, requireAdminOrTi, async (req, res) => {
  await ensureCoreTables();
  const id = Number(req.params.id);
  const { rows } = await pool.query("SELECT * FROM financeiro_cobrancas WHERE id=$1 AND status <> 'paga'", [id]);
  const cobranca = rows[0];
  if (!cobranca) return res.status(404).json({ erro: 'Cobrança aberta não encontrada.' });
  if (Number(cobranca.notificacoes_count || 0) < 3) return res.status(409).json({ erro: 'Negativação bloqueada: envie e registre pelo menos 3 notificações prévias.' });
  const payload = { cobranca_id: id, usuario_id: cobranca.usuario_id, valor: cobranca.valor_final, vencimento: cobranca.vencimento, aviso: 'Payload interno para análise humana/jurídica antes de envio a birôs como Serasa.' };
  const event = await pool.query("INSERT INTO financeiro_negativacao_eventos (cobranca_id,usuario_id,status,motivo,payload,criado_por) VALUES ($1,$2,'preparado',$3,$4::jsonb,$5) RETURNING *", [id, cobranca.usuario_id, req.body?.motivo || 'inadimplencia_notificada', JSON.stringify(payload), req.user.id]);
  await pool.query("UPDATE financeiro_cobrancas SET serasa_status='preparado' WHERE id=$1", [id]);
  await auditEvent(req, 'debt_collection_prepared', 'cobranca', id);
  res.status(201).json({ ok: true, evento: event.rows[0], payload });
});

app.get('/admin/financeiro/resumo', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  await ensureCoreTables();
  const [cobrancas, pagamentos, contratos, descontos] = await Promise.all([
    pool.query("SELECT status, COUNT(*)::int total, COALESCE(SUM(valor_final),0)::numeric valor FROM financeiro_cobrancas GROUP BY status"),
    pool.query("SELECT status, COUNT(*)::int total, COALESCE(SUM(valor),0)::numeric valor FROM financeiro_pagamentos GROUP BY status"),
    pool.query("SELECT COUNT(*)::int total FROM financeiro_contratos WHERE status='ativo'"),
    pool.query("SELECT COUNT(*)::int total FROM financeiro_bolsas_descontos WHERE status='ativo'")
  ]);
  res.json({ ok: true, cobrancas: cobrancas.rows, pagamentos: pagamentos.rows, contratos_ativos: contratos.rows[0]?.total || 0, bolsas_descontos_ativos: descontos.rows[0]?.total || 0 });
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
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    const total = money(req.body?.total || req.body?.valor || itens.reduce((sum, item) => sum + Number(item.preco || item.valor || 0) * Number(item.quantidade || 1), 0));
    const metodo = String(req.body?.metodo || 'boleto_interno').toLowerCase();
    const pedido = await pool.query(
      'INSERT INTO pedidos (usuario_id, descricao, total, status, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *',
      [req.user.id, req.body?.descricao || 'Checkout Ordo Caoti', total, 'aguardando_pagamento', JSON.stringify({ ...req.body, conformidade: { politica: 'estrutura interna; validar emissão fiscal e termos antes de produção' } })]
    );
    const vencimento = req.body?.vencimento || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
    const cobranca = await createCharge({ usuarioId: req.user.id, pedidoId: pedido.rows[0].id, origem: 'loja', descricao: `Pedido loja #${pedido.rows[0].id}`, valor: total, vencimento, metadata: { metodo, itens }, criadoPor: req.user.id });
    await auditEvent(req, 'store_checkout_created', 'pedido', pedido.rows[0].id, { total, metodo });
    res.status(201).json({ ok: true, pedido_id: pedido.rows[0].id, pedido: pedido.rows[0], cobranca, pagamento_interno: { metodo, status: 'aguardando_pagamento' }, mercado_pago: { configured: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN) } });
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


const marketplaceChannels = ['mercado_pago', 'mercado_livre', 'shopee', 'tiktok_shop', 'nuvemshop', 'shopify'];

function productCheckoutUrl(req, produtoId) {
  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}/loja?produto=${encodeURIComponent(produtoId)}`;
}

function buildProductAssistantSuggestion(input = {}) {
  const nome = String(input.nome || 'Produto Ordo Caoti').trim();
  const tipo = String(input.tipo || 'fisico').trim();
  const custo = Number(input.custo || 0);
  const gastos = Number(input.gastos || input.gastos_estimados || 0);
  const margemBase = Math.max(custo + gastos, Number(input.preco_base || 0));
  const precoSugerido = Math.max(Number(input.preco || 0), margemBase > 0 ? margemBase / 0.8 : 80);
  const lucroEstimado = Math.max(precoSugerido - custo - gastos, 0);
  const lojista = lucroEstimado * 0.8;
  const ordo = lucroEstimado * 0.2;
  const perguntas = [
    `Qual problema ${nome} resolve para o cliente?`,
    'Quais materiais, itens de fabricação ou horas de serviço entram no custo?',
    'O produto é pronta entrega, sob encomenda ou digital?',
    'Qual prazo realista de entrega ou execução?',
    'Quais dúvidas, objeções ou medos o cliente costuma ter antes de comprar?',
    'Há variações de tamanho, cor, turma, duração, bônus ou garantia?'
  ];
  return {
    nome,
    tipo,
    categoria: input.categoria || (tipo === 'servico' ? 'Serviços' : 'Loja Ordo Caoti'),
    estoque: Number(input.estoque || 0),
    sob_encomenda: Boolean(input.sob_encomenda || tipo === 'servico'),
    descricao_melhorada: `${nome} foi estruturado para apresentar valor claro, benefícios objetivos, composição/custo transparente e compra segura dentro da Ordo Caoti.`,
    perguntas_cliente: perguntas,
    precificacao: {
      preco_sugerido: Number(precoSugerido.toFixed(2)),
      custo_estimado: Number(custo.toFixed(2)),
      gastos_estimados: Number(gastos.toFixed(2)),
      lucro_estimado: Number(lucroEstimado.toFixed(2)),
      repasse_lojista_80: Number(lojista.toFixed(2)),
      repasse_ordo_20: Number(ordo.toFixed(2)),
      preferencia_mestre: 'Caio Zanoni'
    }
  };
}

app.post('/lojista/produtos/assistente', authenticateRequest, async (req, res) => {
  const sugestao = buildProductAssistantSuggestion(req.body || {});
  if (pool) {
    await ensureCoreTables();
    await pool.query('INSERT INTO produto_assistente_memoria (lojista_id, pergunta, resposta, sugestao) VALUES ($1,$2,$3,$4::jsonb)', [req.user.id, 'assistente_produto', JSON.stringify(req.body || {}), JSON.stringify(sugestao)]).catch(() => {});
  }
  res.json({ ok: true, sugestao });
});

app.get('/lojista/marketplaces', authenticateRequest, (_req, res) => {
  res.json({ ok: true, channels: marketplaceChannels.map((id) => ({ id, configured: Boolean(process.env[id.toUpperCase() + '_ACCESS_TOKEN'] || process.env[id.toUpperCase() + '_API_KEY']), checkout_policy: 'redirect_to_ordocaoti' })) });
});

app.post('/lojista/produtos/:id/publicar-marketplaces', authenticateRequest, async (req, res) => {
  const produtoId = Number(req.params.id);
  const canais = Array.isArray(req.body?.canais) && req.body.canais.length ? req.body.canais : marketplaceChannels;
  const checkout = productCheckoutUrl(req, produtoId);
  if (pool) await ensureCoreTables();
  const publicacoes = [];
  for (const canal of canais.filter((c) => marketplaceChannels.includes(String(c)))) {
    const payload = { canal, produto_id: produtoId, checkout_url: checkout, redirect: 'ordocaoti' };
    if (pool) {
      const { rows } = await pool.query('INSERT INTO marketplace_publicacoes (produto_id, lojista_id, canal, status, checkout_url, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *', [produtoId, req.user.id, canal, 'preparado', checkout, JSON.stringify(payload)]);
      publicacoes.push(rows[0]);
    } else publicacoes.push(payload);
  }
  res.json({ ok: true, checkout_url: checkout, publicacoes });
});

app.get('/lojista/saldo', authenticateRequest, async (req, res) => {
  if (!pool) return res.json({ saldo_disponivel: 0, saldo_pendente: 0, offline: true });
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO lojista_saldos (lojista_id) VALUES ($1) ON CONFLICT (lojista_id) DO UPDATE SET atualizado_em=NOW() RETURNING *', [req.user.id]);
  res.json(rows[0]);
});

app.post('/lojista/repasses', authenticateRequest, async (req, res) => {
  const valor = Number(req.body?.valor || 0);
  const metodo = String(req.body?.metodo || 'pix').toLowerCase();
  const destino = String(req.body?.destino || '').trim();
  if (!['pix','boleto','transferencia','manual'].includes(metodo)) return res.status(400).json({ erro: 'Método de repasse inválido.' });
  if (valor <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  if (!pool) return res.status(201).json({ ok: true, offline: true, repasse: { valor, metodo, destino, status: 'pendente' } });
  await ensureCoreTables();
  const { rows } = await pool.query('INSERT INTO repasses_lojista (lojista_id, valor, metodo, destino) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, valor, metodo, destino]);
  res.status(201).json({ ok: true, repasse: rows[0] });
});

app.get('/lojista/repasses', authenticateRequest, async (req, res) => {
  if (!pool) return res.json([]);
  await ensureCoreTables();
  const { rows } = await pool.query('SELECT * FROM repasses_lojista WHERE lojista_id=$1 ORDER BY criado_em DESC LIMIT 100', [req.user.id]);
  res.json(rows);
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
  if (['cliente','lojista','professor','mentor','admin','ti'].includes(tipo)) {
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
  const requestedProfiles = normalizeProfileIds(req.body?.perfis || req.body?.profiles || []);
  const { tipoUsuario, nivelCodigo } = coerceUserTypeAndLevel(req.body || {});
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
  if (senha.length < 4) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 4 caracteres.' });
  const client = await pool.connect();
  try {
    await ensureAuthSchema();
    await client.query('BEGIN');
    const senhaHash = hashPassword(senha);
    const { rows } = await client.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ativo, data_cadastro, must_change_password)
       VALUES ($1,$2,$3,$4,$5,NOW(),true)
       ON CONFLICT (email) DO UPDATE
       SET nome=EXCLUDED.nome, senha_hash=EXCLUDED.senha_hash, tipo_usuario=EXCLUDED.tipo_usuario, ativo=EXCLUDED.ativo, must_change_password=true
       RETURNING id,nome,email,tipo_usuario,ativo,must_change_password,cadastro_completo`,
      [nome, email, senhaHash, tipoUsuario, ativo]
    );
    const user = rows[0];
    await client.query(
      `INSERT INTO usuario_niveis (usuario_id, nivel_codigo, atualizado_em)
       VALUES ($1,$2,NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET nivel_codigo=EXCLUDED.nivel_codigo, atualizado_em=NOW()`,
      [user.id, nivelCodigo]
    );
    user.perfis_atribuidos = await assignUserProfiles(client, user.id, requestedProfiles, tipoUsuario, nivelCodigo);
    await client.query('COMMIT');
    res.status(201).json({ ok: true, usuario: publicUser(user, nivelCodigo) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ erro: 'Falha ao criar login.' });
  } finally {
    client.release();
  }
});

app.get('/admin/usuarios-resumo', authenticateRequest, requireAdminOrTi, async (_req, res) => {
  if (!pool) return res.json([]);
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT u.id,u.nome,u.email,u.tipo_usuario,u.ativo,u.must_change_password,n.nivel_codigo,u.data_cadastro,
            COALESCE(json_agg(up.perfil_codigo ORDER BY up.perfil_codigo) FILTER (WHERE up.perfil_codigo IS NOT NULL), '[]'::json) AS perfis
     FROM usuarios u
     LEFT JOIN usuario_niveis n ON n.usuario_id=u.id
     LEFT JOIN usuario_perfis up ON up.usuario_id=u.id
     GROUP BY u.id,n.nivel_codigo
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
    return res.status(404).type('html').send(`<h1>Rota não encontrada</h1><p>${req.path}</p><p><a href="/">Voltar ao início</a></p>`);
  }
  res.status(404).json({ erro: 'Rota não encontrada.', route: req.path });
});

export default app;
