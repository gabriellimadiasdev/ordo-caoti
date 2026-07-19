-- ================================================== --
-- ARQUIVO DE SEEDS PARA DADOS INICIAIS DE TESTE      --
-- ================================================== --

-- Senha para todos os usuarios abaixo: teste123
-- Requer pgcrypto para gerar hash bcrypt valido no PostgreSQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario)
VALUES
	('Admin Local', 'admin.local@ordocaoti.test', crypt('teste123', gen_salt('bf', 10)), 'admin'),
	('Professor Local', 'prof.local@ordocaoti.test', crypt('teste123', gen_salt('bf', 10)), 'professor'),
	('Aluno Local', 'aluno.local@ordocaoti.test', crypt('teste123', gen_salt('bf', 10)), 'aluno'),
	('TI Local', 'ti.local@ordocaoti.test', crypt('teste123', gen_salt('bf', 10)), 'ti')
ON CONFLICT (email) DO UPDATE
SET
	nome = EXCLUDED.nome,
	senha_hash = crypt('teste123', gen_salt('bf', 10)),
	tipo_usuario = EXCLUDED.tipo_usuario,
	atualizado_em = NOW();
