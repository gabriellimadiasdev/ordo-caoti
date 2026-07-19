# Ordo Caoti Backend

Backend Node.js/Express pronto para deploy na Vercel, usando Neon Postgres via `DATABASE_URL`.

## Rotas

- `GET /health` — verifica se a API está online e se o banco foi configurado.
- `GET /usuarios` — lista usuários.
- `POST /usuarios` — cria usuário com `name`, `email` e `role` opcional.
- `GET /usuarios/:id` — busca usuário.
- `PATCH /usuarios/:id` — atualiza usuário.
- `DELETE /usuarios/:id` — remove usuário.
- `GET /roles` ou `GET /funcoes` — lista papéis, permissões e funções.
- `GET /hierarquia` — lista a hierarquia de usuários.
- `GET /usuarios-principais` — cria/retorna os usuários principais.

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

## Banco de dados

O projeto espera a variável `DATABASE_URL` criada pela integração Neon no Vercel Marketplace.

A tabela `users` é criada automaticamente na primeira chamada às rotas de usuários.
