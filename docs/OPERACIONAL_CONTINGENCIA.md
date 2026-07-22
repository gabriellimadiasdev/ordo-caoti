# Continuidade e exportação

## Rotas

- Cada página em `frontend/html` recebe caminho direto pelo nome do arquivo.
- Rotas protegidas exigem sessão e preservam o destino no login.
- Caminhos não reconhecidos abrem a página offline, nunca a landing page.
- Execute `npm run test:routes` antes de publicar para verificar páginas e caminhos declarados.

## Indisponibilidade temporária

- O navegador guarda páginas visitadas e a estrutura principal para uso temporário offline.
- Envios sem conexão entram em fila local e são reenviados quando a conexão volta.
- Autenticação, pagamentos e confirmações que dependem do banco não podem ser concluídos sem o banco; a fila evita perder o preenchimento.

## Exportar para outro local

1. Execute `sh scripts/export-operational.sh`.
2. Restaure `frontend/sql/2026-07-operational-backend-supabase.sql` em um Postgres compatível.
3. Configure `DATABASE_URL`, `JWT_SECRET` e as integrações necessárias.
4. Rode com Docker (`docker build -t ordo-caoti .` e `docker run -p 3000:3000 --env-file .env ordo-caoti`) ou em outro provedor Node.js.
5. Gere um dump Postgres separado para dados reais e mantenha-o protegido.

Não inclua senhas, chaves, dumps ou dados pessoais no pacote de exportação.
