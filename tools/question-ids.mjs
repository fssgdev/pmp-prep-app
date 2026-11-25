// Registro de huellas de las preguntas publicadas (issue #7: integridad histórica).
// Un ID publicado nunca cambia de contenido. Si una pregunta necesita otro enunciado, opciones o respuesta:
//   1) la versión vigente recibe un ID nuevo (p. ej. «-v2») con "replaces": "<ID original>";
//   2) la original pasa a data/questions-retired.json con "retired": true, "replacedBy" y "retiredAt" (fecha del cambio).
// Uso: node tools/question-ids.mjs          → agrega al registro los IDs nuevos (no toca los existentes)
//      node tools/question-ids.mjs --check  → falla si un ID registrado cambió, desapareció o falta registrar uno nuevo
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'tests/fixtures/question-ids.json');
const read = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const active = read('data/questions.json'), retired = read('data/questions-retired.json').questions || [];
// Solo lo que se ve al responder: enunciado, opciones, respuesta y material de apoyo.
const FIELDS = ['type', 'prompt', 'options', 'correct', 'items', 'choices', 'hotspot', 'chart', 'table', 'scenarioId'];
const hash = q => createHash('sha1').update(JSON.stringify(FIELDS.map(f => q[f] ?? null))).digest('hex').slice(0, 16);

const problems = [], all = new Map();
for (const q of [...active, ...retired]) { if (all.has(q.id)) problems.push(`ID repetido: ${q.id}`); all.set(q.id, q); }
const activeIds = new Set(active.map(q => q.id));
for (const q of retired) {
  if (!q.retired || !q.replacedBy || !q.retiredAt || Number.isNaN(Date.parse(q.retiredAt))) problems.push(`${q.id}: una retirada necesita retired, replacedBy y retiredAt`);
  if (!activeIds.has(q.replacedBy)) problems.push(`${q.id}: replacedBy apunta a ${q.replacedBy}, que no está en el banco vigente`);
}
for (const q of active) if (q.replaces && !retired.some(r => r.id === q.replaces && r.replacedBy === q.id)) problems.push(`${q.id}: replaces ${q.replaces}, pero esa versión no está retirada con replacedBy = ${q.id}`);

let reg = {ids: {}};
try { reg = JSON.parse(readFileSync(file, 'utf8')); } catch { /* primer registro */ }
for (const [id, h] of Object.entries(reg.ids)) {
  const q = all.get(id);
  if (!q) problems.push(`${id}: estaba publicado y ya no existe (retíralo en data/questions-retired.json en lugar de borrarlo)`);
  else if (hash(q) !== h) problems.push(`${id}: cambió de contenido. Dale un ID nuevo a la versión vigente y retira la original (ver el encabezado de este archivo)`);
}
const fresh = [...all.keys()].filter(id => !reg.ids[id]);

if (process.argv.includes('--check')) {
  if (fresh.length) problems.push(`${fresh.length} ID nuevos sin registrar (${fresh.slice(0, 5).join(', ')}${fresh.length > 5 ? '…' : ''}): ejecuta node tools/question-ids.mjs`);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`Registro de IDs al día: ${all.size} preguntas (${retired.length} retiradas).`);
} else {
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  for (const id of fresh) reg.ids[id] = hash(all.get(id));
  reg.note = 'Huella del contenido visible de cada pregunta publicada. No editar a mano: node tools/question-ids.mjs';
  reg.ids = Object.fromEntries(Object.entries(reg.ids).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify({note: reg.note, ids: reg.ids}, null, 1) + '\n');
  console.log(`${fresh.length} ID nuevos registrados · ${Object.keys(reg.ids).length} en total.`);
}
