// Integridad histórica del banco (issue #7): un ID publicado conserva su contenido. Las preguntas que cambiaron tienen un
// ID nuevo y la versión original sigue en data/questions-retired.json. Prueba con un estado sintético (nunca datos reales):
// intentos y fallos de antes y después del cambio, un quiz y un simulacro en curso durante la actualización y una sincronización.
// Uso: python3 -m http.server 8765 &  node tests/historial.test.js
const {chromium} = require('playwright');
const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
const root = path.join(__dirname, '..');
const retired = JSON.parse(fs.readFileSync(path.join(root, 'data/questions-retired.json'))).questions;
const old = id => retired.find(q => q.id === id);
const uidAt = iso => 'id-' + Date.parse(iso).toString(36) + 'abcdef';

(async () => {
  execSync('node tools/question-ids.mjs --check', {cwd: root, stdio: 'pipe'});
  assert(true, 'ningún ID publicado cambió de contenido (tools/question-ids.mjs --check)');
  const cnf = old('x7-cnf-004'), int3 = old('x7-int-003');
  const base = {version: 1, topics: {}, attendance: {}, notes: [], mocks: [], questions: [], studySessions: [], settings: {examDate: '', examConfirmed: false, reminderTime: '07:30', dailyMinutes: 45}, tasksDone: {}, cards: {}, cardLog: []};
  const err = (id, questionId, date) => ({id, questionId, prompt: 'registro sintético', category: 'Conceptual', date, due: '2026-11-26', resolved: false, module: 'people', topicId: 'people-2', lesson: '', action: ''});
  const synthetic = {...base,
    attempts: [
      {id: 'a1', questionId: 'x7-cnf-004', topicId: 'people-2', module: 'people', approach: 'Ágil', selected: [1], correct: true, date: '2026-11-23T09:20:00-05:00'},
      {id: 'a2', questionId: 'x7-cnf-004', topicId: 'people-2', module: 'people', approach: 'Ágil', selected: [0], correct: true, date: '2026-11-24T10:00:00-05:00'},
      {id: 'a3', questionId: 'process-l3-005', topicId: 'process-3', module: 'process', approach: 'Predictivo', selected: [1], correct: true, date: '2026-11-20T08:00:00-05:00'}
    ],
    errors: [err(uidAt('2026-11-23T09:25:00-05:00'), 'x7-cnf-004', '2026-11-23'), err(uidAt('2026-11-24T08:00:00-05:00'), 'x7-iss-001', '2026-11-24'), err('manual-1', 'x7-int-003', '2026-11-22')],
    results: [{id: 'r1', kind: 'bullet', label: 'Bullet', total: 5, correct: 4, wrong: ['x7-iss-001'], at: '2026-11-24T12:00:00-05:00', date: '2026-11-24'}],
    quiz: {ids: ['x7-cnf-004', 'q01'], index: 0, selected: [], answers: [], started: '2026-11-23T09:30:00-05:00', finished: false, showResult: false, label: 'Práctica empezada antes del cambio'},
    mockRun: {ids: ['x7-int-003', 'q01'], unscored: ['q01'], answers: {'x7-int-003': [1]}, flags: {'x7-int-003': true}, index: 0, block: 0, phase: 'exam', started: '2026-11-23T09:35:00-05:00', usedMs: 60000, segStart: '2026-11-23T09:35:00-05:00', breaks: []},
    routine: {days: {}, seen: ['x7-cnf-004', 'q01']}
  };
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  const ctx = await browser.newContext({viewport: {width: 1366, height: 900}}); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); await page.route(/supabase-js|fonts\.g/, r => r.abort());
  await page.clock.install({time: new Date('2026-11-25T09:00:00-05:00')});
  await page.addInitScript(s => { if (!sessionStorage.getItem('sembrado')) { localStorage.setItem('pmp-master-plan-2027-v1', s); sessionStorage.setItem('sembrado', '1'); } }, JSON.stringify(synthetic));
  await page.goto(URL + '#inicio'); await page.waitForFunction(() => typeof renderHistory === 'function' && typeof state === 'object');
  const s1 = await page.evaluate(() => ({att: state.attempts.map(a => a.questionId), err: state.errors.map(e => e.questionId), res: state.results[0].wrong, quiz: state.quiz.ids, mock: [state.mockRun.ids[0], Object.keys(state.mockRun.answers)[0], Object.keys(state.mockRun.flags)[0]], seen: state.routine.seen}));
  assert(JSON.stringify(s1.att) === JSON.stringify(['x7-cnf-004', 'x7-cnf-004-v2', 'process-l3-005-v2']), 'intentos: el anterior al cambio sigue en la versión original; los posteriores pasan al ID nuevo');
  assert(JSON.stringify(s1.err) === JSON.stringify(['x7-cnf-004', 'x7-iss-001-v2', 'x7-int-003']), 'fallos: cada uno queda con la versión que realmente viste (por la fecha de su ID o de su día)');
  assert(s1.res[0] === 'x7-iss-001-v2' && s1.quiz[0] === 'x7-cnf-004' && s1.mock.every(x => x === 'x7-int-003'), 'historial, quiz y simulacro en curso empezados antes del cambio conservan sus IDs');
  assert(s1.seen.includes('x7-cnf-004-v2') && !s1.seen.includes('x7-cnf-004'), 'las preguntas ya vistas en la rutina cuentan para la versión vigente');
  // Quiz en curso: muestra y califica la versión original
  const q1 = await page.evaluate(() => ({p: quizQuestion().prompt, retired: !!quizQuestion().retired}));
  assert(q1.p === cnf.prompt && q1.retired, 'el quiz empezado antes del cambio muestra la pregunta original');
  const graded = await page.evaluate(c => { state.quiz.selected = [...c]; checkAnswer(); return [state.quiz.answers[0].correct, state.attempts.at(-1).questionId]; }, cnf.correct);
  assert(graded[0] === true && graded[1] === 'x7-cnf-004', 'se califica con la respuesta correcta de la versión original');
  // Simulacro en curso y registro de errores
  assert(await page.evaluate(p => mockQ('x7-int-003').prompt === p, int3.prompt), 'el simulacro en curso resuelve la versión original de su pregunta');
  await page.evaluate(() => { location.hash = 'simulacros'; simTab = 'completo'; render(); });
  await page.evaluate(() => { location.hash = 'errores'; render(); });
  assert(await page.getByRole('button', {name: 'Volver a responder'}).count() === 3, 'cada fallo, también los de versiones retiradas, se puede volver a responder');
  await page.evaluate(() => { state.quiz = null; }); await page.locator('[data-action="retry-error"][data-id="x7-cnf-004"]').click();
  assert(await page.evaluate(p => quizQuestion().prompt === p, cnf.prompt), '«Volver a responder» abre la pregunta que se falló, no su reemplazo');
  // Selecciones nuevas: nunca versiones retiradas (salvo el repaso de un fallo propio)
  const sel = await page.evaluate(() => {
    const ret = new Set(D.retired.map(q => q.id)), bad = list => list.filter(id => ret.has(id)).length;
    const mocks = Array.from({length: 30}, () => buildMock()).filter(Boolean), b = bulletToday();
    return {bank: bad(allQuestions().map(q => q.id)), mb: bad(mockBank().map(q => q.id)), mocks: mocks.reduce((n, m) => n + bad(m.ids), 0), nm: mocks.length,
      bullet: bad(b.ids.filter(id => !(b.fails || []).includes(id))), weekly: bad(weeklySet(weeklyTopics('2026-11-28')).map(q => q.id).filter(id => !state.errors.some(e => e.questionId === id))), count: D.questions.length};
  });
  assert(sel.bank === 0 && sel.mb === 0 && sel.mocks === 0 && sel.nm === 30, 'banco, práctica y 30 simulacros completos sin versiones retiradas');
  assert(sel.bullet === 0 && sel.weekly === 0, 'Bullet Quiz y cuestionario del sábado sin versiones retiradas (fuera de los fallos propios)');
  // Sincronización: un estado remoto que aún usa el ID original para contenido nuevo
  const synced = await page.evaluate(() => { const p = JSON.parse(JSON.stringify(state)); p.attempts.push({id: 'a9', questionId: 'x7-int-003', topicId: 'process-1', module: 'process', approach: 'Híbrido', selected: [1], correct: true, date: '2026-11-24T18:00:00-05:00'}); PMPApp.setState(p); return state.attempts.at(-1).questionId; });
  assert(synced === 'x7-int-003-v2', 'al sincronizar, un intento posterior al cambio que llega con el ID original pasa al nuevo');
  // Un cuestionario en curso con un ID que no existe ya no invalida todo el progreso guardado
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); await p2.route(/supabase-js|fonts\.g/, r => r.abort());
  const broken = {...synthetic, notes: [{id: 'n1', title: 'Nota sintética', body: 'texto', updated: '2026-11-24T10:00:00-05:00'}], quiz: {...synthetic.quiz, ids: ['no-existe-999']}};
  await p2.addInitScript(s => { if (!sessionStorage.getItem('sembrado')) { localStorage.setItem('pmp-master-plan-2027-v1', s); sessionStorage.setItem('sembrado', '1'); } }, JSON.stringify(broken));
  await p2.goto(URL + '#inicio'); await p2.waitForFunction(() => typeof renderHistory === 'function' && typeof state === 'object');
  const kept = await p2.evaluate(() => ({notes: state.notes.length, attempts: state.attempts.length, quiz: state.quiz}));
  assert(kept.notes === 1 && kept.attempts === 3 && kept.quiz === null, 'un cuestionario con una pregunta inexistente se descarta sin borrar notas ni intentos');
  await ctx2.close();
  assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
