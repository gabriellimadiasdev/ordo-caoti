# Ordo Caoti Backend

Backend Node.js/Express pronto para deploy na Vercel.

## Rotas

- `GET /health` — verifica se a API está online.
- `GET /usuarios` — lista usuários.
- `POST /usuarios` — cria usuário com `name`, `email` e `role` opcional (`admin` ou `usuario`).
- `GET /usuarios/:id` — busca usuário.
- `PATCH /usuarios/:id` — atualiza usuário.
- `DELETE /usuarios/:id` — remove usuário.
- `GET /funcoes` — lista funções/rotas disponíveis.

## Observação importante

Os usuários estão em memória enquanto nenhuma variável de banco de dados for configurada. Para produção com dados permanentes, configure um banco via Marketplace da Vercel, como Neon para relacional ou Upstash Redis para chave-valor, e adicione a variável de ambiente correspondente no projeto.
