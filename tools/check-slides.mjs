// Verifica las láminas publicadas por GPT: node tools/check-slides.mjs
// Cada entrada de data/slides.json debe apuntar a un archivo existente en slides/, de una clase existente, con datos mínimos.
import {readFileSync, existsSync, statSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root)));
const {slides = []} = read('data/slides.json'), sessions = new Set(read('data/calendar.json').sessions.map(s => s.id));
const problems = [], seen = new Set();
for (const e of slides) {
  const tag = `clase ${e.session} v${e.version}`;
  if (!sessions.has(Number(e.session))) problems.push(`${tag}: la clase no existe en data/calendar.json`);
  if (!/^slides\/[\w.-]+\.(pdf|html|png|jpg|md)$/i.test(e.file || '')) problems.push(`${tag}: «file» debe ser slides/<nombre>.pdf|html|png|jpg|md`);
  else if (!existsSync(new URL(e.file, root))) problems.push(`${tag}: no existe ${e.file}`);
  else if (statSync(new URL(e.file, root)).size > 15e6) problems.push(`${tag}: ${e.file} supera 15 MB`);
  if (!Number.isInteger(e.version) || e.version < 1) problems.push(`${tag}: «version» debe ser un entero desde 1`);
  if (!e.createdAt || Number.isNaN(Date.parse(e.createdAt))) problems.push(`${tag}: «createdAt» debe ser fecha y hora ISO (p. ej. 2026-11-27T17:55:00-05:00)`);
  if (!['provisional', 'final'].includes(e.status)) problems.push(`${tag}: «status» debe ser provisional o final`);
  const k = e.session + '|' + e.version; if (seen.has(k)) problems.push(`${tag}: versión repetida`); seen.add(k);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Láminas al día: ${slides.length} publicadas.`);
