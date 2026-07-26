const fs = require('fs');
const path = require('path');
const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const routes = [...server.matchAll(/app\.(?:get|post|put|delete|patch)\(['"`]([^'"`]+)/g)].map((match) => match[1]);
const routeMatchers = routes.map((route) => new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+')}$`));
const missing = new Set();
for (const file of fs.readdirSync(path.join(root, 'frontend', 'html')).filter((name) => name.endsWith('.html'))) {
  const source = fs.readFileSync(path.join(root, 'frontend', 'html', file), 'utf8');
  for (const match of source.matchAll(/(?:apiFetch|fetch)\(\s*[`'"]([^`'"?${]+)/g)) {
    const endpoint = match[1];
    if (!endpoint.startsWith('/') || /^\/(css|js|img|i18n)\//.test(endpoint) || endpoint.includes('${')) continue;
    if (endpoint.endsWith('/')) continue; // prefix of a template-literal route with an ID
    const normalized = endpoint.replace(/\/$/, '');
    if (!routeMatchers.some((matcher) => matcher.test(normalized))) missing.add(`${file}: ${endpoint}`);
  }
}
if (missing.size) { console.error([...missing].join('\n')); process.exit(1); }
console.log(`Contrato de APIs aprovado: ${routes.length} rotas backend verificadas.`);
