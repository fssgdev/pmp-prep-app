'use strict';
/* Historial automático y bucle de fallos (pedido de Fabrizio, 24/11; issue #9).
   - state.results: cada Bullet Quiz, cuestionario del sábado, cuestionario de sesión, práctica, examen completo
     o quiz importado desde PDF queda registrado solo: {id, kind, label, date, at, total, correct, dom, wrong, taskId}.
   - state.errors: cada pregunta fallada (en cualquier parte) queda abierta con un vencimiento:
       falla → vuelve el siguiente día de rutina; acierto → +3 días; dos aciertos seguidos → resuelta.
     Las vencidas se reinsertan en el Bullet Quiz (hasta 2 de 5), en el cuestionario del sábado (hasta 5 de 20)
     y como tarjetas en Flashcards mientras sigan abiertas.
   - Las preguntas importadas de un PDF (no están en el banco) solo viven como tarjeta y se resuelven cuando su
     tarjeta llega a un repaso de 7 días o más.
   Se carga después de items.js y antes de mock.js y app.js. */

const RESULT_KINDS = {bullet: 'Bullet Quiz', weekly: 'Cuestionario del sábado', session: 'Cuestionario de sesión', review: 'Repaso de sesión', mixed: 'Práctica mixta', practice: 'Práctica', mock: 'Examen completo', import: 'Quiz importado (PDF)', failures: 'Repaso de fallos'};
function ensureResults() { if (!Array.isArray(state.results)) state.results = []; if (!Array.isArray(state.errors)) state.errors = []; }
function kindOf(taskId, label = '') {
  const t = String(taskId || '');
  if (t.startsWith('bullet-')) return 'bullet';
  if (t.startsWith('week20-')) return 'weekly';
  if (t.startsWith('quiz-s')) return 'session';
  if (t.startsWith('rev-')) return 'review';
  if (t.startsWith('mix-')) return 'mixed';
  if (/fallos/i.test(label)) return 'failures';
  return 'practice';
}
function domTally(qs, okFn) {
  const dom = {};
  qs.forEach(q => { const d = q.module || 'otro'; dom[d] = dom[d] || {total: 0, correct: 0}; dom[d].total++; if (okFn(q)) dom[d].correct++; });
  return dom;
}
function recordResult(r) {
  ensureResults();
  const res = {id: uid(), date: today(), at: stamp(), ...r};
  state.results.push(res);
  if (state.results.length > 800) state.results = state.results.slice(-800);
  return res;
}
/* Al terminar un cuestionario de práctica (incluye Bullet, sábado, sesión). Lo llama app.js. */
function recordQuizResult(s) {
  const qs = s.ids.map(id => allQuestions().find(q => q.id === id)).filter(Boolean);
  const ok = q => s.answers[s.ids.indexOf(q.id)]?.correct;
  recordResult({kind: kindOf(s.taskId, s.label), label: s.label, taskId: s.taskId || null, total: qs.length, correct: qs.filter(ok).length, dom: domTally(qs, ok), wrong: qs.filter(q => !ok(q)).map(q => q.id), minutes: Math.max(1, Math.round((Date.parse(s.completed) - Date.parse(s.started)) / 60000))});
}

/* ---------- fallos ---------- */
const openError = qid => (state.errors || []).find(e => e.questionId === qid && !e.resolved);
function noteFailure(q, source) {
  ensureResults();
  const next = typeof workDay === 'function' ? workDay(plusDays(today(), 1), true) : plusDays(today(), 1);
  let e = openError(q.id);
  if (e) { e.misses = (e.misses || 1) + 1; e.hits = 0; e.due = next; e.updated = stamp(); e.lastSource = source; return e; }
  e = {id: uid(), questionId: q.id, topicId: q.topicId, module: q.module, prompt: q.prompt, category: q.category || 'Conceptual', lesson: q.rationale, action: 'Volverá en tu Bullet Quiz, el cuestionario del sábado y como tarjeta hasta que la aciertes dos veces.', date: today(), due: next, resolved: false, source, hits: 0, misses: 1, updated: stamp()};
  state.errors.unshift(e);
  return e;
}
function noteSuccess(q) {
  const e = openError(q.id); if (!e) return null;
  e.hits = (e.hits || 0) + 1; e.updated = stamp();
  if (e.hits >= 2) { e.resolved = true; e.resolvedAt = stamp(); e.resolvedBy = 'dos aciertos'; }
  else e.due = typeof workDay === 'function' ? workDay(plusDays(today(), 3), true) : plusDays(today(), 3);
  return e;
}
/* Preguntas del banco con fallo abierto y vencido (las más falladas primero). */
function dueFailureIds(limit, accept = () => true) {
  const bank = new Map(allQuestions().map(q => [q.id, q]));
  return (state.errors || []).filter(e => !e.resolved && e.questionId && bank.has(e.questionId) && (e.due || e.date) <= today() && !bank.get(e.questionId).scenarioId && accept(e.questionId))
    .sort((a, b) => (b.misses || 1) - (a.misses || 1) || String(a.due || a.date).localeCompare(String(b.due || b.date)))
    .slice(0, limit).map(e => e.questionId);
}
function openFailures() { return (state.errors || []).filter(e => !e.resolved); }
/* Temas con más fallos abiertos (incluye los importados del PDF), para reforzarlos. */
function weakTopics(n = 3) {
  const c = {}; openFailures().forEach(e => { if (e.topicId) c[e.topicId] = (c[e.topicId] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/* ---------- tarjetas de fallos ---------- */
function failureCards() {
  const bank = new Map(allQuestions().map(q => [q.id, q]));
  return openFailures().map(e => {
    const q = e.questionId && bank.get(e.questionId);
    const answer = q ? itemKey(q) : (e.correctText || 'Revisa la respuesta correcta en tu quiz.');
    const front = q ? q.prompt : e.prompt;
    return {id: 'err-' + e.id, errorId: e.id, front, back: `Respuesta correcta: ${answer}`, example: q ? q.rationale : (e.yourText ? `Tu respuesta fue: ${e.yourText}` : ''), exLabel: q ? 'POR QUÉ' : 'EN TU QUIZ', topicId: e.topicId, failCard: true, concept: e.source === 'pdf' ? 'Fallo de quiz importado' : 'Pregunta fallada'};
  });
}
/* Fallos importados (sin pregunta en el banco): se resuelven cuando su tarjeta llega a un repaso de 7 días o más. */
function resolveImportedByCards() {
  (state.errors || []).forEach(e => {
    if (e.resolved || e.questionId) return;
    const s = state.cards?.['err-' + e.id];
    if (s && s.phase === 'review' && (s.interval || 0) >= 7) { e.resolved = true; e.resolvedAt = stamp(); e.resolvedBy = 'tarjeta'; e.updated = stamp(); }
  });
}

/* ---------- vista: historial automático ---------- */
function renderHistory() {
  ensureResults();
  const rs = [...state.results].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = openFailures(), due = open.filter(e => (e.due || e.date) <= today());
  const by = k => rs.filter(r => r.kind === k);
  const avg = list => list.length ? Math.round(list.reduce((s, r) => s + (r.total ? r.correct / r.total : 0), 0) / list.length * 100) + ' %' : '—';
  const stats = [['bullet', 'Bullet Quiz', 'check'], ['weekly', 'Cuestionarios del sábado', 'calendar'], ['mock', 'Exámenes completos', 'mock'], ['import', 'Quizzes importados', 'download']]
    .map(([k, n, ic]) => stat(n, by(k).length, 'promedio ' + avg(by(k)), ic)).join('');
  const row = r => `<article class="history-row"><div class="date-box"><b>${Number(r.date.slice(8))}</b><span>${date(r.date, {month: 'short'})}</span></div><div class="content"><div class="meta">${badge(RESULT_KINDS[r.kind] || 'Práctica', r.kind === 'mock' ? 'blue' : r.kind === 'import' ? 'orange' : r.kind === 'bullet' ? 'green' : '')}${r.minutes ? ` <span class="hint">${r.minutes} min</span>` : ''}</div><h3>${esc(r.label || RESULT_KINDS[r.kind])}</h3><p class="hint">${Object.entries(r.dom || {}).filter(([d]) => moduleBy(d)).map(([d, x]) => `${esc(moduleBy(d).name)} ${x.correct}/${x.total}`).join(' · ')}${r.wrong?.length ? ` · ${r.wrong.length} ${r.wrong.length === 1 ? 'fallo' : 'fallos'} enviados a repaso` : ''}</p></div><div class="row-end"><strong class="stat-value">${pct(r.correct, r.total)}<small>%</small></strong><span class="hint">${r.correct}/${r.total}</span>${r.wrong?.some(id => allQuestions().some(q => q.id === id)) ? button('Repasar fallos', 'history-retry', 'ghost small', `data-id="${r.id}"`) : ''}</div></article>`;
  return `<div class="stats">${stats}</div>
  <div class="grid-2"><section class="card"><div class="card-header"><div><h2>Fallos por repasar</h2><p>${open.length} abiertos · ${due.length} vencen hoy o antes</p></div>${button('Repasar los vencidos ' + icon('arrow'), 'failures-now', 'light small', due.some(e => e.questionId) ? '' : 'disabled')}</div>
  <p class="hint">Cada pregunta que fallas en un Bullet Quiz, un cuestionario, un examen o un quiz importado queda aquí sola. Vuelve al día de rutina siguiente: hasta 2 en tu Bullet Quiz, hasta 5 en el cuestionario del sábado y como tarjeta en Flashcards. Se cierra cuando la aciertas dos veces seguidas (o, si viene de un PDF, cuando dominas su tarjeta).</p>
  ${weakTopics().length ? `<p class="hint"><strong>Temas con más fallos:</strong> ${weakTopics().map(t => badge(topicLabel(t) + ' · ' + (topicBy(t)?.title || ''), 'orange')).join(' ')}</p>` : ''}<a class="text-link" href="#errores">Ver el registro de errores ${icon('arrow')}</a></section>
  ${renderPdfImport()}</div>
  <section class="card" style="margin-top:20px"><div class="card-header"><div><h2>Historial automático</h2><p>Se registra solo al terminar cada Bullet Quiz, cuestionario, práctica o examen completo.</p></div></div>${rs.length ? rs.slice(0, 60).map(row).join('') : empty('Aún no hay intentos registrados', 'Cuando termines tu primer Bullet Quiz o cuestionario aparecerá aquí con su puntaje y sus fallos.')}</section>`;
}
const RESULT_ACTIONS = {
  'history-retry': el => { const r = state.results.find(x => x.id === el.dataset.id); const qs = (r?.wrong || []).map(id => allQuestions().find(q => q.id === id)).filter(Boolean); if (qs.length) startQuiz(qs, 'all', 'Repaso de fallos · ' + (r.label || '')); },
  'failures-now': () => { const ids = dueFailureIds(20); const qs = ids.map(id => allQuestions().find(q => q.id === id)).filter(Boolean); if (qs.length) startQuiz(qs, 'all', 'Repaso de fallos vencidos'); else toast('No tienes fallos vencidos del banco por repasar.'); }
};

Object.assign(STUDY_ACTIONS, RESULT_ACTIONS);
