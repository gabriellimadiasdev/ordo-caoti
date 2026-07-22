# Backend, Supabase e recuperação

## O que está versionado

- `server.mjs`: cria/atualiza as tabelas automaticamente no boot quando `DATABASE_URL`, `DATABASE1_URL` ou `POSTGRES_URL` está configurado.
- `frontend/sql/2026-07-operational-backend-supabase.sql`: schema Postgres/Supabase idempotente para recriar o backend operacional.
- `docs/backend-route-map.json`: mapa gerado de páginas, JS, rotas backend e variáveis de ambiente usadas.

## Variáveis necessárias

Configure na Vercel, nunca no Git:

- `DATABASE_URL` ou `POSTGRES_URL`: conexão Postgres/Supabase.
- `JWT_SECRET`: assinatura de sessão.
- `SUPABASE_ENCRYPTION_KEY`: chave usada para criptografar dados pessoais no backend.
- Opcionais: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DAILY_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `ZOOM_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `AWS_S3_BUCKET`.

## Recuperação em caso de falha

1. Crie/restaure o banco Supabase/Postgres.
2. Rode `frontend/sql/2026-07-operational-backend-supabase.sql` no SQL Editor do Supabase.
3. Configure as variáveis acima no projeto Vercel.
4. Faça novo deploy.
5. Acesse `/api/status` para validar banco e backend.

## Backups

Use `frontend/js/scripts/backup-postgres.js` com `DATABASE_URL` configurado para gerar dump local. Não commite dumps, pois podem conter dados pessoais.

## Fallbacks sem API externa

- Aulas/reuniões: geram link interno `/live/sala/:id` quando Daily/Google/Zoom/Teams não estão configurados.
- Arquivos: salvam em Postgres como fallback; quando Supabase/S3 estiver configurado, o provider fica marcado para migração de storage.
- Google Classroom/Drive: endpoints retornam estado de configuração e fallback manual por upload.
- Pagamentos/loja: o backend registra pedidos e mantém metadados; integração real de pagamento deve usar credenciais externas e revisão jurídica/contábil para conformidade fiscal brasileira.
