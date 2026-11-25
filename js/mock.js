'use strict';
/* Simulacro PMP completo (issue #3): 180 preguntas únicas, 240 minutos, dos pausas
   de 10 minutos que cierran el bloque anterior, 10 preguntas no puntuadas, revisión
   final y desglose por dominio. Se carga después de study.js y antes de app.js.
   El intento en curso vive en state.mockRun (campo adicional; el estado sigue en version:1). */

const MOCK_BLOCK = 60;            // 3 bloques de 60 preguntas
const MOCK_DOMAINS = ['people', 'process', 'business'];
const MOCK_PREDICTIVE = 0.4;
let mockTimer = null, mockReviewOpen = null;

/* Solo ítems de nivel examen: las preguntas level:"intro" son práctica introductoria (issue #7). */
function mockBank() { return D.questions.filter(q => [...MOCK_DOMAINS, 'agile'].includes(q.module) && q.level !== 'intro'); }
function mockRun() { return state.mockRun && typeof state.mockRun === 'object' && Array.isArray(state.mockRun.ids) ? state.mockRun : null; }
function mockQ(id) { return D.questions.find(q => q.id === id); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* Necesidades por dominio sobre las 170 calificadas (56 / 70 / 44). */
function mockNeeds() {
  const graded = MOCK_FORMAT.total - MOCK_FORMAT.unscored;
  const need = Object.fromEntries(MOCK_DOMAINS.map(d => [d, Math.round(graded * MOCK_FORMAT.weights[d])]));
  need.process += graded - MOCK_DOMAINS.reduce((s, d) => s + need[d], 0);
  return need;
}

/* Arma el examen: calificadas por dominio + 10 no puntuadas, sin repeticiones.
   Las preguntas de un mismo escenario se presentan juntas, al inicio (sección de caso). */
function buildMock() {
  const need = mockNeeds(), bank = mockBank(), scored = [], used = new Set(), fams = new Set();
  /* Una sola pregunta por familia (reformulaciones del mismo caso, campo opcional "family"). */
  const take = q => { if (used.has(q.id) || (q.family && fams.has(q.family))) return false; used.add(q.id); if (q.family) fams.add(q.family); return true; };
  for (const d of MOCK_DOMAINS) {
    /* ECO julio 2026: ~40 % predictivo y ~60 % ágil o híbrido, dentro de cada dominio. */
    let n = 0;
    const pool = shuffle(bank.filter(q => q.module === d)), pred = pool.filter(q => q.approach === 'Predictivo'), other = pool.filter(q => q.approach !== 'Predictivo');
    const predNeed = Math.round(need[d] * MOCK_PREDICTIVE);
    for (const q of pred) { if (n >= predNeed) break; if (take(q)) { scored.push(q.id); n++; } }
    for (const q of [...other, ...pred]) { if (n >= need[d]) break; if (take(q)) { scored.push(q.id); n++; } }
    if (n < need[d]) return null;
  }
  const unscored = [];
  for (const q of shuffle(bank.filter(q => !used.has(q.id)))) { if (unscored.length >= MOCK_FORMAT.unscored) break; if (take(q)) unscored.push(q.id); }
  if (unscored.length < MOCK_FORMAT.unscored) return null;
  const chosen = [...scored, ...unscored].map(mockQ);
  const groups = {}, singles = [];
  chosen.forEach(q => q.scenarioId ? (groups[q.scenarioId] = groups[q.scenarioId] || []).push(q.id) : singles.push(q.id));
  const ids = [...shuffle(Object.values(groups)).flat(), ...shuffle(singles)];
  if (new Set(ids).size !== MOCK_FORMAT.total) return null;
  return {ids, unscored, answers: {}, flags: {}, index: 0, block: 0, phase: 'exam', started: stamp(), usedMs: 0, segStart: stamp(), breaks: []};
}

/* ---------- reloj: solo corre en la fase de examen ---------- */
const MOCK_MS = () => MOCK_FORMAT.minutes * 60000;
function mockUsed(r = mockRun()) { return r.usedMs + (r.phase === 'exam' && r.segStart ? Date.now() - Date.parse(r.segStart) : 0); }
function mockLeft(r = mockRun()) { return Math.max(0, MOCK_MS() - mockUsed(r)); }
function breakLeft(r = mockRun()) { const b = r.breaks[r.breaks.length - 1]; return b ? Math.max(0, MOCK_FORMAT.breakMinutes * 60000 - (Date.now() - Date.parse(b.start))) : 0; }
const clock = ms => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function pauseClock(r) { if (r.segStart) { r.usedMs += Date.now() - Date.parse(r.segStart); r.segStart = null; } }
function tick() {
  const r = mockRun();
  if (!r || ['done'].includes(r.phase)) { clearInterval(mockTimer); mockTimer = null; return; }
  if (r.phase === 'exam' && mockLeft(r) <= 0) { finishMock('tiempo'); return; }
  const el = document.getElementById('mock-clock');
  if (el) el.textContent = r.phase === 'break' ? clock(breakLeft(r)) : clock(mockLeft(r));
  const b = document.getElementById('mock-break-clock');
  if (b) b.textContent = clock(breakLeft(r));
}
function ensureTimer() { if (!mockTimer && mockRun() && mockRun().phase !== 'done') mockTimer = setInterval(tick, 1000); }

/* ---------- bloques ---------- */
const blockRange = b => [b * MOCK_BLOCK, Math.min((b + 1) * MOCK_BLOCK, MOCK_FORMAT.total)];
function blockStats(r, b) { const [a, z] = blockRange(b), ids = r.ids.slice(a, z); return {total: ids.length, answered: ids.filter(id => r.answers[id]).length, flagged: ids.filter(id => r.flags[id]).length}; }
function answeredOk(q, sel) {
  return itemOk(q, sel);
}

/* ---------- resultados ---------- */
function mockResults(r) {
  const dom = Object.fromEntries(MOCK_DOMAINS.map(d => [d, {total: 0, correct: 0}]));
  let correct = 0, total = 0;
  r.ids.forEach(id => {
    if (r.unscored.includes(id)) return;
    const q = mockQ(id), ok = answeredOk(q, r.answers[id]);
    total++; if (ok) correct++;
    dom[q.module].total++; if (ok) dom[q.module].correct++;
  });
  return {correct, total, dom};
}
function finishMock(reason) {
  const r = mockRun(); if (!r || r.phase === 'done') return;
  pauseClock(r); r.phase = 'done'; r.completed = stamp(); r.reason = reason; simTab = 'completo';
  const res = mockResults(r);
  r.result = res;
  // Respuestas al historial de intentos (sirve para métricas por dominio).
  r.ids.forEach(id => { const q = mockQ(id), sel = r.answers[id]; if (!sel) return; state.attempts.push({id: uid(), questionId: q.id, topicId: q.topicId, module: q.module, approach: q.approach, selected: [...sel], correct: answeredOk(q, sel), date: r.completed, mock: true}); });
  state.mocks.push({id: uid(), name: 'Simulacro completo en la app', date: today(), correct: res.correct, total: res.total, minutes: Math.max(1, Math.round(r.usedMs / 60000)), realistic: true, source: 'app', domains: res.dom, notes: `${MOCK_FORMAT.unscored} preguntas no puntuadas excluidas del resultado.`});
  ensureStudyState(); const t = buildPlan().find(x => x.kind === 'mock' && !state.tasksDone[x.id] && x.due >= today()); if (t) state.tasksDone[t.id] = stamp();
  save(); mockReviewOpen = null; render(); window.scrollTo({top: 0, behavior: 'instant'});
  toast(reason === 'tiempo' ? 'Se acabó el tiempo. El simulacro se calificó con tus respuestas.' : 'Simulacro terminado. Revisa tu desglose por dominio.');
}

/* ---------- vistas ---------- */
function renderMockRun() {
  const r = mockRun(); ensureTimer();
  if (r.phase === 'done') return renderMockDone(r);  // no se usa desde Simulacros (pestaña), queda como respaldo
  if (r.phase === 'break') {
    const done = r.block, left = breakLeft(r);
    return heading('SIMULACRO PMP COMPLETO', `Pausa ${done} de ${MOCK_FORMAT.breaks}`, 'El reloj del examen está detenido. El bloque anterior quedó cerrado.') +
      `<section class="card mock-break"><p class="eyebrow">TIEMPO DE PAUSA RESTANTE</p><div class="mock-big" id="mock-break-clock" role="timer" aria-live="off">${clock(left)}</div><p class="hint">Bloques cerrados: ${done} de 3. Tiempo de examen restante: <strong>${clock(mockLeft(r))}</strong>. Cuando termine la pausa, el siguiente bloque empieza automáticamente al volver a esta pantalla.</p>${button('Continuar con el bloque ' + (done + 1) + ' ' + icon('arrow'), 'mock-resume', '')}</section>`;
  }
  if (r.phase === 'blockreview') return renderBlockReview(r);
  const [a, z] = blockRange(r.block), id = r.ids[r.index], q = mockQ(id), sel = r.answers[id] || [], L = i => String.fromCharCode(65 + i), sc = scenarioBy(q.scenarioId);
  const body = (q.type === 'dropdown' || q.type === 'hotspot') ? itemBody(q, sel, null, 'mock') : q.type === 'match'
    ? `<p class="hint">Elige la opción que corresponde a cada elemento. Una opción puede quedar sin usar.</p><div class="match-list">${q.items.map((it, i) => `<div class="match-row"><label for="mm-${i}"><span class="option-label">${i + 1}</span> ${esc(it)}</label><select id="mm-${i}" data-mock-match="${i}"><option value="-1">Elige una opción…</option>${q.options.map((o, j) => `<option value="${j}" ${sel[i] === j ? 'selected' : ''}>${L(j)}. ${esc(o)}</option>`).join('')}</select></div>`).join('')}</div>`
    : `<p class="hint">${q.type === 'multi' ? `Selecciona ${q.correct.length} respuestas.` : 'Selecciona una respuesta.'}</p><div class="options">${q.options.map((o, i) => `<label class="option ${sel.includes(i) ? 'selected' : ''}"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="mock-choice" value="${i}" ${sel.includes(i) ? 'checked' : ''}><span class="option-label">${L(i)}</span><span>${esc(o)}</span></label>`).join('')}</div>`;
  const context = sc ? `<details class="scenario" open><summary>${icon('book')} ${esc(sc.title)}</summary><div class="quiz-context">${esc(sc.context)}</div>${chartBlock(sc.chart)}${artifactBlock(sc.table)}</details>` : q.context ? `<div class="quiz-context" style="margin-top:20px">${esc(q.context)}</div>` : '';
  const grid = r.ids.slice(a, z).map((x, k) => `<button class="mock-cell ${r.answers[x] ? 'ans' : ''} ${r.flags[x] ? 'flag' : ''} ${a + k === r.index ? 'cur' : ''}" data-action="mock-goto" data-id="${a + k}" aria-label="Pregunta ${a + k + 1}${r.answers[x] ? ', respondida' : ', sin responder'}${r.flags[x] ? ', marcada' : ''}">${a + k + 1}</button>`).join('');
  const st = blockStats(r, r.block), last = r.index === z - 1;
  return `<div class="mock-bar"><div><strong>Bloque ${r.block + 1} de 3</strong> · Pregunta ${r.index + 1} de ${MOCK_FORMAT.total}</div><div class="mock-clock" role="timer" aria-label="Tiempo restante">${icon('clock')}<span id="mock-clock">${clock(mockLeft(r))}</span></div></div>
  <div class="quiz-layout"><section class="card quiz-card"><div class="quiz-top"><span>${badge(typeLabel(q))}</span>${button(r.flags[id] ? '★ Marcada para revisar' : '☆ Marcar para revisar', 'mock-flag', 'ghost small', `aria-pressed="${Boolean(r.flags[id])}"`)}</div>${progress(pct(r.index + 1, MOCK_FORMAT.total))}${context}${!sc && q.chart && q.type !== 'hotspot' ? chartBlock(q.chart) : ''}${!sc ? artifactBlock(q.table) : ''}<h2>${esc(q.prompt)}</h2>${body}
  <div class="quiz-actions mock-actions">${button('← Anterior', 'mock-prev', 'white', r.index === a ? 'disabled' : '')}${last ? button('Revisar el bloque ' + icon('arrow'), 'mock-block-review', '') : button('Siguiente ' + icon('arrow'), 'mock-next', '')}</div></section>
  <details class="card mock-nav"><summary>Navegador del bloque · ${st.answered}/${st.total} respondidas · ${st.flagged} marcadas</summary><div class="mock-grid">${grid}</div><p class="hint">Puedes volver a cualquier pregunta de este bloque. Al iniciar la pausa, el bloque se cierra.</p><div class="actions">${button('Revisar y cerrar el bloque', 'mock-block-review', 'light small')}${button('Abandonar el simulacro', 'mock-abandon', 'white small')}</div></details></div>`;
}
function renderBlockReview(r) {
  const [a, z] = blockRange(r.block), st = blockStats(r, r.block), lastBlock = r.block === 2;
  const pend = r.ids.slice(a, z).map((id, k) => ({id, n: a + k})).filter(x => !r.answers[x.id] || r.flags[x.id]);
  return `<div class="mock-bar"><div><strong>Revisión del bloque ${r.block + 1}</strong></div><div class="mock-clock">${icon('clock')}<span id="mock-clock">${clock(mockLeft(r))}</span></div></div>
  <section class="card"><h2>Antes de cerrar el bloque ${r.block + 1}</h2><p>${st.answered} de ${st.total} respondidas · ${st.total - st.answered} sin responder · ${st.flagged} marcadas.</p>${pend.length ? `<div class="mock-grid">${pend.map(x => `<button class="mock-cell ${r.answers[x.id] ? 'ans' : ''} ${r.flags[x.id] ? 'flag' : ''}" data-action="mock-goto" data-id="${x.n}">${x.n + 1}</button>`).join('')}</div>` : '<p class="hint">No hay preguntas pendientes ni marcadas.</p>'}
  <p class="hint">${lastBlock ? 'Al terminar se califican tus respuestas. Las preguntas sin responder cuentan como incorrectas.' : `Al iniciar la pausa ${r.block + 1} el bloque se cierra y ya no podrás volver a él. Las preguntas sin responder cuentan como incorrectas.`}</p>
  <div class="actions">${button('Volver al bloque', 'mock-back', 'white')}${lastBlock ? button('Terminar y calificar', 'mock-finish', '') : button(`Cerrar bloque e iniciar pausa ${r.block + 1}`, 'mock-break', '')}${!lastBlock ? button('Cerrar bloque sin pausa', 'mock-skip-break', 'light') : ''}</div></section>`;
}
function renderMockDone(r, embedded = false) {
  const res = r.result || mockResults(r), L = i => String.fromCharCode(65 + i), filter = mockReviewOpen || 'wrong';
  const rows = r.ids.map((id, n) => ({id, n, q: mockQ(id), sel: r.answers[id], unscored: r.unscored.includes(id)})).map(x => ({...x, ok: answeredOk(x.q, x.sel)}))
    .filter(x => filter === 'all' || (filter === 'wrong' ? !x.ok && !x.unscored : filter === 'flag' ? r.flags[x.id] : filter === x.q.module));
  const key = q => itemKey(q);
  const yours = (q, s) => itemYours(q, s);
  const head = `Último simulacro: terminado el ${date(stampDay(r.completed))}${r.reason === 'tiempo' ? ' por fin del tiempo' : ''} · ${Math.max(1, Math.round(r.usedMs / 60000))} min de examen.`;
  return (embedded ? `<p class="hint">${head}</p>` : heading('SIMULACRO PMP COMPLETO', 'Resultado y revisión', head)) +
  `<div class="grid-2"><section class="card"><div class="eyebrow">PREGUNTAS CALIFICADAS</div><div class="result-score">${pct(res.correct, res.total)} %<small>${res.correct} de ${res.total} aciertos · ${MOCK_FORMAT.unscored} preguntas no puntuadas excluidas</small></div><p class="hint">Es una medición propia con el banco de la app, no una predicción del resultado oficial de PMI.</p><div class="actions">${button('Nuevo simulacro', 'mock-new', 'light')}<a class="button white" href="#preparacion">Mi preparación ${icon('arrow')}</a></div></section>
  <section class="card"><h2>Desglose por dominio</h2>${MOCK_DOMAINS.map(d => { const x = res.dom[d]; return `<div class="metric-line"><span>${esc(moduleBy(d).name)}<br><small>${x.correct} de ${x.total}</small></span>${progress(pct(x.correct, x.total))}<strong>${pct(x.correct, x.total)} %</strong></div>`; }).join('')}<table class="sr-only"><caption>Aciertos por dominio</caption><tr><th>Dominio</th><th>Aciertos</th><th>Total</th></tr>${MOCK_DOMAINS.map(d => `<tr><td>${esc(moduleBy(d).name)}</td><td>${res.dom[d].correct}</td><td>${res.dom[d].total}</td></tr>`).join('')}</table></section></div>
  <section class="card"><div class="card-header"><h2>Revisión final</h2><div class="filter-group">${[['wrong', 'Incorrectas'], ['flag', 'Marcadas'], ['people', 'People'], ['process', 'Process'], ['business', 'Business'], ['all', 'Todas']].map(([k, n]) => `<button data-action="mock-review" data-id="${k}" class="${filter === k ? 'active' : ''}">${n}</button>`).join('')}</div></div>
  <p class="hint">${rows.length} preguntas en esta vista.</p>${rows.map(x => `<details class="mock-review-row ${x.ok ? '' : 'wrong'}"><summary><span class="status-dot"></span> ${x.n + 1}. ${esc(x.q.prompt)} ${x.unscored ? badge('No puntuada', 'orange') : ''}</summary>${slotType(x.q) ? `<ol>${x.q.items.map(it => `<li>${esc(it)}</li>`).join('')}</ol>` : ''}${x.q.options ? `<ol type="A">${x.q.options.map(o => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}<p><strong>Tu respuesta:</strong> ${esc(yours(x.q, x.sel))} · <strong>Correcta:</strong> ${esc(key(x.q))}</p><p class="hint">${esc(x.q.rationale)}</p>${whyBlock(x.q)}<p class="hint">${badge(moduleBy(x.q.module).name)} ${badge(x.q.approach, 'blue')} ${esc(topicLabel(x.q.topicId))}</p></details>`).join('')}</section>`;
}

/* ---------- acciones ---------- */
function mockGoto(n) { const r = mockRun(), [a, z] = blockRange(r.block); if (n < a || n >= z) return; r.index = n; r.phase = 'exam'; save(); render(); window.scrollTo({top: 0, behavior: 'instant'}); }
function closeBlock(withBreak) {
  const r = mockRun(); r.block++; r.index = r.block * MOCK_BLOCK;
  if (withBreak) { pauseClock(r); r.phase = 'break'; r.breaks.push({start: stamp()}); }
  else { r.phase = 'exam'; r.breaks.push({start: stamp(), skipped: true}); }
  save(); render(); window.scrollTo({top: 0, behavior: 'instant'});
}
const MOCK_ACTIONS = {
  'mock-full': () => {
    if (mockRun() && mockRun().phase !== 'done') { go('simulacros'); return; }
    dialog('Comenzar simulacro completo', `<div class="help-copy"><p>${MOCK_FORMAT.total} preguntas en ${MOCK_FORMAT.minutes} minutos, en 3 bloques de ${MOCK_BLOCK}. Después de los bloques 1 y 2 puedes tomar una pausa de hasta ${MOCK_FORMAT.breakMinutes} minutos (el reloj del examen se detiene). Al iniciar cada pausa, el bloque anterior se cierra.</p><p>No verás si aciertas hasta el final. ${MOCK_FORMAT.unscored} preguntas no puntúan y no sabrás cuáles son. Si sales de la app, el reloj sigue corriendo, como en el examen.</p></div><div class="actions">${button('Empezar ahora', 'mock-start', '')}${button('Cancelar', 'close-dialog', 'white')}</div>`);
  },
  'mock-start': () => { const r = buildMock(); closeDialog(); if (!r) { toast('El banco todavía no cubre el simulacro completo.'); return; } state.mockRun = r; save(); simTab = 'completo'; ensureTimer(); if (location.hash === '#simulacros') render(); else go('simulacros'); },
  'mock-next': () => { const r = mockRun(); mockGoto(r.index + 1); },
  'mock-prev': () => { const r = mockRun(); mockGoto(r.index - 1); },
  'mock-goto': el => mockGoto(Number(el.dataset.id)),
  'mock-flag': () => { const r = mockRun(), id = r.ids[r.index]; if (r.flags[id]) delete r.flags[id]; else r.flags[id] = true; save(); render(); },
  'mock-block-review': () => { const r = mockRun(); r.phase = 'blockreview'; save(); render(); window.scrollTo({top: 0, behavior: 'instant'}); },
  'mock-back': () => { const r = mockRun(); r.phase = 'exam'; save(); render(); },
  'mock-break': () => closeBlock(true),
  'mock-skip-break': () => closeBlock(false),
  'mock-resume': () => { const r = mockRun(); if (r.phase !== 'break') return; r.breaks[r.breaks.length - 1].end = stamp(); r.phase = 'exam'; r.segStart = stamp(); save(); render(); },
  'mock-finish': () => finishMock('usuario'),
  'mock-abandon': () => dialog('Abandonar el simulacro', `<p class="hint">Se descartará este intento sin calificarlo y sin guardar respuestas en tu historial.</p><div class="actions">${button('Abandonar', 'mock-abandon-ok', 'light')}${button('Seguir con el simulacro', 'close-dialog', '')}</div>`),
  'mock-abandon-ok': () => { state.mockRun = null; save(); closeDialog(); render(); toast('Simulacro descartado.'); },
  'mock-new': () => { state.mockRun = null; save(); MOCK_ACTIONS['mock-full'](); },
  'mock-review': el => { mockReviewOpen = el.dataset.id; render(); }
};
Object.assign(STUDY_ACTIONS, MOCK_ACTIONS);

/* Selección de respuestas (sin corrección durante el examen). */
document.addEventListener('change', ev => {
  const r = mockRun(); if (!r || r.phase !== 'exam') return;
  const el = ev.target, id = r.ids[r.index], q = mockQ(id);
  if (el.name === 'mock-choice') {
    const v = Number(el.value);
    let sel = multiPick(q) ? [...(r.answers[id] || [])] : [];
    if (multiPick(q)) sel = el.checked ? [...new Set([...sel, v])].sort() : sel.filter(x => x !== v); else sel = [v];
    if (sel.length) r.answers[id] = sel; else delete r.answers[id];
    save(); render();
  } else if (el.dataset.mockMatch !== undefined) {
    const sel = r.answers[id] ? [...r.answers[id]] : q.items.map(() => -1);
    sel[Number(el.dataset.mockMatch)] = Number(el.value);
    if (sel.every(x => x < 0)) delete r.answers[id]; else r.answers[id] = sel;
    save();
  }
});
/* Pausa vencida: al volver a la pantalla, se reanuda el examen. */
setInterval(() => { const r = mockRun(); if (r && r.phase === 'break' && breakLeft(r) <= 0) { MOCK_ACTIONS['mock-resume'](); toast('Terminó la pausa. Continúa el siguiente bloque.'); } }, 1000);
