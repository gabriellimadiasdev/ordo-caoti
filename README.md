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

## Loja, serviços, produtos e pagamentos

Rotas de catálogo e pedidos:

- `GET /commerce/integrations` — lista Mercado Pago, Mercado Livre, loja genérica e venda presencial/POS.
- `GET /catalog/items` — lista produtos e serviços.
- `POST /catalog/items` — cria produto ou serviço com `type`, `name`, `price`, `currency`, estoque e metadados.
- `POST /orders` — cria pedido para venda digital, presencial ou canal externo.
- `GET /orders/:id` — consulta pedido, itens e pagamentos.
- `POST /orders/:id/payments/:provider` — cria pagamento/checkout por provedor.
- `POST /webhooks/mercado-pago` — recebe eventos do Mercado Pago.
- `POST /webhooks/mercado-livre` — recebe eventos do Mercado Livre.

Provedores preparados:

- `mercado_pago` — cria preferência de checkout quando `MERCADO_PAGO_ACCESS_TOKEN` estiver configurado.
- `mercado_livre` — estrutura de canal/webhook pronta para sincronização de anúncios e pedidos.
- `generic_store` — integração genérica por API.
- `pos` — estrutura para venda presencial/POS.

Variáveis recomendadas para loja:

- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_PUBLIC_KEY`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_WEBHOOK_URL`
- `MERCADO_LIVRE_CLIENT_ID`
- `MERCADO_LIVRE_CLIENT_SECRET`
- `MERCADO_LIVRE_ACCESS_TOKEN`
- `MERCADO_LIVRE_REFRESH_TOKEN`
- `STORE_API_URL`
- `STORE_API_KEY`
- `POS_API_URL`
- `POS_API_KEY`
- `CHECKOUT_SUCCESS_URL`
- `CHECKOUT_PENDING_URL`
- `CHECKOUT_FAILURE_URL`

## Reuniões, aulas e sala digital

Rotas de sala/aula:

- `GET /classroom/providers` — lista provedores e capacidades.
- `GET /meetings` — lista reuniões/aulas.
- `POST /meetings` — cria aula/reunião com chat, áudio, vídeo, lousa, apresentação de tela, gravação, reações, planos de fundo/filtros e atividades ao vivo habilitadas nas configurações.
- `GET /meetings/:id` — consulta reunião, salas e atividades.
- `POST /meetings/:id/breakout-rooms` — cria várias salas paralelas.
- `GET /meetings/:id/messages` — lista chat.
- `POST /meetings/:id/messages` — envia mensagem de chat.
- `POST /meetings/:id/whiteboard/events` — registra eventos de lousa digital.
- `POST /meetings/:id/reactions` — registra reações.
- `POST /meetings/:id/recordings` — solicita gravação.
- `POST /meetings/:id/activities` — cria prova, quiz, enquete, pergunta ao vivo ou atividade.
- `POST /activities/:id/responses` — envia respostas de prova/teste/pergunta.

Capacidades modeladas:

- chat;
- lousa;
- áudio/vídeo;
- compartilhamento de tela;
- salas paralelas;
- gravações;
- planos de fundo e filtros de aparência;
- reações;
- provas ao vivo;
- testes/quizzes;
- perguntas, enquetes e atividades digitais.

Provedores preparados:

- `daily` — cria sala real quando `DAILY_API_KEY` estiver configurada.
- `livekit` — estrutura pronta para LiveKit.
- `generic_video` — integração genérica por API.

Variáveis recomendadas para sala digital:

- `DAILY_API_KEY`
- `LIVEKIT_API_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `VIDEO_PROVIDER_API_URL`
- `VIDEO_PROVIDER_API_KEY`

As tabelas de catálogo, pedidos, pagamentos, reuniões, salas, chat, lousa, gravações, reações, provas e respostas são criadas automaticamente quando `DATABASE_URL` estiver configurada.

## Área de T.I. e saúde do projeto

Páginas HTML:

- `GET /ti/login` — login da área de T.I.
- `GET /ti` — painel protegido para verificar saúde do backend, site, banco e integrações.
- `GET /ti/health.json` — relatório JSON protegido.
- `POST /ti/logout` — encerra sessão.

Usuário padrão de T.I.:

- `g.lima.rocha90@gmail.com`

Variáveis obrigatórias/recomendadas para a área de T.I.:

- `IT_ADMIN_EMAIL` — e-mail autorizado. Se ausente, usa o e-mail padrão acima.
- `IT_ADMIN_PASSWORD_HASH` — hash SHA-256 da senha de T.I. Recomendado para produção.
- `IT_ADMIN_PASSWORD` — alternativa simples para desenvolvimento; prefira o hash em produção.
- `IT_SESSION_SECRET` — segredo para assinar o cookie de sessão.
- `SITE_HEALTH_URL` — URL pública que o painel deve testar; se ausente usa `AUTH_BASE_URL` ou `/health`.

A senha não deve ser salva no repositório. Configure-a como variável de ambiente segura na Vercel.
