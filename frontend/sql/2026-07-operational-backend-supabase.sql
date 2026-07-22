-- Ordo Caoti operational backend schema for Supabase/Postgres
-- Safe to run more than once. Secrets stay in Vercel/Supabase env vars, never in Git.

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  tipo_usuario VARCHAR(30) NOT NULL DEFAULT 'aluno',
  ativo BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  cadastro_completo BOOLEAN NOT NULL DEFAULT false,
  codigo_id TEXT UNIQUE,
  data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario_niveis (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  nivel_codigo VARCHAR(30) NOT NULL DEFAULT 'neofito',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario_perfis (
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  perfil_codigo VARCHAR(30) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, perfil_codigo)
);

CREATE TABLE IF NOT EXISTS auditoria_eventos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  alvo_tipo TEXT,
  alvo_id TEXT,
  ip_origem TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pessoa_dados_sensiveis (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  cpf_token TEXT,
  rg_token TEXT,
  dados_criptografados TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turmas (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo_materia TEXT DEFAULT 'obrigatoria',
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aluno_matriculas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  codigo_aluno TEXT UNIQUE,
  status TEXT DEFAULT 'ativo',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materia_matriculas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id INTEGER REFERENCES materias(id) ON DELETE CASCADE,
  tipo TEXT DEFAULT 'obrigatoria',
  status TEXT DEFAULT 'matriculado',
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, materia_id)
);

CREATE TABLE IF NOT EXISTS workshops (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  obrigatorio BOOLEAN DEFAULT false,
  inicio_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshop_matriculas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  workshop_id INTEGER REFERENCES workshops(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'matriculado',
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, workshop_id)
);

CREATE TABLE IF NOT EXISTS live_salas (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  provider TEXT DEFAULT 'internal',
  status TEXT DEFAULT 'pendente',
  link_sala TEXT,
  inicio_previsto TIMESTAMPTZ,
  fim_previsto TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS avaliacoes_alunos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  nota NUMERIC(5,2),
  tipo TEXT DEFAULT 'avaliacao',
  observacao TEXT,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presencas_alunos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  aula_id INTEGER REFERENCES live_salas(id) ON DELETE SET NULL,
  presente BOOLEAN DEFAULT true,
  justificativa TEXT,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gamificacao_eventos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  pontos INTEGER DEFAULT 0,
  descricao TEXT,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disciplina_eventos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT,
  pontos INTEGER DEFAULT 0,
  visivel_para_usuario BOOLEAN DEFAULT true,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_canais (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  nome TEXT NOT NULL,
  escopo TEXT DEFAULT 'alunos',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_mensagens (
  id SERIAL PRIMARY KEY,
  canal_id INTEGER REFERENCES chat_canais(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  mensagem TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grimorio_publico (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  tipo_registro TEXT DEFAULT 'estudo',
  conteudo_texto TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'publicado',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arquivos_nuvem (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nome_original TEXT NOT NULL,
  mime_type TEXT,
  tamanho_bytes INTEGER DEFAULT 0,
  storage_provider TEXT DEFAULT 'postgres_fallback',
  storage_key TEXT,
  conteudo_base64 TEXT,
  publico BOOLEAN DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO chat_canais (codigo, nome, escopo)
VALUES ('alunos-geral', 'Chat geral de alunos', 'alunos')
ON CONFLICT (codigo) DO NOTHING;

-- Financeiro escolar e loja interna
CREATE TABLE IF NOT EXISTS financeiro_contratos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'mensalidade',
  status TEXT DEFAULT 'ativo',
  valor_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  dia_vencimento INTEGER DEFAULT 10,
  recorrencia TEXT DEFAULT 'mensal',
  inicio_em DATE DEFAULT CURRENT_DATE,
  fim_em DATE,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_bolsas_descontos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  contrato_id INTEGER REFERENCES financeiro_contratos(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'desconto',
  descricao TEXT,
  percentual NUMERIC(6,2),
  valor NUMERIC(12,2),
  inicio_em DATE DEFAULT CURRENT_DATE,
  fim_em DATE,
  status TEXT DEFAULT 'ativo',
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_cobrancas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  contrato_id INTEGER REFERENCES financeiro_contratos(id) ON DELETE SET NULL,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  origem TEXT DEFAULT 'manual',
  descricao TEXT NOT NULL,
  valor_original NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_final NUMERIC(12,2) NOT NULL DEFAULT 0,
  vencimento DATE NOT NULL,
  status TEXT DEFAULT 'aberta',
  serasa_status TEXT DEFAULT 'nao_elegivel',
  notificacoes_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_boletos (
  id SERIAL PRIMARY KEY,
  cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE,
  linha_digitavel TEXT NOT NULL,
  codigo_barras TEXT NOT NULL,
  nosso_numero TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  vencimento DATE NOT NULL,
  status TEXT DEFAULT 'emitido',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_pagamentos (
  id SERIAL PRIMARY KEY,
  cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE SET NULL,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  metodo TEXT NOT NULL DEFAULT 'interno',
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pendente',
  referencia TEXT,
  comprovante_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  pago_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_notificacoes (
  id SERIAL PRIMARY KEY,
  cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  canal TEXT DEFAULT 'interno',
  tipo TEXT DEFAULT 'vencimento',
  mensagem TEXT NOT NULL,
  status TEXT DEFAULT 'pendente',
  agendada_para TIMESTAMPTZ DEFAULT NOW(),
  enviada_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financeiro_negativacao_eventos (
  id SERIAL PRIMARY KEY,
  cobranca_id INTEGER REFERENCES financeiro_cobrancas(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'preparado',
  motivo TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Agenda global dos dashboards
CREATE TABLE IF NOT EXISTS agenda_eventos (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  inicio_em TIMESTAMPTZ NOT NULL,
  fim_em TIMESTAMPTZ,
  foto_url TEXT,
  localizacao TEXT,
  links_sociais JSONB DEFAULT '[]'::jsonb,
  publico BOOLEAN DEFAULT true,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agenda_notificacoes (
  id SERIAL PRIMARY KEY,
  evento_id INTEGER REFERENCES agenda_eventos(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,
  destinatario TEXT,
  mensagem TEXT NOT NULL,
  status TEXT DEFAULT 'pendente',
  provider_configurado BOOLEAN DEFAULT false,
  agendada_para TIMESTAMPTZ DEFAULT NOW(),
  enviada_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Pós-venda, CDC e resolução de problemas de compra
CREATE TABLE IF NOT EXISTS vendas_politicas_cdc (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  titulo TEXT NOT NULL,
  base_legal TEXT NOT NULL,
  descricao TEXT NOT NULL,
  prazo_dias INTEGER,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendas_resolucoes (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  status TEXT DEFAULT 'aberta',
  prioridade TEXT DEFAULT 'normal',
  base_legal TEXT,
  prazo_resposta_em TIMESTAMPTZ,
  descricao TEXT NOT NULL,
  solucao_solicitada TEXT,
  solucao_aplicada TEXT,
  evidencias JSONB DEFAULT '[]'::jsonb,
  lojista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por INTEGER,
  atualizado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendas_resolucao_movimentos (
  id SERIAL PRIMARY KEY,
  resolucao_id INTEGER REFERENCES vendas_resolucoes(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  mensagem TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Autorização lojista, rastreabilidade de vendas, estoque, notificações e chat loja
CREATE TABLE IF NOT EXISTS lojista_autorizacoes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  email TEXT,
  nome TEXT,
  origem TEXT DEFAULT 'externo',
  status TEXT DEFAULT 'pendente',
  motivo TEXT,
  autorizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  decidido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS vendas_rastreio_eventos (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  lojista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  cliente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  valor NUMERIC(12,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  lojista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0,
  estoque_antes INTEGER,
  estoque_depois INTEGER,
  motivo TEXT,
  criado_por INTEGER,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lojista_notificacoes_venda (
  id SERIAL PRIMARY KEY,
  lojista_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  canal TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  status TEXT DEFAULT 'pendente',
  provider_configurado BOOLEAN DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  enviada_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS loja_chats (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  lojista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'aberto',
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loja_chat_mensagens (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES loja_chats(id) ON DELETE CASCADE,
  autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  mensagem TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Importações acadêmicas, assistente de aulas, aprovações e cadernos privados supervisionados
CREATE TABLE IF NOT EXISTS importacoes_academicas (
  id SERIAL PRIMARY KEY,
  origem TEXT NOT NULL,
  titulo TEXT,
  conteudo_texto TEXT,
  itens JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pendente_aprovacao',
  importado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistente_aulas (
  id SERIAL PRIMARY KEY,
  tema TEXT NOT NULL,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  nivel_codigo TEXT,
  objetivo TEXT,
  plano_aula JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pendente_aprovacao',
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conteudos_aprovacao (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  referencia_id INTEGER,
  titulo TEXT,
  conteudo JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pendente',
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  comentario TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  decidido_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS aluno_cadernos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  privacidade TEXT DEFAULT 'privado_supervisionado',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aluno_caderno_registros (
  id SERIAL PRIMARY KEY,
  caderno_id INTEGER REFERENCES aluno_cadernos(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT,
  conteudo_texto TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  sinalizacao TEXT DEFAULT 'normal',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisao_alertas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  origem TEXT NOT NULL,
  origem_id INTEGER,
  severidade TEXT DEFAULT 'observacao',
  termos_detectados JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'aberto',
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  visto_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  visto_em TIMESTAMPTZ
);

-- Regras acadêmicas por nível, mentores e cargos especiais
ALTER TABLE materias ADD COLUMN IF NOT EXISTS nivel_minimo TEXT DEFAULT 'neofito';
ALTER TABLE live_salas ADD COLUMN IF NOT EXISTS nivel_minimo TEXT DEFAULT 'neofito';
ALTER TABLE biblioteca_livros ADD COLUMN IF NOT EXISTS nivel_minimo TEXT DEFAULT 'neofito';
ALTER TABLE biblioteca_recursos ADD COLUMN IF NOT EXISTS nivel_minimo TEXT DEFAULT 'neofito';

CREATE TABLE IF NOT EXISTS mentor_atribuicoes (
  id SERIAL PRIMARY KEY,
  mentor_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  nivel_codigo TEXT DEFAULT 'neofito',
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cargos_especiais (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  cargo TEXT NOT NULL,
  descricao TEXT,
  status TEXT DEFAULT 'ativo',
  atribuido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  encerrado_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conteudo_acessos (
  id SERIAL PRIMARY KEY,
  recurso_tipo TEXT NOT NULL,
  recurso_id INTEGER NOT NULL,
  nivel_minimo TEXT DEFAULT 'neofito',
  cargos_permitidos JSONB DEFAULT '[]'::jsonb,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recurso_tipo, recurso_id)
);
