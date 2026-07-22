#!/usr/bin/env sh
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="ordo-caoti-export-${STAMP}.tar.gz"
tar --exclude='.git' --exclude='node_modules' --exclude='.vercel' --exclude='*.env' --exclude='*.dump' -czf "$OUT" server.mjs frontend scripts docs package.json package-lock.json render.yaml Dockerfile README.md site-memory.json
echo "Exportação criada: $OUT"
echo "Dados do banco não são incluídos. Gere um dump separado e protegido."
