'use strict';
/* Avance real de cada clase INGENIUM (issues #3 y #6).
   En cada fecha de clase aparece la tarea «Indicar lección avanzada del PPT de preparación v4.1». Fabrizio registra la(s)
   lección(es) v4.1, secciones, último tema o diapositiva y observaciones. Cada registro vive en state.classLog
   (lista sincronizada por id, gana la edición más reciente) y conserva su historial de cambios.
   Prioridad para decidir la lección de estudio (Bullet Quiz, tarjetas nuevas y cuestionario del sábado):
   1) corrección manual de la semana en Ruta; 2) avance declarado en clase; 3) plan semanal (proyección).
   Las notas del instructor (data/calendar.json, mapping «confirmada») se contrastan: si difieren, se muestra la discrepancia. */

const CLASSLOG_START = '2026-11-20'; // primera clase sin notas del instructor: desde aquí se pide registrar el avance
function ensureClassLog() { if (!Array.isArray(state.classLog)) state.classLog = []; return state.classLog; }
function classLogFor(sessionId) { return ensureClassLog().find(r => r.session === Number(sessionId) && !r.removed) || null; }
const sessionById = id => (D.sessions || []).find(s => Number(s.id) === Number(id));
const lessonTitle = n => D.weeklyPlan?.lessons?.[String(n)]?.title || '';

/* Lecciones declaradas hasta una fecha (inclusive), de la clase más reciente con registro. */
function declaredLessonAsOf(day) {
  const recs = ensureClassLog().filter(r => !r.removed && r.date <= day && r.lessons?.length).sort((a, b) => a.date.localeCompare(b.date));
  const last = recs[recs.length - 1];
  return last ? {n: Math.max(...last.lessons), rec: last} : null;
}
function declaredLessonsUntil(day) { return [...new Set(ensureClassLog().filter(r => !r.removed && r.date <= day).flatMap(r => r.lessons || []))].sort((a, b) => a - b); }
/* Discrepancia con las notas del instructor (solo cuando la sesión está confirmada por notas). */
function classLogDiscrepancy(rec) {
  const s = rec && sessionById(rec.session);
  if (!s || s.mapping !== 'confirmada' || !rec.lessons?.length) return null;
  const a = [...rec.lessons].sort().join(','), b = [...s.lesson41].sort().join(',');
  return a === b ? null : {declared: rec.lessons, notes: s.lesson41};
}

function classLogTasks() {
  return [...(D.sessions || [])].filter(s => s.date >= CLASSLOG_START).map(s => ({
    id: 'log-s' + s.id, kind: 'classlog', session: s.id, date: s.date, due: s.date,
    title: 'Indicar lección avanzada del PPT de preparación v4.1',
    detail: `Clase INGENIUM ${s.id} (${s.time || 'noche'}): marca la lección v4.1 que se avanzó, el último tema o diapositiva y tus observaciones. Con esto se ajustan el Bullet Quiz, las tarjetas y el cuestionario del sábado.`
  }));
}

function classLogDialog(sessionId) {
  const s = sessionById(sessionId); if (!s) return;
  const r = classLogFor(sessionId), proj = s.lesson41 || [], pick = r ? r.lessons : (s.mapping === 'confirmada' ? proj : []);
  const notes = s.mapping === 'confirmada' ? `Las notas del profesor indican la lección ${s.lesson41.join(' y ')}.` : `Aún no hay notas del profesor de esta clase; la proyección era la lección ${proj.join(' y ') || '—'} (sin confirmar).`;
  const lessons = Object.keys(D.weeklyPlan?.lessons || {}).filter(n => n !== '9').map(n => `<label class="checkline"><input type="checkbox" name="cl-lesson" value="${n}" ${pick.includes(Number(n)) ? 'checked' : ''}> Lección ${n} · ${esc(lessonTitle(n))}</label>`).join('');
  dialog(`Avance de la clase ${s.id} · ${date(s.date, {weekday: 'long', day: 'numeric', month: 'long'})}`, `<form id="classlog-form" data-session="${s.id}">
    <p class="hint">${esc(s.ppt)}. ${esc(notes)} Registra lo que realmente se avanzó en clase.</p>
    <fieldset class="cl-lessons"><legend>Lección(es) del PPT de preparación v4.1 avanzadas</legend>${lessons}</fieldset>
    <div class="form-grid">
      ${field('Secciones o temas vistos', 'cl-sections', `<input id="cl-sections" maxlength="300" value="${esc(r?.sections || '')}" placeholder="Ej.: interesados, comunicación">`, true)}
      ${field('Último tema o diapositiva', 'cl-last', `<input id="cl-last" maxlength="200" value="${esc(r?.lastTopic || '')}" placeholder="Ej.: matriz de evaluación del involucramiento (diap. 42)">`, true)}
      ${field('Observaciones (opcional)', 'cl-notes', `<textarea id="cl-notes" maxlength="1500">${esc(r?.notes || '')}</textarea>`, true)}
    </div>
    ${r?.history?.length ? `<p class="hint">Registrado el ${date(stampDay(r.created || r.updated), {day: 'numeric', month: 'short'})}${r.history.length ? ` · ${r.history.length} ${r.history.length === 1 ? 'edición' : 'ediciones'}` : ''}.</p>` : ''}
    <div class="actions">${button(r ? 'Guardar cambios' : 'Guardar avance', 'classlog-save', '')}${button('Cancelar', 'close-dialog', 'white')}</div></form>`);
}
function saveClassLog(sessionId) {
  const s = sessionById(sessionId); if (!s) return;
  const lessons = [...document.querySelectorAll('#classlog-form [name="cl-lesson"]:checked')].map(x => Number(x.value));
  if (!lessons.length) { toast('Marca al menos una lección v4.1.'); return; }
  const val = id => (document.getElementById(id)?.value || '').trim();
  const list = ensureClassLog(), now = stamp(), prev = classLogFor(sessionId);
  const data = {lessons, sections: val('cl-sections'), lastTopic: val('cl-last'), notes: val('cl-notes')};
  if (prev) {
    const changed = ['lessons', 'sections', 'lastTopic', 'notes'].some(k => JSON.stringify(prev[k]) !== JSON.stringify(data[k]));
    if (changed) { prev.history = [...(prev.history || []), {at: prev.updated, lessons: prev.lessons, sections: prev.sections, lastTopic: prev.lastTopic, notes: prev.notes}].slice(-20); Object.assign(prev, data, {updated: now}); }
  } else list.push({id: 'cl-s' + s.id, session: s.id, date: s.date, ...data, source: 'Fabrizio', status: 'declarado', created: now, updated: now, history: []});
  markTask('log-s' + s.id, true);
  if (typeof allCards === 'function') allCards.cache = null;
  closeDialog(); render();
  const disc = classLogDiscrepancy(classLogFor(sessionId));
  toast(disc ? `Guardado. Ojo: las notas del profesor indican la lección ${disc.notes.join(' y ')}; revisa cuál es la correcta.` : `Avance guardado: lección ${lessons.join(' y ')}. Tu rutina usa ahora este avance.`);
}
/* Resumen para la tarjeta de la sesión en Ruta y Agenda. */
function classLogLine(s) {
  if (s.date < CLASSLOG_START && !classLogFor(s.id)) return '';
  const r = classLogFor(s.id), disc = classLogDiscrepancy(r);
  if (!r) return s.date <= today() ? `<div class="task-inline">${badge('Avance sin registrar', 'orange')} <span>¿Qué lección v4.1 se avanzó en esta clase?</span>${button('Registrar avance ' + icon('arrow'), 'classlog-open', 'light small', `data-id="${s.id}"`)}</div>` : '';
  return `<div class="task-inline">${badge('Avance declarado', 'green')} <span><strong>Lección ${r.lessons.join(' y ')}</strong>${r.lastTopic ? ' · hasta: ' + esc(r.lastTopic) : ''}${r.sections ? ' · ' + esc(r.sections) : ''}</span>${button('Editar', 'classlog-open', 'ghost small', `data-id="${s.id}"`)}</div>${disc ? `<p class="hint cl-disc">${badge('Discrepancia', 'red')} Declaraste la lección ${disc.declared.join(' y ')}, pero las notas del profesor indican la ${disc.notes.join(' y ')}. Revisa y corrige tu registro o avisa al supervisor.</p>` : ''}`;
}

/* ---------- archivos locales (láminas en PDF y apuntes de OneNote) ----------
   El contenido se guarda solo en este navegador (IndexedDB «pmp-files»); en el estado sincronizado viaja únicamente la
   ficha (nombre, sesión, fecha, estado). En otro dispositivo se ve la ficha y se avisa que el archivo está en el original. */
const filesMem = new Map();
function filesDb() { return filesDb.p || (filesDb.p = new Promise((ok, fail) => { const r = indexedDB.open('pmp-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); })); }
async function fileOp(mode, fn) { const db = await filesDb(); return new Promise((ok, fail) => { const t = db.transaction('files', mode), st = t.objectStore('files'), req = fn(st); t.oncomplete = () => ok(req?.result); t.onerror = () => fail(t.error); }); }
const filePut = (key, blob) => fileOp('readwrite', st => st.put(blob, key)).then(() => filesMem.set(key, true));
const fileGet = key => fileOp('readonly', st => st.get(key));
const fileDel = key => fileOp('readwrite', st => st.delete(key)).then(() => filesMem.delete(key));
async function filesLoadKeys() { try { const keys = await fileOp('readonly', st => st.getAllKeys()); (keys || []).forEach(k => filesMem.set(k, true)); if (filesMem.size && typeof render === 'function' && /^#(notas|inicio|agenda|ruta)?$/.test(location.hash || '#inicio')) render(); } catch (e) { /* sin IndexedDB */ } }
filesLoadKeys();
async function openLocalFile(key, name) {
  const blob = await fileGet(key).catch(() => null);
  if (!blob) { toast('Este archivo está guardado en el dispositivo donde lo cargaste.'); return; }
  const url = URL.createObjectURL(blob), w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = name || 'archivo'; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const pickFile = accept => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => ok(i.files[0] || null); i.click(); });

/* ---------- láminas de repaso (las redacta GPT; la app las recibe, las muestra y registra la revisión) ---------- */
function ensureSlides() { if (!Array.isArray(state.slides)) state.slides = []; return state.slides; }
const slideFor = sid => ensureSlides().find(x => x.session === Number(sid) && !x.removed) || null;
/* Versiones publicadas por GPT en el repositorio (data/slides.json + slides/) más las cargadas a mano en la app. */
function repoSlideVersions(sid) { return (D.slidesRepo || []).filter(e => Number(e.session) === Number(sid) && /^slides\/[\w.-]+\.(pdf|html|png|jpg|md)$/i.test(e.file || '')).map(e => ({link: new URL(e.file, location.href).href, name: e.title || e.file.split('/').pop(), at: e.createdAt || '', note: [e.status === 'provisional' ? 'provisional' : '', e.note || ''].filter(Boolean).join(' · '), source: e.author || 'GPT', repo: true, version: e.version})); }
function slideVersions(sid) { return [...repoSlideVersions(sid), ...(slideFor(sid)?.versions || [])].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)); }
function slideStatus(sid) { const v = slideVersions(sid), x = slideFor(sid); if (!v.length) return 'pendiente'; const last = v[v.length - 1]; return x?.reviewedAt && Date.parse(x.reviewedAt) >= (Date.parse(last.at) || 0) ? 'revisada' : 'disponible'; }
/* ¿Hay una versión de la lámina posterior a `when` (marca de tarea hecha) que aún no se revisó? */
function slideNewerThan(sid, when) { const v = slideVersions(sid), last = v[v.length - 1]; if (!last || slideStatus(sid) !== 'disponible') return false; const t = typeof when === 'string' ? Date.parse(when) : NaN; return !Number.isFinite(t) || (Date.parse(last.at) || 0) > t; }
const SLIDE_LABEL = {pendiente: 'Pendiente de generación', disponible: 'Disponible', revisada: 'Revisada'};
function slideDialog(sid, taskId) {
  const s = sessionById(sid); if (!s) return;
  const x = slideFor(sid), vs = slideVersions(sid), v = vs[vs.length - 1], st = slideStatus(sid);
  const open = v ? (v.link ? `<a class="button" href="${esc(v.link)}" target="_blank" rel="noopener">Abrir lámina ${icon('arrow')}</a>` : (filesMem.has(v.key) ? button('Abrir lámina ' + icon('arrow'), 'slide-open', '', `data-id="${s.id}"`) : '<span class="hint">El PDF de esta lámina se cargó en otro dispositivo.</span>')) : '';
  dialog(`Lámina de repaso · clase ${s.id} (${date(s.date, {day: 'numeric', month: 'short'})})`, `<p>${badge(SLIDE_LABEL[st], st === 'revisada' ? 'green' : st === 'disponible' ? 'blue' : 'orange')} ${classLogFor(s.id) ? `Avance declarado: lección ${classLogFor(s.id).lessons.join(' y ')}` : 'Sin avance declarado para esta clase'}</p>
    <p class="hint">GPT redacta la lámina a partir de tu avance, las notas del profesor, el PPT v4.1 y tus apuntes, y la publica directamente en la app: aparece aquí sola. Si te la entrega por otro medio, puedes cargar el PDF o pegar su enlace. Las versiones anteriores se conservan.</p>
    ${v ? `<p class="hint">Versión ${vs.length} · ${esc(v.name || v.link || '')}${v.repo ? ' · publicada por GPT en la app' : ''}${v.at ? ' · ' + date(stampDay(v.at), {day: 'numeric', month: 'short'}) : ''}${v.note ? ' · ' + esc(v.note) : ''}</p>` : ''}
    <div class="actions">${open}${v && st !== 'revisada' ? button('Marcar como revisada', 'slide-reviewed', 'lime', `data-id="${s.id}" data-task="${esc(taskId || '')}"`) : ''}</div>
    <div class="form-grid" style="margin-top:12px">${field('Enlace de la lámina (opcional)', 'slide-link', '<input id="slide-link" type="url" placeholder="https://drive.google.com/…" maxlength="500">', true)}${field('Nota de la versión (opcional)', 'slide-note', '<input id="slide-note" maxlength="200" placeholder="Ej.: provisional, falta confirmar notas del profesor">', true)}</div>
    <div class="actions">${button('Cargar PDF de la lámina', 'slide-upload', 'light', `data-id="${s.id}"`)}${button('Guardar enlace', 'slide-save-link', 'light', `data-id="${s.id}"`)}${button('Exportar contexto para GPT', 'context-export', 'ghost', `data-id="${s.id}"`)}${button('Cerrar', 'close-dialog', 'white')}</div>`);
}
function addSlideVersion(sid, version) {
  const list = ensureSlides(), now = stamp(); let x = slideFor(sid);
  if (!x) { x = {id: 'sl-s' + sid, session: Number(sid), versions: [], created: now}; list.push(x); }
  x.versions = [...(x.versions || []), {...version, at: now, source: 'GPT'}].slice(-10); x.reviewedAt = null; x.updated = now;
  save(); slideDialog(sid); render(); toast('Lámina cargada. Queda disponible en la tarea de repaso.');
}

/* ---------- apuntes de OneNote por sesión (Mis notas) ---------- */
function ensureNoteFiles() { if (!Array.isArray(state.noteFiles)) state.noteFiles = []; return state.noteFiles; }
const NOTE_ACCEPT = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.txt,.md,.html,.htm,.mht';
/* Mis notas como visor (decisión de Fabrizio, 25/11): los apuntes se suben a su carpeta privada del Drive
   «PMP App · Contexto y láminas», en la subcarpeta AAAA-MM-DD_clase-N (la crea la revisión diaria de Claude los días de clase).
   La app no lista el Drive (necesitaría iniciar sesión con Google): cada carpeta abre la búsqueda de su subcarpeta en el Drive
   de quien la abre, sin IDs ni enlaces privados en el repositorio. */
const DRIVE_ROOT_NAME = 'PMP App · Contexto y láminas';
const driveFolderName = s => `${s.date}_clase-${s.id}`;
const driveSearch = q => 'https://drive.google.com/drive/search?q=' + encodeURIComponent(q);
function renderNoteFiles() {
  const files = ensureNoteFiles().filter(f => !f.removed);
  const ss = [...D.sessions].filter(s => s.date <= today() && (s.date >= BASELINE_START || files.some(f => f.session === s.id) || classLogFor(s.id))).sort((a, b) => b.date.localeCompare(a.date));
  const fileRow = f => `<article class="item-card note-file"><div class="row"><div><div class="meta">${badge('L' + f.lesson, 'green')} ${badge('Guardado en este dispositivo')}</div><h3>${esc(f.name)}</h3><p class="hint">${esc(f.label)}${filesMem.has(f.key) ? '' : ' · el archivo está en otro dispositivo'}</p></div></div><div class="actions">${filesMem.has(f.key) ? button('Abrir', 'note-file-open', 'light small', `data-id="${f.id}"`) : ''}${button('Quitar', 'note-file-del', 'ghost small', `data-id="${f.id}"`)}</div></article>`;
  const folder = (s, i) => { const fs = files.filter(f => f.session === s.id), r = classLogFor(s.id), st = slideStatus(s.id);
    return `<details class="session-folder" ${i === 0 ? 'open' : ''}><summary><span class="folder-name">📁 ${driveFolderName(s)}</span><span class="folder-meta">${r ? 'Lección ' + r.lessons.join(' y ') + (r.lastTopic ? ' · hasta: ' + esc(r.lastTopic) : '') : 'avance sin registrar'} · lámina ${SLIDE_LABEL[st].toLowerCase()}</span></summary>
      <div class="folder-body">${fs.map(fileRow).join('')}
      <div class="actions"><a class="button light small" href="${driveSearch(driveFolderName(s))}" target="_blank" rel="noopener">Abrir en Drive ${icon('arrow')}</a>${st !== 'pendiente' ? button('Ver lámina', 'slide-folder', 'ghost small', `data-id="${s.id}"`) : ''}${button('Exportar contexto para GPT', 'context-export', 'ghost small', `data-id="${s.id}"`)}</div></div></details>`; };
  return `<section class="card note-files"><div class="card-header"><div><h2>Apuntes por clase</h2><p>Tus apuntes viven en tu Drive; aquí los encuentras por fecha de clase, junto con su lámina y el contexto para GPT.</p></div><a class="button white small" href="${driveSearch(DRIVE_ROOT_NAME)}" target="_blank" rel="noopener">Carpeta del Drive ${icon('arrow')}</a></div>
  <p class="hint">Sube tus apuntes de OneNote (en PDF) y el contexto exportado a la subcarpeta de cada clase en tu carpeta privada «${DRIVE_ROOT_NAME}». Así GPT y Claude pueden leerlos y los ves en todos tus dispositivos. «Abrir en Drive» busca esa subcarpeta en tu Drive (inicia sesión con tu cuenta de Google si te lo pide).</p>
  <div class="stack">${ss.length ? ss.map(folder).join('') : '<p class="hint">Las carpetas aparecen desde la clase del 25 de noviembre.</p>'}</div></section>`;
}
async function addNoteFile(file, existing, sessionId) {
  if (!file) return;
  if (/\.(one|onepkg|onetoc2)$/i.test(file.name)) { toast('Los archivos de OneNote (.one) no se pueden leer en el navegador: exporta la página a PDF y cárgala.'); return; }
  if (file.size > 25e6) { toast('El archivo supera 25 MB.'); return; }
  const now = stamp();
  if (existing) { await filePut(existing.key, file); Object.assign(existing, {name: file.name, size: file.size, type: file.type, read: false, updated: now}); }
  else {
    const sid = Number(sessionId), s = sessionById(sid), lesson = classLogFor(sid)?.lessons?.slice(-1)[0] || declaredLessonAsOf(s?.date || today())?.n || s?.lesson41?.slice(-1)[0] || 1, id = uid(), key = 'note-' + id;
    if (!s) { toast('Elige la carpeta de una clase.'); return; }
    await filePut(key, file);
    ensureNoteFiles().push({id, key, session: sid, date: s?.date || today(), lesson, label: `${s?.date || today()}_L${lesson}`, name: file.name, size: file.size, type: file.type, read: false, local: true, created: now, updated: now});
  }
  save(); render(); toast('Apunte guardado en este dispositivo.');
}

/* Acceso a los apuntes de una clase INGENIUM en el Drive (reemplaza a «Añadir apunte» en la Agenda). */
function sessionNotesLink(s) { const x = sessionById(s.id) || s; return x?.date ? `<a class="button ghost" href="${driveSearch(driveFolderName(x))}" target="_blank" rel="noopener">Apuntes en Drive ↗</a>` : ''; }

/* ---------- paquete de contexto por sesión (para que GPT prepare la lámina) ----------
   La app no puede escribir en tu Drive: genera un archivo de texto que puedes guardar en tu carpeta privada o pegar en GPT. */
function contextPackage(sid) {
  const s = sessionById(sid), r = classLogFor(sid), d = classLogDiscrepancy(r), localFiles = ensureNoteFiles().filter(f => f.session === Number(sid) && !f.removed);
  /* La app no lista el Drive: no puede saber si hay apuntes allí, así que no lo afirma (#3). */
  const gaps = [!r && 'No hay avance declarado por Fabrizio.', s.mapping !== 'confirmada' && 'Aún no hay notas del profesor confirmadas en el Drive para esta clase.'].filter(Boolean);
  return [`# Contexto de la clase ${s.id} · ${s.date}`, '', `- Programa INGENIUM: ${s.title}`, `- PPT de referencia: ${s.ppt}`,
    `- Avance declarado por Fabrizio: ${r ? `lección v4.1 ${r.lessons.join(' y ')}${r.sections ? '; secciones: ' + r.sections : ''}${r.lastTopic ? '; último tema/diapositiva: ' + r.lastTopic : ''}${r.notes ? '; observaciones: ' + r.notes : ''} (registrado ${stampDay(r.updated)})` : 'sin registrar'}`,
    `- Notas del profesor (Google Sheets en la carpeta de la lección del Drive): ${s.mapping === 'confirmada' ? 'confirmadas, lección ' + s.lesson41.join(' y ') : 'por confirmar'}`,
    `- Apuntes de Fabrizio en el Drive: verificar la subcarpeta «${driveFolderName(s)}» de su carpeta privada «${DRIVE_ROOT_NAME}» (la app no puede comprobarlo).`,
    localFiles.length ? `- Archivos locales antiguos (cargados en la app antes del 25/11; solo en el dispositivo de Fabrizio, no en el Drive): ${localFiles.map(f => f.name).join(', ')}` : '',
    d ? `- Discrepancia: Fabrizio declaró la lección ${d.declared.join(' y ')}; las notas del profesor indican la ${d.notes.join(' y ')}. Marcar como provisional.` : '',
    '', '## Brechas', ...(gaps.length ? gaps.map(g => '- ' + g) : ['- Ninguna.']), '',
    `## Pedido`, `Preparar la lámina de repaso de esta clase (original, breve y visual; con conceptos esenciales, palabras clave, ejemplos de construcción, errores frecuentes, reglas de decisión PMP y autoevaluación opcional) para revisarla el día de la siguiente clase a las 18:00. Marcar como provisional lo no confirmado.`].filter(x => x !== '').join('\n');
}

const SESSION_ACTIONS = {
  'slide-open': el => { const vs = slideVersions(el.dataset.id), v = vs[vs.length - 1]; if (v?.key) openLocalFile(v.key, v.name); },
  'slide-upload': async el => { const f = await pickFile('application/pdf,.pdf'); if (!f) return; if (f.size > 30e6) { toast('El PDF supera 30 MB.'); return; } const sid = el.dataset.id, key = `slide-s${sid}-${Date.now()}`; await filePut(key, f); addSlideVersion(sid, {key, name: f.name, size: f.size, local: true, note: (document.getElementById('slide-note')?.value || '').trim()}); },
  'slide-save-link': el => { const link = (document.getElementById('slide-link')?.value || '').trim(); if (!/^https:\/\/\S+$/.test(link)) { toast('Pega un enlace que empiece con https://'); return; } addSlideVersion(el.dataset.id, {link, name: 'Enlace', note: (document.getElementById('slide-note')?.value || '').trim()}); },
  'slide-reviewed': el => { let x = slideFor(el.dataset.id); if (!x) { x = {id: 'sl-s' + el.dataset.id, session: Number(el.dataset.id), versions: [], created: stamp()}; ensureSlides().push(x); } x.reviewedAt = stamp(); x.updated = stamp(); const t = el.dataset.task || 'slide-s' + el.dataset.id; markTask(t, true); closeDialog(); render(); toast('Lámina revisada.'); },
  'context-export': el => { const txt = contextPackage(el.dataset.id), s = sessionById(el.dataset.id); try { navigator.clipboard?.writeText(txt); } catch (e) { /* sin portapapeles */ } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type: 'text/markdown'})); a.download = `contexto-clase-${s.id}-${s.date}.md`; a.click(); toast('Contexto descargado y copiado: guárdalo en tu carpeta privada del Drive o pégalo en GPT.'); },
  'note-file-add': async el => addNoteFile(await pickFile(NOTE_ACCEPT), null, el.dataset.id),
  'slide-folder': el => { const t = buildPlan().find(x => x.kind === 'slide' && x.session === Number(el.dataset.id)); slideDialog(el.dataset.id, t?.id); },
  'note-file-open': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) { openLocalFile(f.key, f.name); if (!f.read) { f.read = true; f.updated = stamp(); save(); render(); } } },
  'note-file-read': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) { f.read = !f.read; f.updated = stamp(); save(); render(); } },
  'note-file-replace': async el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) addNoteFile(await pickFile(NOTE_ACCEPT), f); },
  'note-file-del': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (!f || !confirm(`¿Eliminar «${f.name}» de este dispositivo? No se puede deshacer.`)) return; fileDel(f.key).catch(() => {}); state.noteFiles = state.noteFiles.filter(x => x.id !== f.id); state.deleted = {...(state.deleted || {}), [f.id]: stamp()}; save(); render(); toast('Apunte eliminado.'); },

  'classlog-open': el => classLogDialog(el.dataset.id),
  'classlog-save': () => saveClassLog(document.getElementById('classlog-form')?.dataset.session)
};
Object.assign(STUDY_ACTIONS, SESSION_ACTIONS);
document.addEventListener('change', ev => { if (ev.target.id === 'new-per-day') { state.settings.newCardsPerDay = Number(ev.target.value); save(); cardQueue = null; render(); toast(`Cupo de nuevas: ${ev.target.value} por día. La meta diaria sigue siendo 4 tarjetas aprendidas.`); } });
