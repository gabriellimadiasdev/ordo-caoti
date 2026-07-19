# Ordo Caoti - Execucao Local (MVP)

Este repositório contém frontend estático e backend Node.js/Express com PostgreSQL.

## 1) Pré-requisitos

- Node.js LTS (20+ recomendado)
- PostgreSQL acessível pelo `DATABASE_URL`

## 2) Configuração de ambiente

Arquivo local já preparado:
- `backend/json/.env.local`

Para rodar em desenvolvimento:
1. Copie `backend/json/.env.local` para `backend/json/.env`
2. Ajuste os valores de conexão e segredos

## 3) Instalação e execução

```powershell
cd backend/json
npm install
npm run start
```

Ou direto no backend JS:

```powershell
cd backend/js
node server.js
```

## 4) Endpoints adicionados neste pacote

- `GET /api/correios/rastreio/:codigo` (autenticado)
- `GET /loja/pedidos/:id/rastreio` (autenticado)
- `GET /api/ops/resumo` (admin/TI)
- `GET /api/ops/estoque` (admin/TI)
- `GET /api/ops/metas-vendas` (admin/TI)
- `POST /api/ops/metas-vendas` (admin/TI)

## 5) Páginas adicionadas

- `frontend/html/rastreio-correios.html` (consulta de código de rastreio)
- `frontend/html/painel-operacional.html` (hub mínimo por papéis)

Rotas de navegação:
- `/logistica/rastreio`
- `/painel-operacional`

## 6) Testes

Scripts disponíveis em `backend/json/package.json`:

```powershell
cd backend/json
npm test
npm run test:bootstrap
```

`test:bootstrap` envia payload para `POST /api/bootstrap/fundadores`.

## 7) Seeds

Arquivo:
- `backend/sql/seeds.sql`

Ele contém inserts idempotentes para usuários de teste locais.

## Observação importante

Neste ambiente de execução do agente, `node`/`npm` não estavam instalados, então as rotas e scripts não puderam ser executados aqui. Assim que Node estiver disponível na máquina, rode os comandos acima para validar ponta a ponta.

## 8) Deploy frontend em AWS CloudFront

Arquivos de infraestrutura e deploy:

- `infra/aws/cloudfront-s3-static-site.yaml`
- `infra/aws/cloudfront-function-url-rewrite.js`
- `scripts/aws/deploy-cloudfront.ps1`
- `docs/aws-cloudfront.md`

Resumo rápido:

```powershell
aws cloudformation deploy --stack-name ordo-caoti-frontend-prod --template-file infra/aws/cloudfront-s3-static-site.yaml --parameter-overrides ProjectName=ordo-caoti EnvironmentName=prod BucketName=ordocaoti-frontend-prod
```

```powershell
pwsh ./scripts/aws/deploy-cloudfront.ps1 -BucketName ordocaoti-frontend-prod -DistributionId E123ABC456DEF -FrontendDir frontend -DeleteRemoved
```

## 9) Segredos e producao

Nao versione chaves, senhas ou arquivos OAuth. Configure todos os valores do `.env.example` no gerenciador de segredos do ambiente de deploy. O bootstrap de contas privilegiadas deve ser usado apenas uma vez e mantido como `false` em producao.

Arquivos enviados usam AWS S3 privado quando `AWS_S3_BUCKET` e `AWS_REGION` estao configurados. O backend usa IAM Role quando disponivel e so emite URLs temporarias de 5 minutos para upload ou download.

Para videoconferencias, configure `DAILY_API_KEY` e `DAILY_DOMAIN`; a tela fica em `/live/reunioes`. Tokens de acesso sao emitidos no backend e expiram em duas horas.
# nome-do-seu-repositorio
