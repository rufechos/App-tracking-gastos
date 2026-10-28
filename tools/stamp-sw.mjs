// Writes into sw.js a version computed from the files it caches, so that any change reaches installed apps.
// --check: fails when sw.js is out of date or a file of the app is missing from its list (used by CI).
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SW = join(ROOT, 'sw.js');
const check = process.argv.includes('--check');

const list = (src, name) => JSON.parse('[' + src.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'))[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
async function walk(dir) {
  const out = [];
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p))); else out.push(p.split('\\').join('/'));
  }
  return out;
}
async function hash(files) {
  const h = createHash('sha256');
  for (const f of files) { h.update(f + '\0'); h.update(await readFile(join(ROOT, f === './' ? 'index.html' : f))); }
  return h.digest('hex').slice(0, 12);
}

const src = await readFile(SW, 'utf8');
const core = list(src, 'CORE'), libs = list(src, 'LIBS');
const missing = [...(await walk('js')), ...(await walk('css')), ...(await walk('fonts'))].filter((f) => !core.includes(f))
  .concat((await walk('vendor')).filter((f) => f.endsWith('.js') && !libs.includes(f)));
if (missing.length) { console.error('Faltan en la lista de sw.js: ' + missing.join(', ')); process.exit(1); }
const body = src.replace(/const VERSION = '[^']*';/, "const VERSION = '';").replace(/const LIBS_VERSION = '[^']*';/, "const LIBS_VERSION = '';");
const h = createHash('sha256').update(body).update(await hash(core)).update(await hash(libs)).digest('hex').slice(0, 12);
const lv = await hash(libs);
const out = src.replace(/const VERSION = '[^']*';/, `const VERSION = '${h}';`).replace(/const LIBS_VERSION = '[^']*';/, `const LIBS_VERSION = '${lv}';`);
if (check) {
  if (out !== src) { console.error('sw.js no está al día: ejecuta «npm run stamp».'); process.exit(1); }
  console.log('sw.js al día (' + h + ').');
} else {
  await writeFile(SW, out);
  console.log('sw.js: versión ' + h + ', librerías ' + lv + ' (' + relative(ROOT, SW) + ')');
}
