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
function slideStatus(sid) { const x = slideFor(sid); if (!x || !x.versions?.length) return 'pendiente'; return x.reviewedAt ? 'revisada' : 'disponible'; }
const SLIDE_LABEL = {pendiente: 'Pendiente de generación', disponible: 'Disponible', revisada: 'Revisada'};
function slideDialog(sid, taskId) {
  const s = sessionById(sid); if (!s) return;
  const x = slideFor(sid), v = x?.versions?.[x.versions.length - 1], st = slideStatus(sid);
  const open = v ? (v.link ? `<a class="button" href="${esc(v.link)}" target="_blank" rel="noopener">Abrir lámina ${icon('arrow')}</a>` : (filesMem.has(v.key) ? button('Abrir lámina ' + icon('arrow'), 'slide-open', '', `data-id="${s.id}"`) : '<span class="hint">El PDF de esta lámina se cargó en otro dispositivo.</span>')) : '';
  dialog(`Lámina de repaso · clase ${s.id} (${date(s.date, {day: 'numeric', month: 'short'})})`, `<p>${badge(SLIDE_LABEL[st], st === 'revisada' ? 'green' : st === 'disponible' ? 'blue' : 'orange')} ${classLogFor(s.id) ? `Avance declarado: lección ${classLogFor(s.id).lessons.join(' y ')}` : 'Sin avance declarado para esta clase'}</p>
    <p class="hint">GPT redacta la lámina a partir de tu avance, las notas del profesor, el PPT v4.1 y tus apuntes, si los hay. Cárgala aquí como PDF o pega el enlace privado donde la dejó (por ejemplo, tu Drive). Las versiones anteriores se conservan.</p>
    ${v ? `<p class="hint">Versión ${x.versions.length} · ${esc(v.name || v.link || '')} · cargada el ${date(stampDay(v.at), {day: 'numeric', month: 'short'})}${v.note ? ' · ' + esc(v.note) : ''}</p>` : ''}
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
function renderNoteFiles() {
  const files = ensureNoteFiles().filter(f => !f.removed).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const past = [...D.sessions].filter(s => s.date <= today()).sort((a, b) => b.date.localeCompare(a.date));
  const defLesson = declaredLessonAsOf(today())?.n || (typeof activeLesson === 'function' ? activeLesson(weekStart())?.n : 1) || 1;
  return `<section class="card note-files"><div class="card-header"><div><h2>Apuntes por sesión (OneNote)</h2><p>Opcionales. Ayudan a preparar la lámina de repaso de la clase.</p></div></div>
  <p class="hint">Exporta la página de OneNote como <strong>PDF</strong> (o .docx) y cárgala aquí indicando la sesión. Los archivos .one/.onepkg no se pueden leer en el navegador: expórtalos a PDF primero. El archivo queda <strong>solo en este dispositivo</strong>; en tus otros dispositivos verás la ficha, pero no el archivo. Ni Claude ni GPT pueden leerlo desde la app: si quieres que GPT lo use, súbelo también a tu carpeta privada del Drive.</p>
  <div class="form-grid">${field('Sesión', 'nf-session', `<select id="nf-session">${past.map(s => `<option value="${s.id}">Clase ${s.id} · ${date(s.date, {day: 'numeric', month: 'short'})}${classLogFor(s.id) ? ' · L' + classLogFor(s.id).lessons.join('+') : ''}</option>`).join('')}</select>`)}${field('Lección v4.1', 'nf-lesson', `<select id="nf-lesson">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${n === defLesson ? 'selected' : ''}>Lección ${n}</option>`).join('')}</select>`)}</div>
  <div class="actions">${button('Cargar apunte', 'note-file-add', 'light')}</div>
  ${files.length ? `<div class="stack">${files.map(f => `<article class="item-card note-file"><div class="row"><div><div class="meta">${badge('Clase ' + f.session, 'ingenium')} ${badge('L' + f.lesson, 'green')} ${f.read ? badge('Leído', 'green') : badge('Sin leer', 'orange')}</div><h3>${esc(f.label)}</h3><p class="hint">${esc(f.name)} · ${Math.max(1, Math.round((f.size || 0) / 1024))} KB${filesMem.has(f.key) ? '' : ' · el archivo está en otro dispositivo'}</p></div></div><div class="actions">${filesMem.has(f.key) ? button('Abrir', 'note-file-open', 'light small', `data-id="${f.id}"`) : ''}${button(f.read ? 'Marcar sin leer' : 'Marcar leído', 'note-file-read', 'ghost small', `data-id="${f.id}"`)}${filesMem.has(f.key) ? button('Reemplazar', 'note-file-replace', 'ghost small', `data-id="${f.id}"`) : ''}${button('Eliminar', 'note-file-del', 'ghost small', `data-id="${f.id}"`)}</div></article>`).join('')}</div>` : '<p class="hint">Aún no cargaste apuntes.</p>'}</section>`;
}
async function addNoteFile(file, existing) {
  if (!file) return;
  if (/\.(one|onepkg|onetoc2)$/i.test(file.name)) { toast('Los archivos de OneNote (.one) no se pueden leer en el navegador: exporta la página a PDF y cárgala.'); return; }
  if (file.size > 25e6) { toast('El archivo supera 25 MB.'); return; }
  const now = stamp();
  if (existing) { await filePut(existing.key, file); Object.assign(existing, {name: file.name, size: file.size, type: file.type, read: false, updated: now}); }
  else {
    const sid = Number(document.getElementById('nf-session')?.value), lesson = Number(document.getElementById('nf-lesson')?.value), s = sessionById(sid), id = uid(), key = 'note-' + id;
    await filePut(key, file);
    ensureNoteFiles().push({id, key, session: sid, date: s?.date || today(), lesson, label: `${s?.date || today()}_L${lesson}`, name: file.name, size: file.size, type: file.type, read: false, local: true, created: now, updated: now});
  }
  save(); render(); toast('Apunte guardado en este dispositivo.');
}

/* ---------- paquete de contexto por sesión (para que GPT prepare la lámina) ----------
   La app no puede escribir en tu Drive: genera un archivo de texto que puedes guardar en tu carpeta privada o pegar en GPT. */
function contextPackage(sid) {
  const s = sessionById(sid), r = classLogFor(sid), d = classLogDiscrepancy(r), notesFiles = ensureNoteFiles().filter(f => f.session === Number(sid) && !f.removed);
  const gaps = [!r && 'No hay avance declarado por Fabrizio.', s.mapping !== 'confirmada' && 'Aún no hay notas del profesor confirmadas en el Drive para esta clase.', !notesFiles.length && 'No hay apuntes de OneNote cargados (opcional).'].filter(Boolean);
  return [`# Contexto de la clase ${s.id} · ${s.date}`, '', `- Programa INGENIUM: ${s.title}`, `- PPT de referencia: ${s.ppt}`,
    `- Avance declarado por Fabrizio: ${r ? `lección v4.1 ${r.lessons.join(' y ')}${r.sections ? '; secciones: ' + r.sections : ''}${r.lastTopic ? '; último tema/diapositiva: ' + r.lastTopic : ''}${r.notes ? '; observaciones: ' + r.notes : ''} (registrado ${stampDay(r.updated)})` : 'sin registrar'}`,
    `- Notas del profesor (Google Sheets en la carpeta de la lección del Drive): ${s.mapping === 'confirmada' ? 'confirmadas, lección ' + s.lesson41.join(' y ') : 'por confirmar'}`,
    `- Apuntes de OneNote: ${notesFiles.length ? notesFiles.map(f => f.name + (f.local ? ' (solo en el dispositivo de Fabrizio)' : '')).join(', ') : 'ninguno'}`,
    d ? `- Discrepancia: Fabrizio declaró la lección ${d.declared.join(' y ')}; las notas del profesor indican la ${d.notes.join(' y ')}. Marcar como provisional.` : '',
    '', '## Brechas', ...(gaps.length ? gaps.map(g => '- ' + g) : ['- Ninguna.']), '',
    `## Pedido`, `Preparar la lámina de repaso de esta clase (original, breve y visual; con conceptos esenciales, palabras clave, ejemplos de construcción, errores frecuentes, reglas de decisión PMP y autoevaluación opcional) para revisarla el día de la siguiente clase a las 18:00. Marcar como provisional lo no confirmado.`].filter(x => x !== '').join('\n');
}

const SESSION_ACTIONS = {
  'slide-open': el => { const x = slideFor(el.dataset.id), v = x?.versions?.[x.versions.length - 1]; if (v) openLocalFile(v.key, v.name); },
  'slide-upload': async el => { const f = await pickFile('application/pdf,.pdf'); if (!f) return; if (f.size > 30e6) { toast('El PDF supera 30 MB.'); return; } const sid = el.dataset.id, key = `slide-s${sid}-${Date.now()}`; await filePut(key, f); addSlideVersion(sid, {key, name: f.name, size: f.size, local: true, note: (document.getElementById('slide-note')?.value || '').trim()}); },
  'slide-save-link': el => { const link = (document.getElementById('slide-link')?.value || '').trim(); if (!/^https:\/\/\S+$/.test(link)) { toast('Pega un enlace que empiece con https://'); return; } addSlideVersion(el.dataset.id, {link, name: 'Enlace', note: (document.getElementById('slide-note')?.value || '').trim()}); },
  'slide-reviewed': el => { const x = slideFor(el.dataset.id); if (!x) return; x.reviewedAt = stamp(); x.updated = stamp(); const t = el.dataset.task || 'slide-s' + el.dataset.id; markTask(t, true); closeDialog(); render(); toast('Lámina revisada.'); },
  'context-export': el => { const txt = contextPackage(el.dataset.id), s = sessionById(el.dataset.id); try { navigator.clipboard?.writeText(txt); } catch (e) { /* sin portapapeles */ } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type: 'text/markdown'})); a.download = `contexto-clase-${s.id}-${s.date}.md`; a.click(); toast('Contexto descargado y copiado: guárdalo en tu carpeta privada del Drive o pégalo en GPT.'); },
  'note-file-add': async () => addNoteFile(await pickFile(NOTE_ACCEPT)),
  'note-file-open': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) { openLocalFile(f.key, f.name); if (!f.read) { f.read = true; f.updated = stamp(); save(); render(); } } },
  'note-file-read': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) { f.read = !f.read; f.updated = stamp(); save(); render(); } },
  'note-file-replace': async el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (f) addNoteFile(await pickFile(NOTE_ACCEPT), f); },
  'note-file-del': el => { const f = ensureNoteFiles().find(x => x.id === el.dataset.id); if (!f || !confirm(`¿Eliminar «${f.name}» de este dispositivo? No se puede deshacer.`)) return; fileDel(f.key).catch(() => {}); state.noteFiles = state.noteFiles.filter(x => x.id !== f.id); state.deleted = {...(state.deleted || {}), [f.id]: stamp()}; save(); render(); toast('Apunte eliminado.'); },

  'classlog-open': el => classLogDialog(el.dataset.id),
  'classlog-save': () => saveClassLog(document.getElementById('classlog-form')?.dataset.session)
};
Object.assign(STUDY_ACTIONS, SESSION_ACTIONS);
document.addEventListener('change', ev => { if (ev.target.id === 'new-per-day') { state.settings.newCardsPerDay = Number(ev.target.value); save(); cardQueue = null; render(); toast(`Cupo de nuevas: ${ev.target.value} por día. La meta diaria sigue siendo 4 tarjetas aprendidas.`); } });
