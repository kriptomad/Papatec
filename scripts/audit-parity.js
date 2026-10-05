const fs = require('fs');
const path = require('path');

const root = 'C:/Users/User/Documents/Filitech Projects/PapaTec ERP';
const apiTs = fs.readFileSync(path.join(root, 'frontend/src/services/api.ts'), 'utf8');

// ---- rotas do frontend -------------------------------------------------
const calls = [];
const strRe = /(['"`])(\/[^'"`\n]+)\1/g;
let m;
while ((m = strRe.exec(apiTs))) {
  const before = apiTs.slice(Math.max(0, m.index - 220), m.index);
  const mm = [...before.matchAll(/\b(get|post|put|del)\b/g)].pop();
  if (!mm) continue;
  const method = mm[1] === 'del' ? 'DELETE' : mm[1].toUpperCase();
  const p = m[2].replace(/\$\{[^}]+\}/g, ':id').replace(/^\/+/, '');
  calls.push(`${method} ${p}`);
}
const front = [...new Set(calls)].sort();

// ---- rotas do backend -------------------------------------------------
const routesDir = path.join(root, 'backend/src/routes');
const appTs = fs.readFileSync(path.join(root, 'backend/src/app.ts'), 'utf8');
const mounts = {};
for (const line of appTs.split('\n')) {
  const mm = line.match(/app\.use\('([^']+)',\s*(\w+Router)\)/);
  if (mm && !(mm[2] in mounts)) mounts[mm[2]] = mm[1].replace(/^\/api/, '');
}

const back = [];
for (const file of fs.readdirSync(routesDir)) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
  const routerName = (src.match(/export const (\w+) = Router\(\)/) || [])[1];
  const prefix = mounts[routerName] ?? (routerName ? `?${routerName}` : '?');
  const rre = /\b(\w+Router)\.(get|post|put|delete)\(\s*\n?\s*'([^']+)'/g;
  let mm;
  while ((mm = rre.exec(src))) {
    const p = mm[3].replace(/^\/+/, '').replace(/:(\w+)/g, ':$1');
    back.push(`${mm[2].toUpperCase()} ${prefix}/${p}`.replace(/\/+$/, '/'));
  }
}
const backSet = [...new Set(back)].sort();

// ---- normaliza --------------------------------------------------------
const norm = (s) => {
  const idx = s.indexOf(' ');
  if (idx < 0) return s;
  const method = s.slice(0, idx).toUpperCase();
  const p = s.slice(idx + 1).trim().replace(/^\/+/, '').replace(/\/:[^/]+/g, '/#').replace(/\/+$/, '');
  return `${method} ${p}`;
};
const frontNorm = new Set(front.map(norm));
const backNorm = new Set(backSet.map(norm));

const missing = front.filter((f) => !backNorm.has(norm(f)));
console.log('FRONT NORM SAMPLE:', [...frontNorm].slice(0, 10).join(' | '));
console.log('BACK  NORM SAMPLE:', [...backNorm].slice(0, 10).join(' | '));
console.log(`=== FRONTEND (${front.length}) ===`);
front.forEach((f) => console.log('  ' + f));
console.log(`\n=== BACKEND (${backSet.length}) ===`);
backSet.forEach((f) => console.log('  ' + f));
console.log(`\n=== SEM CORRESPONDÊNCIA NO BACKEND (${missing.length}) ===`);
missing.forEach((f) => console.log('  ! ' + f));
