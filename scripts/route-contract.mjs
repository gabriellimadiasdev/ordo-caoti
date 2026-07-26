import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlDir = path.join(root, 'frontend', 'html');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const pageFiles = new Set(fs.readdirSync(htmlDir).filter((file) => file.endsWith('.html')));
const declaredRoutes = new Set([...server.matchAll(/\[['"`]([^'"`]+)['"`],\s*['"`]([^'"`]+\.html)['"`]\]/g)].map((match) => match[1]));
for (const file of pageFiles) declaredRoutes.add(`/${file.slice(0, -5)}`);
const problems = [];
for (const file of pageFiles) {
  const source = fs.readFileSync(path.join(htmlDir, file), 'utf8');
  for (const match of source.matchAll(/data-app-route=["']([^"']+)["']/g)) if (!declaredRoutes.has(match[1])) problems.push(`${file}: rota não declarada ${match[1]}`);
  for (const match of source.matchAll(/data-app-file=["']([^"']+\.html)["']/g)) if (!pageFiles.has(match[1])) problems.push(`${file}: página ausente ${match[1]}`);
  for (const match of source.matchAll(/href=["'](\/[^"'#?]+)["']/g)) {
    const route = match[1].replace(/\/$/, '') || '/';
    if (/^\/(css|js|img|i18n|api)\//.test(route) || route === '/manifest.webmanifest' || route.includes('${')) continue;
    if (route !== '/' && !declaredRoutes.has(route)) problems.push(`${file}: link direto não declarado ${route}`);
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Rotas verificadas: ${declaredRoutes.size}; páginas verificadas: ${pageFiles.size}.`);
