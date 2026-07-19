# Ordo Caoti Backend

Backend Node.js/Express pronto para deploy na Vercel, usando Neon Postgres via `DATABASE_URL`.

## Rotas principais

- `GET /health` — verifica se a API está online e se o banco foi configurado.
- `GET /usuarios` — lista usuários.
- `POST /usuarios` — cria usuário com `name`, `email` e `role` opcional.
- `GET /usuarios/:id` — busca usuário.
- `PATCH /usuarios/:id` — atualiza usuário.
- `DELETE /usuarios/:id` — remove usuário.
- `GET /roles` ou `GET /funcoes` — lista papéis, permissões e funções.
- `GET /hierarquia` — lista a hierarquia de usuários.
- `GET /usuarios-principais` — cria/retorna os usuários principais.

## Login social e autenticação

- `GET /auth/providers` — lista provedores e MFA disponíveis.
- `GET /auth/:provider/login` — gera URL de autorização OAuth.
- `GET|POST /auth/:provider/callback` — callback OAuth/OIDC.
- `GET /usuarios/:id/identidades` — lista contas sociais vinculadas.
- `GET /usuarios/:id/emails` — lista e-mails do usuário.
- `POST /usuarios/:id/emails` — adiciona e-mail extra ao mesmo usuário.

Provedores configurados no código: `google`, `apple`, `microsoft`, `github` e `oidc` para outros provedores OpenID Connect.

## MFA

- `GET /usuarios/:id/mfa` — lista fatores MFA.
- `POST /usuarios/:id/mfa/totp/setup` — cria segredo TOTP compatível com Authy e Google Authenticator.
- `POST /usuarios/:id/mfa/totp/verify` — valida o código TOTP e habilita o fator.
- `POST /usuarios/:id/mfa/sms/setup` — registra telefone para SMS.
- `POST /usuarios/:id/mfa/whatsapp/setup` — registra telefone para WhatsApp.
- `POST /usuarios/:id/mfa/:method/challenge` — cria desafio SMS/WhatsApp.
- `POST /usuarios/:id/mfa/:method/verify` — valida desafio SMS/WhatsApp.

SMS e WhatsApp precisam de um provedor externo de envio de mensagens antes de enviar códigos reais.

## Hierarquia de usuários

1. `super_admin` — acesso total.
2. `admin` — cria, lê, atualiza e remove usuários.
3. `gerente` — cria, lê e atualiza usuários.
4. `moderador` — lê e atualiza usuários.
5. `usuario` — acesso básico.

## Usuários principais criados automaticamente

Quando `DATABASE_URL` estiver configurada, a primeira chamada a `/usuarios`, `/users` ou `/usuarios-principais` cria/atualiza estes usuários:

- `admin@ordocaoti.com.br` — `super_admin`
- `administrador@ordocaoti.com.br` — `admin`
- `gerente@ordocaoti.com.br` — `gerente`
- `moderador@ordocaoti.com.br` — `moderador`

## Variáveis de ambiente

Obrigatória:

- `DATABASE_URL` — criada pela integração Neon no Vercel Marketplace.

Recomendadas para OAuth:

- `AUTH_BASE_URL` — URL pública do backend, exemplo: `https://ordocaoti.com.br`.
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
- `APPLE_CLIENT_ID` e `APPLE_CLIENT_SECRET`.
- `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET`.
- `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET`.
- `OIDC_AUTHORIZATION_URL`, `OIDC_TOKEN_URL`, `OIDC_USERINFO_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e opcionalmente `OIDC_SCOPE`.

Callbacks OAuth:

- Google: `/auth/google/callback`
- Apple: `/auth/apple/callback`
- Microsoft: `/auth/microsoft/callback`
- GitHub: `/auth/github/callback`
- OIDC personalizado: `/auth/oidc/callback`

A tabela `users` e as tabelas auxiliares de e-mails, identidades OAuth, estados OAuth, MFA e desafios MFA são criadas automaticamente na primeira chamada às rotas protegidas por banco.
