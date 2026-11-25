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

const SESSION_ACTIONS = {
  'classlog-open': el => classLogDialog(el.dataset.id),
  'classlog-save': () => saveClassLog(document.getElementById('classlog-form')?.dataset.session)
};
Object.assign(STUDY_ACTIONS, SESSION_ACTIONS);
