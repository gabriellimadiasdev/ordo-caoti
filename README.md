# Ordo Caoti Backend

Backend Node.js/Express pronto para deploy na Vercel, usando Neon Postgres via `DATABASE_URL`.

## Rotas

- `GET /health` — verifica se a API está online e se o banco foi configurado.
- `GET /usuarios` — lista usuários.
- `POST /usuarios` — cria usuário com `name`, `email` e `role` opcional (`admin` ou `usuario`).
- `GET /usuarios/:id` — busca usuário.
- `PATCH /usuarios/:id` — atualiza usuário.
- `DELETE /usuarios/:id` — remove usuário.
- `GET /funcoes` — lista funções/rotas disponíveis.

## Banco de dados

O projeto espera a variável `DATABASE_URL` criada pela integração Neon no Vercel Marketplace.

A tabela `users` é criada automaticamente na primeira chamada às rotas de usuários.
