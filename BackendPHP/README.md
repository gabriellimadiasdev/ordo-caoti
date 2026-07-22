# BackendPHP

Backend PHP inicial com MySQL, pronto para administrar o banco pelo phpMyAdmin. O diretório foi separado do backend Node/PostgreSQL existente: os bancos não são compatíveis diretamente.

## Instalação

1. Crie um banco `ordocaoti` no phpMyAdmin (ou importe primeiro `database/create-database.sql` se seu usuário tiver permissão). Selecione esse banco e importe `database/schema.sql` em **phpMyAdmin > Importar**.
2. Copie `config.example.php` para `config.php` e informe as credenciais MySQL. `config.php` é ignorado pelo Git.
3. Configure o document root do servidor PHP para `BackendPHP/public`.
4. Verifique `GET /api/health`.

## Rotas incluídas

- `GET /api/health`
- `POST /api/auth/register` — corpo: `nome`, `email`, `senha` (mínimo 12 caracteres)
- `POST /api/auth/login` — corpo: `email`, `senha`
- `GET /api/auth/me` — `Authorization: Bearer <token>`
- `POST /api/auth/logout` — `Authorization: Bearer <token>`

Os tokens são aleatórios, armazenados apenas como hash SHA-256 e expiram em 12 horas.

## Versionamento com GitHub

Versione `database/schema.sql` e migrations sem dados reais. Para atualizar o esquema, crie uma migration SQL revisável e importe-a pelo phpMyAdmin. Não envie ao GitHub exports com usuários, senhas, tokens, pagamentos ou dados pessoais.

Para um backup operacional: use **phpMyAdmin > Exportar > SQL** e armazene o arquivo em local privado/criptografado. Antes de qualquer commit, remova ou anonimize dados pessoais e credenciais; arquivos `*.sql.gz` e `exports/` já são ignorados.

## Limite de deploy

Vercel não executa este backend PHP como Vercel Function. Hospede `BackendPHP/public` em um servidor PHP com MySQL e aponte o frontend para a URL pública da API. O backend Node atual continua sendo o backend com maior cobertura de rotas do projeto.
