import assert from 'node:assert/strict';
import app from '../server.mjs';

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

const publicPaths = ['/', '/login', '/login-ti', '/login/ti', '/solicitar-acesso', '/regras', '/api/status', '/produtos', '/js/runtime-api.js'];
for (const path of publicPaths) {
  const { response } = await request(path);
  assert.ok(response.status < 500, `${path} returned ${response.status}`);
}

const signup = await request('/api/solicitacoes-acesso', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nome: 'Teste Smoke', email: `smoke-${Date.now()}@example.com`, senha: '123456', tipo_solicitado: 'cliente' }),
});
assert.ok([201, 503].includes(signup.response.status), `signup returned ${signup.response.status}`);


if (signup.response.status === 201) {
  const email = signup.body?.solicitacao?.email;
  assert.ok(email, 'signup returned email');
}

const noAuthProfiles = await request('/me/perfis');
assert.ok([401, 503].includes(noAuthProfiles.response.status), `profiles returned ${noAuthProfiles.response.status}`);

server.close();
console.log('smoke ok');
