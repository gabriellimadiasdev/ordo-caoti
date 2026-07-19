# Servidor local Ordo Caoti

Alternativa local para testar o mesmo servidor usado na Vercel.

```bash
npm install
npm run local
```

O servidor usa as mesmas variáveis da Vercel:

- `DATABASE_URL` ou `DATABASE1_URL` ou `POSTGRES_URL`
- `JWT_SECRET` opcional; se ausente usa segredo de desenvolvimento

Para baixar variáveis do projeto Vercel para `.env.local`:

```bash
npm run env:pull
```

Depois exporte/carregue as variáveis no terminal e rode `npm run local`.
