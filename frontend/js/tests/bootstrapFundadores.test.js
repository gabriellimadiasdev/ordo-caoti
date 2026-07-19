const http = require('http');

function postJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: process.env.PORT || 3000,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 10000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (error) {
            return reject(new Error(`Resposta invalida: ${raw}`));
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Timeout na chamada HTTP')));
    req.on('error', (error) => reject(error));
    req.write(body);
    req.end();
  });
}

async function run() {
  const payload = {
    senha_acesso: process.env.BOOTSTRAP_TEST_PASSCODE || 'CHANGE_ME_GATE_PASSCODE',
    caio_email: process.env.BOOTSTRAP_TEST_CAIO_EMAIL || 'caio@example.com',
    caio_password: process.env.BOOTSTRAP_TEST_CAIO_PASSWORD || 'Teste@12345',
    dayenne_email: process.env.BOOTSTRAP_TEST_DAYENNE_EMAIL || 'dayenne@example.com',
    dayenne_password: process.env.BOOTSTRAP_TEST_DAYENNE_PASSWORD || 'Teste@12345',
    ti_email: process.env.BOOTSTRAP_TEST_TI_EMAIL || 'ti@example.com',
    ti_password: process.env.BOOTSTRAP_TEST_TI_PASSWORD || 'Teste@12345'
  };

  const result = await postJson('/api/bootstrap/fundadores', payload);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Falha no bootstrap (${result.status}): ${JSON.stringify(result.json)}`);
  }

  console.log('[bootstrapFundadores.test] OK');
  console.log(JSON.stringify(result.json, null, 2));
}

run().catch((error) => {
  console.error('[bootstrapFundadores.test] ERRO');
  console.error(error.message || error);
  process.exit(1);
});
