'use strict';
/* Plan de estudio, flashcards, conceptos, agenda y simulacros (issue #3).
   Se carga antes de app.js y usa sus utilidades en tiempo de ejecución. */

const EXAM_TENTATIVE = '2027-01-31';
const REVIEW_DAYS = [1, 3, 7, 14];
const NEW_CARDS_PER_DAY = 8;
const MOCK_FORMAT = {total: 180, unscored: 10, minutes: 240, breaks: 2, breakMinutes: 10, weights: {people: .33, process: .41, business: .26}};
let simTab = 'practica', conceptFilter = 'all', conceptSearch = '', cardQueue = null, cardRevealed = false, agendaSource = 'all';
let simFilter = null;

/* ---------- utilidades ---------- */
const examDate = () => state.settings.examDate || EXAM_TENTATIVE;
const examConfirmed = () => Boolean(state.settings.examDate && state.settings.examConfirmed);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay(); // 0 = domingo
const kw = text => esc(text).replace(/\[\[(.+?)\]\]/g, '<mark class="kw">$1</mark>');
const plain = text => String(text).replace(/\[\[(.+?)\]\]/g, '$1');
function ensureStudyState() {
  if (!state.tasksDone || typeof state.tasksDone !== 'object' || Array.isArray(state.tasksDone)) state.tasksDone = {};
  if (!state.cards || typeof state.cards !== 'object' || Array.isArray(state.cards)) state.cards = {};
  if (!Array.isArray(state.cardLog)) state.cardLog = [];
}
const questionsFor = topics => allQuestions().filter(q => topics.includes(q.topicId));
const topicLabel = id => { const t = topicBy(id); return t ? (t.code.startsWith('A') ? t.code : 'ECO ' + t.code) : id; };

/* ---------- plan con vencimientos ---------- */
function buildPlan() {
  ensureStudyState();
  const exam = examDate(), tasks = [], seen = new Set();
  const ss = [...D.sessions].sort((a, b) => a.date.localeCompare(b.date));
  ss.forEach((s, i) => {
    const next = ss[i + 1];
    const due = next ? plusDays(next.date, -1) : plusDays(exam, -7);
    if (s.topics.length) {
      tasks.push({id: 'quiz-s' + s.id, kind: 'quiz', session: s.id, date: s.date, due, topics: s.topics,
        title: `Cuestionario de la sesión ${s.id}`, detail: s.title});
      REVIEW_DAYS.forEach(d => {
        const day = plusDays(s.date, d), key = day + '|' + s.topics.join(',');
        if (day >= plusDays(exam, -1) || seen.has(key)) return;
        seen.add(key);
        tasks.push({id: `rev-s${s.id}-d${d}`, kind: 'review', session: s.id, date: day, due: day, topics: s.topics,
          title: `Repaso +${d} días · sesión ${s.id}`, detail: s.topics.map(topicLabel).join(', ')});
      });
    } else {
      tasks.push({id: 'study-s' + s.id, kind: 'manual', session: s.id, date: s.date, due,
        title: `Sesión ${s.id}: preparar la aplicación PMP`, detail: 'Revisa requisitos, horas de formación y experiencia para tu solicitud.'});
    }
  });
  // Tramo final: desde el 7 de enero hasta el examen.
  const start = '2027-01-07', mock1 = plusDays(exam, -14), mock2 = plusDays(exam, -7);
  for (let d = start; d < plusDays(exam, -1); d = plusDays(d, 1)) {
    const wd = weekday(d);
    if (d === mock1 || d === mock2) continue;
    if (wd === 0) tasks.push({id: 'err-' + d, kind: 'errors', date: d, due: d, title: 'Revisión semanal de errores', detail: 'Repasa y cierra los errores abiertos.'});
    else if ([1, 3, 5].includes(wd)) tasks.push({id: 'mix-' + d, kind: 'mixed', date: d, due: d, title: 'Práctica mixta de 20 preguntas', detail: 'Los tres dominios y todos los enfoques.'});
  }
  if (mock1 >= today() || mock1 >= start) {
    tasks.push({id: 'mock-1', kind: 'mock', date: mock1, due: mock1, title: 'Simulacro completo 1', detail: '180 preguntas en 240 minutos, en condiciones de examen.'});
    tasks.push({id: 'mockrev-1', kind: 'errors', date: plusDays(mock1, 1), due: plusDays(mock1, 1), title: 'Revisión del simulacro 1', detail: 'Analiza los errores por dominio y ajusta tu plan.'});
  }
  tasks.push({id: 'mock-2', kind: 'mock', date: mock2, due: mock2, title: 'Simulacro completo 2', detail: '180 preguntas en 240 minutos, en condiciones de examen.'});
  tasks.push({id: 'mockrev-2', kind: 'errors', date: plusDays(mock2, 1), due: plusDays(mock2, 1), title: 'Revisión del simulacro 2', detail: 'Cierra brechas puntuales; no inicies temas nuevos.'});
  tasks.push({id: 'light-close', kind: 'manual', date: plusDays(exam, -1), due: plusDays(exam, -1), title: 'Cierre ligero antes del examen', detail: 'Repasa conceptos clave y tarjetas, revisa la logística y descansa.'});
  return tasks.sort((a, b) => a.due.localeCompare(b.due) || a.date.localeCompare(b.date));
}
function taskStatus(t) {
  if (state.tasksDone?.[t.id]) return 'done';
  const d = today();
  if (t.due < d) return 'overdue';
  if (t.date <= d) return 'today';
  return 'upcoming';
}
const statusBadge = st => ({done: badge('Hecho', 'green'), overdue: badge('Vencido', 'red'), today: badge('Para hoy', 'orange'), upcoming: badge('Próximo')})[st];
function taskAction(t, kind = 'button') {
  const label = {quiz: 'Hacer cuestionario', review: 'Repasar', mixed: 'Practicar', errors: 'Ver errores', mock: 'Ir a simulacros', manual: 'Ver'}[t.kind];
  return button(label + ' ' + icon('arrow'), 'task-do', 'light small', `data-id="${t.id}"`);
}
function taskRow(t) {
  const st = taskStatus(t);
  return `<article class="task-row ${st}"><button class="check-button ${st === 'done' ? 'done' : ''}" data-action="task-toggle" data-id="${t.id}" aria-pressed="${st === 'done'}" aria-label="${st === 'done' ? 'Marcar pendiente' : 'Marcar como hecho'}">${icon('check')}</button><div class="content"><div class="meta">${statusBadge(st)} <span>${t.date === t.due ? date(t.due, {weekday: 'short', day: 'numeric', month: 'short'}) : 'Vence ' + date(t.due, {weekday: 'short', day: 'numeric', month: 'short'})}</span></div><h3>${esc(t.title)}</h3><p class="hint">${esc(t.detail || '')}</p></div>${st !== 'done' ? taskAction(t) : ''}</article>`;
}
function markTask(id, done = true) { ensureStudyState(); state.deleted = state.deleted || {}; if (done) { state.tasksDone[id] = stamp(); delete state.deleted['task:' + id]; } else { delete state.tasksDone[id]; state.deleted['task:' + id] = stamp(); } save(); }
function doTask(id) {
  const t = buildPlan().find(x => x.id === id); if (!t) return;
  if (t.kind === 'quiz') startQuiz(questionsFor(t.topics), 10, t.title, false, t.id);
  else if (t.kind === 'review') startQuiz(questionsFor(t.topics), 5, t.title, false, t.id);
  else if (t.kind === 'mixed') startQuiz(allQuestions(), 20, t.title, false, t.id);
  else if (t.kind === 'errors') go('errores');
  else if (t.kind === 'mock') { simTab = 'completo'; go('simulacros'); }
  else dialog(t.title, `<p class="hint">${esc(t.detail)}</p><div class="actions">${button('Marcar como hecho', 'task-toggle', '', `data-id="${t.id}"`)}${button('Cerrar', 'close-dialog', 'white')}</div>`);
}

/* ---------- flashcards (repetición espaciada) ---------- */
function allCards() { return (D.concepts || []).flatMap(c => c.cards.map(k => ({...k, conceptId: c.id, concept: c.title, topicId: c.topicId}))); }
function cardState(id) { return state.cards[id] || null; }
function newToday() { return state.cardLog.filter(l => l.first && l.date === today()).length; }
function buildQueue() {
  ensureStudyState();
  const t = today(), cards = allCards();
  const due = cards.filter(c => cardState(c.id) && cardState(c.id).due <= t).sort((a, b) => cardState(a.id).due.localeCompare(cardState(b.id).due));
  const fresh = cards.filter(c => !cardState(c.id)).slice(0, Math.max(0, NEW_CARDS_PER_DAY - newToday()));
  return [...due, ...fresh].map(c => c.id);
}
function cardsDueCount() { return buildQueue().length; }
function schedule(prev, grade) {
  const s = prev ? {...prev} : {interval: 0, ease: 2.5, reps: 0, lapses: 0};
  const isNew = !prev || s.reps === 0;
  if (grade === 'again') { s.interval = 0; s.ease = Math.max(1.3, s.ease - .2); s.lapses++; }
  else if (grade === 'hard') { s.interval = isNew ? 1 : Math.max(1, Math.round(s.interval * 1.2)); s.ease = Math.max(1.3, s.ease - .15); }
  else if (grade === 'good') { s.interval = isNew ? 1 : s.interval <= 1 ? 3 : Math.round(s.interval * s.ease); }
  else { s.interval = isNew ? 4 : Math.max(4, Math.round(s.interval * s.ease * 1.3)); s.ease += .15; }
  if (grade !== 'again') s.reps++;
  s.due = plusDays(today(), s.interval);
  return s;
}
const intervalText = n => n === 0 ? 'hoy' : n === 1 ? '1 día' : n + ' días';
function gradeCard(grade) {
  ensureStudyState();
  const id = cardQueue[0], prev = cardState(id), next = schedule(prev, grade);
  state.cards[id] = next;
  state.cardLog.push({id, date: today(), grade, first: !prev, at: stamp()});
  if (state.cardLog.length > 3000) state.cardLog = state.cardLog.slice(-3000);
  cardQueue.shift();
  if (grade === 'again') cardQueue.push(id);
  cardRevealed = false;
  if (!cardQueue.length) { state.tasksDone['cards-' + today()] = stamp(); toast('Tarjetas del día completadas.'); }
  save(); render();
}

/* ---------- vistas ---------- */
function countdownCard() {
  const left = daysBetween(today(), examDate());
  return `<section class="card countdown"><div class="eyebrow">CUENTA REGRESIVA</div><div class="count-number">${Math.max(0, left)}<small>${left === 1 ? 'día' : 'días'}</small></div><p>para el examen PMP · ${date(examDate(), {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})}</p><div class="actions" style="margin-top:12px">${examConfirmed() ? badge('Fecha confirmada', 'green') : badge('Fecha tentativa · por confirmar', 'orange')} ${button('Cambiar fecha', 'settings', 'ghost')}</div></section>`;
}
function activity7() {
  const days = Array.from({length: 7}, (_, i) => plusDays(today(), i - 6));
  const ans = d => state.attempts.filter(a => stampDay(a.date) === d).length;
  const crd = d => (state.cardLog || []).filter(l => l.date === d).length;
  const tsk = d => Object.values(state.tasksDone || {}).filter(s => stampDay(s) === d).length;
  return days.map(d => ({d, ans: ans(d), cards: crd(d), tasks: tsk(d)}));
}
function nextStep(todayTasks, overdue, qCards, cardsDone) {
  const pending = todayTasks.filter(t => taskStatus(t) === 'today');
  if (pending.length) { const t = pending[0]; return {eyebrow: 'TU SIGUIENTE PASO', title: t.title, text: t.detail, action: button({quiz: 'Empezar cuestionario', review: 'Empezar repaso', mixed: 'Empezar práctica', errors: 'Revisar errores', mock: 'Ir a simulacros', manual: 'Ver detalle'}[t.kind] + ' ' + icon('arrow'), 'task-do', 'lime', `data-id="${t.id}"`), meta: 'Vence ' + date(t.due, {weekday: 'long', day: 'numeric', month: 'short'})}; }
  if (!cardsDone && qCards) return {eyebrow: 'TU SIGUIENTE PASO', title: 'Repasa tus tarjetas del día', text: qCards + ' tarjetas en la cola. Son pocos minutos y fijan los conceptos clave.', action: `<a class="button lime" href="#flashcards">Repasar tarjetas ${icon('arrow')}</a>`, meta: 'Obligatorio diario'};
  if (overdue.length) { const t = overdue[0]; return {eyebrow: 'PONTE AL DÍA', title: t.title, text: t.detail, action: button('Resolver ahora ' + icon('arrow'), 'task-do', 'lime', `data-id="${t.id}"`), meta: 'Venció el ' + date(t.due, {day: 'numeric', month: 'short'})}; }
  return {eyebrow: 'DÍA AL DÍA', title: 'Todo lo de hoy está hecho', text: 'Si te queda energía, una práctica rápida mantiene el ritmo.', action: button('Práctica rápida de 10 ' + icon('arrow'), 'quick', 'lime', 'data-n="10"'), meta: '¡Buen trabajo!'};
}
function renderDashboard() {
  const plan = buildPlan(), t = today();
  const active = plan.filter(x => x.date <= t && x.due >= t);
  const overdue = plan.filter(x => taskStatus(x) === 'overdue');
  const qCards = cardsDueCount(), cardsDone = Boolean(state.tasksDone?.['cards-' + t]);
  const total = active.length + 1, done = active.filter(x => state.tasksDone?.[x.id]).length + (cardsDone ? 1 : 0);
  const recent = state.attempts.filter(a => stampDay(a.date) >= plusDays(t, -6)), acc = accuracy(recent);
  const step = nextStep(active, overdue, qCards, cardsDone);
  const left = daysBetween(t, examDate());
  const concepts = D.concepts || [], idx = daysBetween('2026-01-01', t);
  const concept = concepts.length ? concepts[((idx % concepts.length) + concepts.length) % concepts.length] : null;
  const tip = (D.tips || []).length ? D.tips[((idx % D.tips.length) + D.tips.length) % D.tips.length] : '';
  const nextS = [...D.sessions].sort((a, b) => a.date.localeCompare(b.date)).find(s => s.date >= t);
  const nextQuiz = nextS && plan.find(x => x.session === nextS.id && x.kind !== 'review');
  const act = activity7(), maxA = Math.max(1, ...act.map(a => a.ans + a.cards)), anyAct = act.some(a => a.ans + a.cards + a.tasks);
  const ring = (v, size = 112) => { const r = 44, c = 2 * Math.PI * r; return `<svg class="day-ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${done} de ${total} actividades de hoy completadas"><circle cx="50" cy="50" r="${r}" fill="none" stroke="#ffffff22" stroke-width="9"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="#d4ee94" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 50 50)"/><text x="50" y="49" text-anchor="middle" font-size="22" font-weight="800" fill="#ffffff">${done}/${total}</text><text x="50" y="66" text-anchor="middle" font-size="9" fill="#cfe0d3">hoy</text></svg>`; };
  const kpi = (href, label, value, foot, ic, tone = '') => `<a class="kpi ${tone}" href="${href}"><span class="kpi-top">${label}<span class="stat-icon">${icon(ic)}</span></span><span class="kpi-value">${value}</span><span class="kpi-foot">${foot}</span></a>`;
  const dayLabel = d => date(d, {weekday: 'short'}).replace('.', '');
  return `<div class="dash-head"><div><div class="eyebrow">PMP MASTER PLAN 2027 · ${date(t, {weekday: 'long', day: 'numeric', month: 'long'})}</div><h1>Tu día de estudio</h1></div><button class="countdown-pill ${examConfirmed() ? 'confirmed' : ''}" data-action="settings" aria-label="Cambiar fecha del examen"><b>${Math.max(0, left)}</b><span>${left === 1 ? 'día' : 'días'} para el examen<small>${date(examDate(), {day: 'numeric', month: 'short', year: 'numeric'})} · ${examConfirmed() ? 'confirmada' : 'tentativa, por confirmar'} ✎</small></span></button></div>
  <div class="dash">
  <section class="next-step d-next"><div class="next-copy"><div class="eyebrow">${step.eyebrow}</div><h2>${esc(step.title)}</h2><p>${esc(step.text || '')}</p><div class="next-actions">${step.action}<span class="next-meta">${esc(step.meta)}</span></div></div>${ring(pct(done, total))}</section>
  <div class="kpis d-kpis">${kpi('#ruta', 'Hoy', `${done}<small>/${total}</small>`, 'actividades completadas', 'check')}${kpi('#vencidos', 'Vencidos', overdue.length, overdue.length ? 'pendientes de días anteriores' : 'nada pendiente', 'errors', overdue.length ? 'warn' : '')}${kpi('#flashcards', 'Tarjetas', cardsDone ? '✓' : qCards, cardsDone ? 'cola de hoy completada' : 'por repasar hoy', 'cards')}${kpi('#preparacion', 'Aciertos 7 días', acc === null ? '—' : acc + '<small>%</small>', recent.length ? recent.length + ' respuestas' : 'sin respuestas esta semana', 'target')}</div>
  <section class="card d-today"><div class="card-header"><div><h2>Hoy</h2><p>${active.filter(x => !state.tasksDone?.[x.id]).length + (cardsDone ? 0 : 1)} por hacer</p></div><a class="text-link" href="#ruta">Ruta ${icon('arrow')}</a></div>
   <article class="task-row ${cardsDone ? 'done' : 'today'}"><span class="check-button ${cardsDone ? 'done' : ''}" aria-hidden="true">${icon('check')}</span><div class="content"><div class="meta">${cardsDone ? badge('Hecho', 'green') : badge('Obligatorio', 'orange')}</div><h3>Tarjetas del día</h3><p class="hint">${cardsDone ? 'Cola completada.' : qCards + ' en la cola.'}</p></div>${cardsDone ? '' : `<a class="button light small" href="#flashcards">Repasar ${icon('arrow')}</a>`}</article>
   ${active.slice(0, 4).map(taskRow).join('')}${active.length > 4 ? `<a class="text-link" href="#ruta">Ver ${active.length - 4} más ${icon('arrow')}</a>` : ''}</section>
  <section class="card d-overdue ${overdue.length ? 'has' : ''}" id="vencidos"><div class="card-header"><div><h2>Vencidos <span class="count-badge">${overdue.length}</span></h2><p>${overdue.length ? 'Los más antiguos primero' : 'Estás al día'}</p></div>${overdue.length ? button('Ya los hice', 'overdue-all', 'ghost small') : ''}</div>${overdue.length ? overdue.slice(0, 3).map(taskRow).join('') + (overdue.length > 3 ? `<details class="see-all"><summary>Ver todos (${overdue.length - 3} más)</summary>${overdue.slice(3).map(taskRow).join('')}</details>` : '') : `<p class="hint">No tienes actividades vencidas. ${icon('check')}</p>`}</section>
  <section class="card d-session">${nextS ? `<div class="eyebrow">PRÓXIMA SESIÓN INGENIUM</div><div class="session-when"><div class="date-box"><b>${Number(nextS.date.slice(8))}</b><span>${date(nextS.date, {month: 'short'})}</span></div><div><h3>${esc(nextS.title)}</h3><p class="hint">${date(nextS.date, {weekday: 'long'})} · ${nextS.time} · Sesión ${nextS.id}</p></div></div><p class="hint" style="margin:10px 0">${esc(nextS.ppt)}${nextS.mapping !== 'confirmada' ? ' · por confirmar' : ''}</p><div class="chips">${nextS.topics.map(id => `<span class="badge">${topicLabel(id)}</span>`).join('')}</div>${nextQuiz ? `<p class="hint" style="margin-top:8px">Cuestionario asociado: disponible desde la sesión, vence ${date(nextQuiz.due, {weekday: 'short', day: 'numeric', month: 'short'})}</p>` : ''}<div class="actions">${nextS.topics.length ? button('Prepararme con 5 preguntas', 'start-topic-set', 'light small', `data-id="${nextS.topics.join(',')}"`) : ''}<a class="button ghost small" href="#agenda">Agenda ${icon('arrow')}</a></div>` : `<div class="eyebrow">INGENIUM</div><p class="hint">Ya no hay sesiones programadas. Concéntrate en simulacros y repaso.</p>`}</section>
  <section class="card d-activity"><div class="card-header"><div><h2>Actividad de los últimos 7 días</h2><p>Respuestas y tarjetas registradas en la app</p></div></div>${anyAct ? `<div class="bars" role="img" aria-label="Actividad de los últimos 7 días; detalle en la tabla">${act.map(a => `<div class="bar-col"><div class="bar-stack" style="height:${Math.round((a.ans + a.cards) / maxA * 100)}%"><span class="b-ans" style="flex:${a.ans}"></span><span class="b-cards" style="flex:${a.cards}"></span></div><span class="bar-num">${a.ans + a.cards || ''}</span><span class="bar-day ${a.d === t ? 'is-today' : ''}">${dayLabel(a.d)}</span></div>`).join('')}</div><div class="chart-legend"><span><i class="lg b-ans"></i>Respuestas</span><span><i class="lg b-cards"></i>Tarjetas</span></div><details class="chart-data"><summary>Ver los datos en una tabla</summary><div class="table-wrap"><table><thead><tr><th scope="col">Día</th><th scope="col">Respuestas</th><th scope="col">Tarjetas</th><th scope="col">Actividades hechas</th></tr></thead><tbody>${act.map(a => `<tr><th scope="row">${date(a.d, {weekday: 'short', day: 'numeric', month: 'short'})}</th><td>${a.ans}</td><td>${a.cards}</td><td>${a.tasks}</td></tr>`).join('')}</tbody></table></div></details>` : `<div class="empty" style="padding:24px">${icon('chart')}<h3>Aún sin actividad esta semana</h3><p>Cuando respondas preguntas o repases tarjetas, verás aquí tu ritmo diario.</p></div>`}</section>
  ${concept ? `<section class="card d-concept concept-day"><div class="eyebrow">CONCEPTO DEL DÍA</div><h2>${esc(concept.title)}</h2><p class="concept-def">${kw(concept.definition)}</p><a class="text-link" href="#conceptos/${concept.id}">Ficha con ejemplo de construcción ${icon('arrow')}</a></section>` : ''}
  ${tip ? `<section class="card d-tip tip-card"><div class="eyebrow">TIP DEL DÍA</div><p class="tip-text">${esc(tip)}</p></section>` : ''}
  <section class="d-quick"><button class="quick-tile" data-action="quick" data-n="10">${icon('practice')}<b>Rápida de 10</b><span>al azar, todos los temas</span></button><button class="quick-tile" data-action="quick" data-n="20">${icon('practice')}<b>Rápida de 20</b><span>ritmo de examen</span></button><a class="quick-tile" href="#flashcards">${icon('cards')}<b>Flashcards</b><span>${cardsDone ? 'hechas hoy' : qCards + ' pendientes'}</span></a><a class="quick-tile" href="#simulacros">${icon('mock')}<b>A medida</b><span>elige temas y enfoques</span></a></section>
  </div>`;
}

function renderPlan() {
  const plan = buildPlan(), ss = [...D.sessions].sort((a, b) => a.date.localeCompare(b.date));
  const final = plan.filter(t => !t.session);
  const done = plan.filter(t => state.tasksDone?.[t.id]).length;
  return heading('RUTA DE APRENDIZAJE', 'Sesión por sesión hasta el examen', `Cada cuestionario vence el día anterior a la siguiente sesión. Examen: ${date(examDate())} ${examConfirmed() ? '(confirmado)' : '(tentativo)'}.`, button('Cambiar fecha del examen', 'settings', 'white')) +
  `<section class="card freq"><div class="freq-grid"><div><b>1 · 3 · 7 · 14</b><span>días después de cada sesión: repasos cortos de sus temas</span></div><div><b>L · M · V</b><span>práctica mixta de 20 preguntas desde el 7 de enero</span></div><div><b>Domingos</b><span>revisión semanal de errores desde el 7 de enero</span></div><div><b>−14 y −7</b><span>días antes del examen: simulacros completos y su revisión</span></div><div><b>Diario</b><span>tarjetas de repaso espaciado (obligatorio)</span></div></div><p class="hint" style="margin-top:12px">${done} de ${plan.length} actividades hechas. Si cambias la fecha del examen, los repasos y simulacros futuros se recalculan; lo completado se conserva.</p></section>` +
  `<div class="stack" style="margin-top:20px">${ss.map(s => {
    const own = plan.filter(t => t.session === s.id), quiz = own.find(t => t.kind !== 'review'), reviews = own.filter(t => t.kind === 'review');
    const n = s.topics.length ? questionsFor(s.topics).length : 0;
    return `<article class="session-card ${s.date <= today() ? 'past' : ''}"><div class="date-box"><b>${Number(s.date.slice(8))}</b><span>${date(s.date, {month: 'short'})}</span></div><div class="content"><div class="meta">${badge('INGENIUM · SESIÓN ' + s.id, 'ingenium')} ${s.mapping === 'confirmada' ? badge('Material confirmado', 'green') : badge('Correspondencia por confirmar', 'orange')}</div><h3>${esc(s.title)}</h3><p class="hint"><strong>PPT:</strong> ${esc(s.ppt)} · <strong>Curso v4.1:</strong> lección ${s.lesson41.join(' y ')}</p><div class="chips">${s.topics.map(id => `<a class="badge" href="#modulos/${id.split('-')[0]}">${topicLabel(id)} · ${esc(topicBy(id)?.title || '')}</a>`).join('')}</div>${quiz ? `<div class="task-inline">${statusBadge(taskStatus(quiz))} <span><strong>${esc(quiz.title)}</strong>${n ? ` · ${Math.min(10, n)} preguntas` : ''} · vence ${date(quiz.due, {weekday: 'short', day: 'numeric', month: 'short'})}</span>${taskStatus(quiz) !== 'done' ? taskAction(quiz) : ''}</div>` : ''}${reviews.length ? `<div class="review-chips">${reviews.map(r => `<button class="review-chip ${taskStatus(r)}" data-action="${taskStatus(r) === 'done' ? 'task-toggle' : 'task-do'}" data-id="${r.id}" title="${esc(r.title)}">${r.id.split('-d')[1] === undefined ? '' : '+' + r.id.split('-d')[1] + 'd'} · ${date(r.date, {day: 'numeric', month: 'short'})}${taskStatus(r) === 'done' ? ' ✓' : ''}</button>`).join('')}</div>` : ''}</div></article>`;
  }).join('')}</div>
  <section class="card" style="margin-top:20px"><div class="card-header"><div><h2>Tramo final hasta el examen</h2><p>Práctica mixta, errores, simulacros y cierre ligero</p></div></div>${final.map(taskRow).join('')}</section>
  <details class="card" style="margin-top:20px"><summary><strong>Metodología, etapas y lecciones del curso v4.1</strong></summary><div style="margin-top:18px">${renderRoadmap()}</div></details>`;
}

function renderConcepts() {
  const [, arg] = (location.hash.slice(1) || '').split('/');
  const list = (D.concepts || []).filter(c => (conceptFilter === 'all' || c.topicId.startsWith(conceptFilter)) && (plain(c.title + ' ' + c.definition + ' ' + c.example).toLocaleLowerCase('es').includes(conceptSearch.toLocaleLowerCase('es'))));
  return heading('CONCEPTOS CLAVE', 'Lo que el examen da por sabido', 'Definición breve, palabras clave resaltadas y un ejemplo aplicado a construcción.', `<a class="button light" href="#flashcards">${icon('cards')} Repasar tarjetas</a>`) +
  `<div class="toolbar"><div class="filter-group">${[['all', 'Todos'], ['people', 'People'], ['process', 'Process'], ['business', 'Business'], ['agile', 'Ágil']].map(([id, n]) => `<button data-action="concept-filter" data-id="${id}" class="${conceptFilter === id ? 'active' : ''}">${n}</button>`).join('')}</div><input type="search" id="concept-search" placeholder="Buscar concepto…" aria-label="Buscar concepto" value="${esc(conceptSearch)}"><span class="hint">${list.length} conceptos</span></div>
  <div class="concept-list">${list.map(c => `<article class="concept ${arg === c.id ? 'focus' : ''}" id="concept-${c.id}"><div class="meta">${badge(topicLabel(c.topicId), 'blue')} ${badge(esc(topicBy(c.topicId)?.title || ''))}</div><h2>${esc(c.title)}</h2><p class="concept-def">${kw(c.definition)}</p><div class="concept-example"><span class="eyebrow">APLICADO A CONSTRUCCIÓN</span><p>${esc(c.example)}</p></div><div class="actions">${button('Practicar el tema ' + icon('arrow'), 'start-topic', 'light small', `data-id="${c.topicId}"`)}<span class="hint">${c.cards.length} ${c.cards.length === 1 ? 'tarjeta' : 'tarjetas'}</span></div></article>`).join('') || empty('Sin resultados', 'Prueba otro filtro o término.')}</div>`;
}

function renderFlashcards() {
  ensureStudyState();
  if (!cardQueue) cardQueue = buildQueue();
  cardQueue = cardQueue.filter(id => allCards().some(c => c.id === id));
  const total = allCards().length, learned = Object.keys(state.cards).length, reviewedToday = state.cardLog.filter(l => l.date === today()).length;
  const head = heading('FLASHCARDS · OBLIGATORIO DIARIO', 'Repaso espaciado', 'Intenta responder antes de ver la respuesta. Tu calificación decide cuándo vuelve la tarjeta.', `<a class="button white" href="#conceptos">${icon('book')} Conceptos</a>`) +
    `<div class="stats" style="grid-template-columns:repeat(3,1fr)">${stat('En la cola', cardQueue.length, 'vencidas y nuevas de hoy', 'cards')}${stat('Revisadas hoy', reviewedToday, 'incluye repeticiones', 'check')}${stat('Aprendidas', `${learned} <small>/ ${total}</small>`, NEW_CARDS_PER_DAY + ' nuevas por día como máximo', 'book')}</div>`;
  if (!cardQueue.length) {
    const next = Object.values(state.cards).map(c => c.due).filter(d => d > today()).sort()[0];
    return head + `<section class="card flash-done">${icon('check')}<h2>Cola de hoy completada</h2><p class="hint">${next ? 'La próxima tarjeta vuelve el ' + date(next, {weekday: 'long', day: 'numeric', month: 'long'}) + '.' : 'Vuelve mañana para nuevas tarjetas.'}</p>${button('Repasar otra vez las de hoy', 'cards-extra', 'light')}</section>`;
  }
  const card = allCards().find(c => c.id === cardQueue[0]), prev = cardState(card.id);
  const opts = [['again', 'Otra vez', 'danger'], ['hard', 'Difícil', 'white'], ['good', 'Bien', ''], ['easy', 'Fácil', 'lime']];
  return head + `<section class="card flashcard"><div class="meta">${badge(topicLabel(card.topicId), 'blue')} ${badge(esc(card.concept))} ${prev ? badge('Repaso') : badge('Nueva', 'green')}</div><h2 class="flash-front">${esc(card.front)}</h2>${cardRevealed ? `<div class="flash-back">${esc(card.back)}</div><a class="text-link" href="#conceptos/${card.conceptId}">Ver ficha del concepto ${icon('arrow')}</a><div class="grade-row">${opts.map(([g, n, k]) => `<button class="button ${k}" data-action="card-grade" data-id="${g}">${n}<small>${intervalText(schedule(prev, g).interval)}</small></button>`).join('')}</div>` : `<div class="actions" style="justify-content:center;margin-top:26px">${button('Mostrar respuesta', 'card-reveal', '')}</div><p class="hint" style="text-align:center;margin-top:10px">Atajos: Espacio para mostrar · 1 a 4 para calificar</p>`}</section>`;
}

/* ---------- agenda ---------- */
function planEvents() { return buildPlan().filter(t => t.kind !== 'review').map(t => ({...t, source: 'task', key: 't-' + t.id, date: t.due})); }
function gcalLink(title, day, start, end, details) {
  const z = t => new Date(day + 'T' + t + ':00-05:00').toISOString().replace(/[-:]/g, '').replace('.000', '');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + z(start) + '/' + z(end) + '&details=' + encodeURIComponent(details) + '&ctz=America/Lima';
}
function eventTimes(e) { const r = state.settings.reminderTime || '07:30'; return e.source === 'ingenium' ? ['20:00', '22:00'] : e.source === 'practice' ? [e.start, e.end] : [r, plusMinutes(r, 30)]; }
function plusMinutes(t, m) { const [h, mm] = t.split(':').map(Number), x = h * 60 + mm + m; return String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
function eventTitle(e) { return e.source === 'ingenium' ? `INGENIUM · Sesión ${e.id} · ${e.title}` : e.source === 'practice' ? 'Práctica propia · ' + e.title : 'PMP · ' + e.title; }
function renderAgenda() {
  const [year, month] = calendarMonth.split('-').map(Number), first = (new Date(year, month - 1, 1).getDay() + 6) % 7, days = new Date(year, month, 0).getDate();
  const all = [...sessions(), ...planEvents()].filter(s => agendaSource === 'all' || s.source === agendaSource);
  const visible = all.filter(s => s.date.startsWith(calendarMonth) && (!calendarDay || s.date === calendarDay)).sort((a, b) => a.date.localeCompare(b.date));
  return heading('AGENDA', 'Sesiones, práctica y vencimientos', 'INGENIUM, tus sesiones propias y las fechas límite de la ruta, en hora de Lima.', button(icon('plus') + ' Planificar práctica', 'new-session')) +
  `<div class="toolbar"><div class="filter-group">${[['all', 'Todo'], ['ingenium', 'INGENIUM'], ['practice', 'Propias'], ['task', 'Vencimientos']].map(([id, n]) => `<button data-action="agenda-source" data-id="${id}" class="${agendaSource === id ? 'active' : ''}">${n}</button>`).join('')}</div><span class="spacer"></span>${button(icon('download') + ' Exportar agenda (.ics)', 'export-agenda', 'white')}</div>
  <div class="agenda-layout"><section class="card"><div class="month-title"><button class="icon-button" data-action="month" data-dir="-1" aria-label="Mes anterior">‹</button><h2>${date(calendarMonth + '-01', {month: 'long', year: 'numeric'})}</h2><button class="icon-button" data-action="month" data-dir="1" aria-label="Mes siguiente">›</button></div><div class="calendar-grid">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(n => `<span class="day-label">${n}</span>`).join('')}${'<span></span>'.repeat(first)}${Array.from({length: days}, (_, i) => { const d = calendarMonth + '-' + String(i + 1).padStart(2, '0'), ev = all.filter(s => s.date === d); return `<button class="calendar-day ${ev.length ? 'has-event' : ''} ${d === calendarDay ? 'selected' : ''} ${d === today() ? 'today' : ''} ${d === examDate() ? 'exam-day' : ''}" data-action="calendar-day" data-id="${d}" aria-label="${date(d)}: ${ev.length} eventos" aria-pressed="${d === calendarDay}">${i + 1}<span class="day-dots">${[...new Set(ev.map(s => s.source))].map(x => `<i class="${x}"></i>`).join('')}</span></button>`; }).join('')}</div><div class="calendar-legend"><span>INGENIUM</span><span>Práctica propia</span><span>Vencimiento</span></div>
  <div class="notice"><strong>Calendario de Google o Apple:</strong> «Google» abre el evento ya prellenado y debes pulsar <em>Guardar</em> en Google Calendar. «.ics» descarga un archivo que Apple Calendar (o Google, desde Importar) agrega como <em>copia</em>: si luego cambias algo en la app, vuelve a exportar. «Exportar agenda» incluye las sesiones, los vencimientos y un recordatorio diario de tarjetas a las ${esc(state.settings.reminderTime || '07:30')} (lo cambias en Ajustes). La sincronización automática en ambos sentidos sería una fase aparte que requiere autorizar tu cuenta de Google o Apple.</div></section>
  <section class="card"><div class="card-header"><div><h2>${calendarDay ? date(calendarDay) : 'Agenda del mes'}</h2><p>${visible.length} eventos</p></div>${calendarDay ? button('Ver mes', 'clear-day', 'ghost') : ''}</div>${visible.length ? visible.map(s => { const [a, b] = eventTimes(s), st = s.source === 'task' ? taskStatus(s) : null; return `<article class="agenda-session"><div class="date-box"><b>${Number(s.date.slice(8))}</b><span>${date(s.date, {month: 'short'})}</span></div><div class="content">${s.source === 'ingenium' ? badge('INGENIUM · SESIÓN ' + s.id, 'ingenium') : s.source === 'practice' ? badge('PRÁCTICA PROPIA', 'practice') : statusBadge(st) + ' ' + badge('VENCIMIENTO')}${s.plus ? ' ' + badge('Certified Plus', 'orange') : ''}<h3>${esc(s.title)}</h3><p class="time">${s.source === 'task' ? 'Fecha límite' : esc(a + '–' + b)} · ${date(s.date, {weekday: 'long'})}</p><div class="actions" style="margin-top:7px"><a class="button ghost" href="${gcalLink(eventTitle(s), s.date, a, b, s.detail || 'PMP Master Plan 2027')}" target="_blank" rel="noopener">Google ↗</a>${button('.ics', 'event-ics', 'ghost', `data-id="${s.key}"`)}${s.source === 'practice' ? button('Editar', 'edit-session', 'ghost', `data-id="${s.id}"`) : ''}${s.source !== 'task' ? button('Apunte', 'session-note', 'ghost', `data-id="${s.key}"`) : ''}${s.source === 'task' && st !== 'done' ? taskAction(s) : ''}</div></div>${s.source !== 'task' ? `<button class="check-button ${state.attendance[s.source === 'ingenium' ? s.id : s.key] ? 'done' : ''}" data-action="attendance" data-id="${s.source === 'ingenium' ? s.id : s.key}" aria-label="Marcar realizada" aria-pressed="${!!state.attendance[s.source === 'ingenium' ? s.id : s.key]}">${icon('check')}</button>` : `<button class="check-button ${st === 'done' ? 'done' : ''}" data-action="task-toggle" data-id="${s.id}" aria-label="Marcar hecho" aria-pressed="${st === 'done'}">${icon('check')}</button>`}</article>`; }).join('') : empty('Sin eventos', 'No hay eventos con este filtro.', 'new-session', 'Planificar práctica')}</section></div>`;
}
function icsFor(events, withDaily) {
  const esc2 = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const z = (d, t) => new Date(d + 'T' + t + ':00-05:00').toISOString().replace(/[-:]/g, '').replace('.000', '');
  const now = new Date().toISOString().replace(/[-:]/g, '').replace('.000', '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PMP Master Plan 2027//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:PMP Master Plan 2027', 'X-WR-TIMEZONE:America/Lima'];
  for (const e of events) { const [a, b] = eventTimes(e); L.push('BEGIN:VEVENT', 'UID:' + e.key + '@pmp-master-plan-2027', 'DTSTAMP:' + now, 'DTSTART:' + z(e.date, a), 'DTEND:' + z(e.date, b), 'SUMMARY:' + esc2(eventTitle(e)), 'DESCRIPTION:' + esc2((e.detail || '') + ' · Hora de Lima.'), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc2(eventTitle(e)), 'TRIGGER:' + (e.source === 'task' ? 'PT0M' : '-PT30M'), 'END:VALARM', 'END:VEVENT'); }
  if (withDaily) { const r = state.settings.reminderTime || '07:30'; const until = z(plusDays(examDate(), -1), '23:59'); L.push('BEGIN:VEVENT', 'UID:flashcards-diarias@pmp-master-plan-2027', 'DTSTAMP:' + now, 'DTSTART:' + z(today(), r), 'DTEND:' + z(today(), plusMinutes(r, 15)), 'RRULE:FREQ=DAILY;UNTIL=' + until, 'SUMMARY:PMP · Repaso diario de tarjetas', 'DESCRIPTION:' + esc2('Abre https://fssgdev.github.io/pmp-prep-app/#flashcards y completa la cola del día.'), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Repaso diario de tarjetas', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'); }
  L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
}

/* ---------- simulacros ---------- */
function defaultSimFilter() { return {modules: D.modules.map(m => m.id), topics: D.modules.flatMap(m => m.topics.map(t => t.id)), approaches: ['Predictivo', 'Ágil', 'Híbrido'], count: '10'}; }
function simMatches() { const f = simFilter; return allQuestions().filter(q => f.modules.includes(q.module) && (!q.topicId || f.topics.includes(q.topicId)) && f.approaches.includes(q.approach)); }
function mockAvailability() {
  const graded = MOCK_FORMAT.total - MOCK_FORMAT.unscored, qs = D.questions; // solo el banco publicado, sin preguntas propias
  const rows = Object.entries(MOCK_FORMAT.weights).map(([id, w]) => { const need = Math.round(graded * w), have = qs.filter(q => q.module === id).length; return {id, name: moduleBy(id).name, w, need, have, missing: Math.max(0, need - have)}; });
  const fix = graded - rows.reduce((s, r) => s + r.need, 0); rows[1].need += fix; rows[1].missing = Math.max(0, rows[1].need - rows[1].have);
  const extra = qs.length - rows.reduce((s, r) => s + Math.min(r.have, r.need), 0);
  return {rows, unique: qs.length, missingTotal: rows.reduce((s, r) => s + r.missing, 0) + Math.max(0, MOCK_FORMAT.unscored - Math.max(0, extra)), ready: rows.every(r => r.missing === 0) && extra >= MOCK_FORMAT.unscored && qs.length >= MOCK_FORMAT.total};
}
function renderSimulacros() {
  if (!simFilter) simFilter = defaultSimFilter();
  const run = typeof mockRun === 'function' ? mockRun() : null;
  if (run && run.phase !== 'done') return renderMockRun();
  const tabs = [['practica', 'Práctica a medida'], ['completo', 'Simulacro PMP completo'], ['externos', 'Simulacros externos']];
  let body = '';
  if (simTab === 'practica') {
    const n = simMatches().length, want = simFilter.count === 'all' ? n : Number(simFilter.count);
    body = `<section class="card"><form id="sim-practice"><div class="sim-grid"><fieldset><legend>Módulos</legend>${D.modules.map(m => `<label class="checkline"><input type="checkbox" data-sim="modules" value="${m.id}" ${simFilter.modules.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')}</fieldset><fieldset><legend>Enfoques</legend>${['Predictivo', 'Ágil', 'Híbrido'].map(a => `<label class="checkline"><input type="checkbox" data-sim="approaches" value="${a}" ${simFilter.approaches.includes(a) ? 'checked' : ''}> ${a}</label>`).join('')}</fieldset><fieldset><legend>Cantidad</legend>${[['10', '10 preguntas'], ['20', '20 preguntas'], ['all', 'Todas las que cumplan']].map(([v, l]) => `<label class="checkline"><input type="radio" name="sim-count" data-sim="count" value="${v}" ${simFilter.count === v ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset></div>
    <details class="sim-topics"><summary>Temas (${simFilter.topics.length} seleccionados) · ${button('Todos', 'sim-topics-all', 'ghost small')} ${button('Ninguno', 'sim-topics-none', 'ghost small')}</summary><div class="sim-topic-grid">${D.modules.map(m => `<fieldset><legend>${esc(m.name)}</legend>${m.topics.map(t => `<label class="checkline"><input type="checkbox" data-sim="topics" value="${t.id}" ${simFilter.topics.includes(t.id) ? 'checked' : ''}> ${esc(t.code)} · ${esc(t.title)} <small>(${allQuestions().filter(q => q.topicId === t.id).length})</small></label>`).join('')}</fieldset>`).join('')}</div></details>
    <div class="sim-foot"><p class="${n < want || !n ? 'form-error' : 'hint'}" style="margin:0"><strong>${n}</strong> preguntas cumplen los filtros${n < want ? ` · faltan ${want - n} para ${want}: amplía módulos, temas o enfoques, o se usarán las ${n} disponibles` : ''}.</p><button class="button" type="submit" ${n ? '' : 'disabled'}>Comenzar práctica ${icon('arrow')}</button></div></form><p class="hint" style="margin-top:12px">Sin repeticiones dentro del intento. Las preguntas de un mismo escenario se presentan juntas. Al final ves tu resultado y cada respuesta tiene explicación.</p></section>`;
  } else if (simTab === 'completo' && run) {
    body = renderMockDone(run, true);
  } else if (simTab === 'completo') {
    const a = mockAvailability();
    body = `<div class="grid-2"><section class="card"><div class="eyebrow">FORMATO DEL EXAMEN</div><h2>Simulacro PMP completo</h2><div class="help-copy"><p><strong>${MOCK_FORMAT.total} preguntas únicas</strong> en <strong>${MOCK_FORMAT.minutes} minutos</strong>, con <strong>dos pausas de ${MOCK_FORMAT.breakMinutes} minutos</strong>. Al empezar cada pausa se cierra el bloque anterior y ya no podrás volver a él. La revisión y el desglose por dominio se muestran al final.</p><p>${MOCK_FORMAT.unscored} preguntas no puntúan; las ${MOCK_FORMAT.total - MOCK_FORMAT.unscored} calificadas siguen la distribución oficial: Personas 33 %, Procesos 41 % y Entorno de negocio 26 %. Incluirá escenarios, emparejamiento y gráficos.</p><p>Desde el 31 de agosto de 2026, el primer descanso llega después de la sección de estudio de caso. En la app, las preguntas de escenario se presentan al inicio del bloque 1.</p><p><a href="https://www.pmi.org/certifications/project-management-pmp" target="_blank" rel="noopener">Referencia oficial PMI ↗</a></p></div>${a.ready ? button('Comenzar simulacro completo', 'mock-full', '') : `<button class="button" disabled>Aún no disponible</button><p class="hint" style="margin-top:10px">No se rellena con repeticiones ni se presenta una versión parcial como simulacro completo. Mientras tanto, usa la práctica a medida o un simulacro externo.</p>`}</section>
    <section class="card"><div class="card-header"><div><h2>Disponibilidad del banco</h2><p>${a.unique} preguntas únicas de ${MOCK_FORMAT.total} · faltan ${Math.max(a.missingTotal, MOCK_FORMAT.total - a.unique)}</p></div>${badge(a.ready ? 'Listo' : 'En construcción', a.ready ? 'green' : 'orange')}</div>${a.rows.map(r => `<div class="metric-line"><span>${esc(r.name)}<br><small>${Math.round(r.w * 100)} % · necesita ${r.need}</small></span>${progress(pct(Math.min(r.have, r.need), r.need))}<strong>${Math.min(r.have, r.need)}/${r.need}</strong></div>`).join('')}<p class="hint">Las calificadas salen de People, Process y Business Environment. Las ${MOCK_FORMAT.unscored} no puntuadas se toman del resto del banco (incluidas las ${D.questions.filter(q => q.module === 'agile').length} de AGILE/HYBRID). Cada intento sortea preguntas sin repetir ninguna.</p></section></div>`;
  } else body = renderMocks();
  return heading('SIMULACROS', 'Practica como en el examen', 'Prácticas a medida de 10 o 20 preguntas y el simulacro completo de 180.') +
    `<div class="toolbar"><div class="filter-group">${tabs.map(([id, n]) => `<button data-action="sim-tab" data-id="${id}" class="${simTab === id ? 'active' : ''}">${n}</button>`).join('')}</div></div>${body}`;
}

/* ---------- acciones y eventos ---------- */
const STUDY_ACTIONS = {
  'task-do': el => doTask(el.dataset.id),
  'task-toggle': el => { const id = el.dataset.id, done = !state.tasksDone?.[id]; markTask(id, done); closeDialog(); render(); toast(done ? 'Actividad marcada como hecha.' : 'Actividad marcada como pendiente.'); },
  'overdue-all': () => dialog('Marcar vencidos como hechos', `<p class="hint">Se marcarán como hechas las ${buildPlan().filter(t => taskStatus(t) === 'overdue').length} actividades vencidas (por ejemplo, las de sesiones a las que ya asististe). Podrás desmarcar cualquiera desde la Ruta.</p><div class="actions">${button('Marcar como hechas', 'overdue-confirm', '')}${button('Cancelar', 'close-dialog', 'white')}</div>`),
  'overdue-confirm': () => { ensureStudyState(); buildPlan().filter(t => taskStatus(t) === 'overdue').forEach(t => { state.tasksDone[t.id] = stamp(); }); save(); closeDialog(); render(); toast('Vencidos marcados como hechos.'); },
  'start-topic-set': el => { const ids = el.dataset.id.split(','); startQuiz(questionsFor(ids), 5, 'Preparación para la próxima sesión'); },
  'quick': el => startQuiz(allQuestions(), el.dataset.n, `Práctica rápida de ${el.dataset.n}`),
  'concept-filter': el => { conceptFilter = el.dataset.id; render(); },
  'card-reveal': () => { cardRevealed = true; render(); },
  'card-grade': el => gradeCard(el.dataset.id),
  'cards-extra': () => { cardQueue = [...new Set(state.cardLog.filter(l => l.date === today()).map(l => l.id))]; cardRevealed = false; render(); },
  'sim-tab': el => { simTab = el.dataset.id; render(); },
  'sim-topics-all': () => { simFilter.topics = D.modules.flatMap(m => m.topics.map(t => t.id)); render(); },
  'sim-topics-none': () => { simFilter.topics = []; render(); },
  'agenda-source': el => { agendaSource = el.dataset.id; calendarDay = ''; render(); },
  'export-agenda': () => { download('PMP-Master-Plan-2027-agenda.ics', icsFor([...sessions(), ...planEvents()], true), 'text/calendar;charset=utf-8'); toast('Agenda exportada. Ábrela con Apple Calendar o impórtala en Google Calendar.'); },
  'event-ics': el => { const e = [...sessions(), ...planEvents()].find(x => x.key === el.dataset.id); if (e) download('PMP-' + e.date + '.ics', icsFor([e], false), 'text/calendar;charset=utf-8'); },
  'mock-full': () => toast('El simulacro completo se habilitará cuando el banco tenga cobertura suficiente.')
};
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.sim) {
    const k = el.dataset.sim;
    if (k === 'count') simFilter.count = el.value;
    else { const set = new Set(simFilter[k]); el.checked ? set.add(el.value) : set.delete(el.value); simFilter[k] = [...set]; }
    const open = document.querySelector('.sim-topics')?.open; render(); if (open) document.querySelector('.sim-topics').open = true;
  }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'concept-search') { const pos = ev.target.selectionStart; conceptSearch = ev.target.value; render(); const s = document.getElementById('concept-search'); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener('submit', ev => {
  if (ev.target.id !== 'sim-practice') return;
  ev.preventDefault();
  const qs = simMatches(); if (!qs.length) return;
  startQuiz(qs, simFilter.count, 'Práctica a medida');
});
document.addEventListener('keydown', ev => {
  if (!location.hash.startsWith('#flashcards') || ev.target.closest('input,textarea,select') || document.querySelector('dialog[open]')) return;
  if (ev.key === ' ' && !cardRevealed && cardQueue?.length) { ev.preventDefault(); cardRevealed = true; render(); }
  else if (cardRevealed && ['1', '2', '3', '4'].includes(ev.key)) gradeCard(['again', 'hard', 'good', 'easy'][Number(ev.key) - 1]);
});
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#flashcards')) { cardQueue = null; cardRevealed = false; } });
