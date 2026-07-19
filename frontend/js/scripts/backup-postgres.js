const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', 'json', '.env') });

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const pgDumpBin = String(process.env.PG_DUMP_BIN || 'pg_dump').trim();
const backupDir = path.join(__dirname, '..', '..', 'backups');

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  if (!databaseUrl) {
    console.error('DATABASE_URL nao configurada. Defina a conexao Postgres antes de gerar backup.');
    process.exit(1);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFile = path.join(backupDir, `ordo-caoti-${buildTimestamp()}.dump`);
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file',
    backupFile,
    databaseUrl
  ];

  const result = spawnSync(pgDumpBin, args, { stdio: 'inherit', shell: false });

  if (result.error) {
    console.error(`Falha ao executar ${pgDumpBin}: ${result.error.message}`);
    console.error('Instale o cliente do PostgreSQL ou aponte PG_DUMP_BIN para o executavel correto.');
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`pg_dump terminou com codigo ${result.status}.`);
    process.exit(result.status || 1);
  }

  console.log(`Backup gerado em ${backupFile}`);
}

main();