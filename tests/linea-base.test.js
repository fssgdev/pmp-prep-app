// Línea base del 25/11 (issues #3, #5, #6, #7, #8): avance de clase, meta 4/4 con yapa, recuperación de fallos retirados,
// prioridad del glosario y tareas de la semana. Estado sintético; nunca datos reales.
// Uso: python3 -m http.server 8765 &  node tests/linea-base.test.js
const {chromium} = require('playwright');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  const fresh = async (time, vp = {width: 1366, height: 900}) => {
    const ctx = await browser.newContext({viewport: vp}); const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message)); await page.route(/supabase-js|fonts\.g/, r => r.abort());
    await page.clock.install({time: new Date(time)});
    const boot = async h => { await page.goto(URL + '#' + h); await page.waitForFunction(() => typeof classLogDialog === 'function' && typeof state === 'object'); await page.evaluate(() => render()); };
    return {ctx, page, errors, boot};
  };

  // ---------- #5: meta diaria = 4 tarjetas distintas aprendidas; «Otra vez» es yapa ----------
  console.log('\n== #5 yapa');
  {
    const {ctx, page, errors, boot} = await fresh('2026-11-26T09:00:00-05:00'); // jueves
    await boot('flashcards');
    const grade = (g) => page.evaluate(g => { cardRevealed = true; const id = cardQueue[0]; gradeCard(g); return id; }, g);
    await page.evaluate(() => { state.cardExtra = {[today()]: -4}; save(); cardQueue = buildQueue(); }); // cupo de 4 nuevas para el caso A, B, C, D
    const A = await grade('again'), B = await grade('good'), C = await grade('hard'), D = await grade('easy');
    let s = await page.evaluate(() => ({g: cardsGradedToday(), q: buildQueue(), done: !!state.tasksDone['cards-' + today()]}));
    assert(s.g === 3 && !s.done && !s.q.includes(A), 'A = Otra vez y B, C, D calificadas: avance 3/4; A espera su minuto');
    await page.clock.fastForward(61000); await page.evaluate(() => { cardQueue = null; render(); });
    s = await page.evaluate(() => ({q: buildQueue()}));
    assert(s.q[s.q.length - 1] === A, 'A reaparece al final como yapa cuando vence su minuto');
    await page.evaluate(() => { cardQueue = buildQueue(); });
    await grade('again');
    assert(await page.evaluate(() => cardsGradedToday()) === 3, 'otra «Otra vez» sobre A no suma y la devuelve a la cola');
    await page.clock.fastForward(61000); await page.evaluate(() => { cardQueue = buildQueue(); });
    await grade('good');
    s = await page.evaluate(() => ({g: cardsGradedToday(), done: !!state.tasksDone['cards-' + today()], log: state.cardLog.filter(l => l.date === today()).map(l => l.grade)}));
    assert(s.g === 4 && s.done, 'al calificar A con Bien llega a 4/4 y la tarea se marca hecha');
    assert(JSON.stringify(s.log) === JSON.stringify(['again', 'good', 'hard', 'easy', 'again', 'good']), 'se conserva cada calificación del día, con su hora');
    // una tarjeta distinta cuenta como máximo una vez
    await page.evaluate(() => { state.cardLog.push({id: state.cardLog[1].id, date: today(), grade: 'easy', first: false, at: stamp()}); });
    assert(await page.evaluate(() => cardsGradedToday()) === 4, 'una misma tarjeta cuenta una sola vez al día');
    // recarga: el avance persiste
    await boot('inicio');
    assert(await page.evaluate(() => cardsGradedToday()) === 4 && /4\/4/.test(await page.locator('[data-routine="cards"]').innerText()), 'tras recargar, Inicio muestra Flashcards 4/4');
    // el repaso extra voluntario no cambia meta ni programación
    const before = await page.evaluate(() => JSON.stringify(state.cards));
    await page.evaluate(() => { cardMode = 'extra'; cardQueue = [state.cardLog[1].id]; cardRevealed = true; gradeCard('again'); });
    assert(await page.evaluate(b => JSON.stringify(state.cards) === b && cardsGradedToday() === 4, before), 'el repaso extra voluntario no cambia la meta ni la programación');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // varias yapas a la vez, y medianoche
    const {ctx, page, errors, boot} = await fresh('2026-11-26T23:50:00-05:00');
    await boot('flashcards');
    const grade = (g) => page.evaluate(g => { cardRevealed = true; const id = cardQueue[0]; gradeCard(g); return id; }, g);
    await page.evaluate(() => { state.cardExtra = {[today()]: -4}; cardQueue = buildQueue(); });
    const A = await grade('again'), B = await grade('again'); await grade('good'); await grade('good');
    assert(await page.evaluate(() => cardsGradedToday()) === 2, 'con dos tarjetas en «Otra vez» el avance es 2/4, sin duplicar conteos');
    await page.clock.fastForward(61000);
    const q = await page.evaluate(() => buildQueue());
    assert(q.slice(-2).sort().join() === [A, B].sort().join(), 'las dos yapas vuelven al final, cada una una vez');
    await page.evaluate(() => { cardQueue = buildQueue(); }); await grade('good');
    assert(await page.evaluate(() => cardsGradedToday()) === 3, 'cada yapa aprendida suma una vez (3/4)');
    await page.clock.fastForward(10 * 60000); // cruza la medianoche de Lima
    await boot('flashcards');
    const m = await page.evaluate(() => ({d: today(), g: cardsGradedToday(), prev: new Set(state.cardLog.filter(l => l.date === '2026-11-26' && l.grade !== 'again').map(l => l.id)).size}));
    assert(m.d === '2026-11-27' && m.g === 0 && m.prev === 3, 'al cruzar la medianoche empieza un nuevo 0/4 y el día anterior conserva su 3/4');
    // las tarjetas de fallos no consumen el cupo de nuevas
    const cupo = await page.evaluate(() => { const a = newAllowance(); state.errors.unshift({id: 'e-sint', questionId: null, prompt: 'Fallo sintético', category: 'Conceptual', date: today(), due: today(), resolved: false, source: 'pdf', updated: stamp()}); allCards.cache = null; cardQueue = ['err-e-sint']; cardRevealed = true; gradeCard('good'); return [a, newAllowance(), state.cardLog.at(-1).first]; });
    assert(cupo[0] === cupo[1] && cupo[2] === true, 'una tarjeta de fallo nueva no reduce el cupo de tarjetas nuevas');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ---------- #6 / #3: avance real de la clase ----------
  console.log('\n== #6 avance de clase');
  {
    const {ctx, page, errors, boot} = await fresh('2026-11-25T22:15:00-05:00', {width: 375, height: 812});
    await boot('agenda');
    assert(await page.evaluate(() => buildPlan().some(t => t.id === 'log-s7' && t.date === '2026-11-25')), 'la clase del 25/11 tiene la tarea «Indicar lección avanzada del PPT de preparación v4.1»');
    await page.evaluate(() => doTask('log-s7'));
    await page.locator('#classlog-form [value="3"]').check(); await page.fill('#cl-last', 'Matriz de involucramiento (diap. 42)');
    await page.getByRole('button', {name: 'Guardar avance'}).click();
    let r = await page.evaluate(() => ({rec: classLogFor(7), done: !!state.tasksDone['log-s7'], lesson: activeLesson(weekStart())}));
    assert(r.rec.lessons.join() === '3' && r.rec.lastTopic.includes('diap. 42') && r.done, 'el avance queda registrado y la tarea, hecha');
    assert(r.lesson.n === 3 && r.lesson.source === 'avance', 'la lección de estudio pasa a ser la declarada en clase');
    await page.evaluate(() => classLogDialog(7)); await page.locator('#classlog-form [value="4"]').check(); await page.getByRole('button', {name: 'Guardar cambios'}).click();
    r = await page.evaluate(() => ({rec: classLogFor(7), n: state.classLog.length}));
    assert(r.n === 1 && r.rec.lessons.join() === '3,4' && r.rec.history.length === 1, 'editar no duplica el registro y guarda el historial');
    // discrepancia con notas del profesor
    await page.evaluate(() => { const s = D.sessions.find(x => x.id === 7); s.mapping = 'confirmada'; s.lesson41 = [3]; render(); });
    assert(await page.evaluate(() => !!classLogDiscrepancy(classLogFor(7))), 'si las notas del profesor indican otra lección, se marca la discrepancia');
    // sincronización: otro dispositivo con otra sesión y una edición más antigua
    const merged = await page.evaluate(() => { const other = JSON.parse(JSON.stringify(state)); other.classLog = [{...classLogFor(7), lessons: [2], updated: '2026-11-01T00:00:00Z'}, {id: 'cl-s8', session: 8, date: '2026-11-27', lessons: [3], updated: stamp()}]; return PMPSync.merge(state, other, true).classLog.map(x => x.id + ':' + x.lessons.join('+')).sort(); });
    assert(JSON.stringify(merged) === JSON.stringify(['cl-s7:3+4', 'cl-s8:3']), 'al sincronizar se conservan los registros de ambos dispositivos y gana la edición más reciente');
    await boot('agenda');
    assert(await page.evaluate(() => classLogFor(7)?.lessons.join()) === '3,4', 'el registro persiste al recargar');
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'sin desplazamiento horizontal a 375 px');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  // ---------- #7: fallos en versiones retiradas ----------
  console.log('\n== #7 retiradas');
  {
    const {ctx, page, errors, boot} = await fresh('2026-11-26T09:00:00-05:00');
    await boot('inicio');
    const old = await page.evaluate(() => D.retired.find(q => q.id === 'process-l3-003'));
    // fallo propio en la versión original (anterior al cambio) que vence hoy, y un reintento nuevo de esa versión
    await page.evaluate(() => {
      state.errors.unshift({id: 'id-' + Date.parse('2026-11-17T09:35:00-05:00').toString(36) + 'abcdef', questionId: 'process-l3-003', prompt: 'x', category: 'Conceptual', date: '2026-11-17', due: today(), resolved: false, misses: 2, module: 'process', topicId: 'process-3', updated: stamp()});
      state.errors.unshift({id: 'id-' + Date.parse('2026-11-17T09:40:00-05:00').toString(36) + 'dup001', questionId: 'process-l3-003', prompt: 'x', category: 'Conceptual', date: '2026-11-17', due: today(), resolved: false, module: 'process', topicId: 'process-3', updated: stamp()});
      state.quiz = null; startQuiz([questionById('process-l3-003')], 1, 'Repaso de error');
      state.quiz.selected = [(questionById('process-l3-003').correct[0] + 1) % 4]; checkAnswer(); save();
    });
    let r = await page.evaluate(() => state.attempts.at(-1).questionId);
    assert(r === 'process-l3-003', 'un reintento nuevo de la versión retirada se guarda con su ID original');
    await boot('inicio');
    r = await page.evaluate(() => { migrateQuestionIds(state); migrateQuestionIds(state); const imported = migrateQuestionIds(JSON.parse(JSON.stringify(state))); const merged = migrateQuestionIds(PMPSync.merge(state, JSON.parse(JSON.stringify(state)), true)); return [state.attempts.at(-1).questionId, imported.attempts.at(-1).questionId, merged.attempts.at(-1).questionId, state.errors.filter(e => e.questionId === 'process-l3-003').length]; });
    assert(r.slice(0, 3).every(x => x === 'process-l3-003') && r[3] === 2, 'tras recargar, migrar dos veces, importar o sincronizar, el reintento y sus fallos siguen en la versión original');
    const sel = await page.evaluate(() => {
      delete ensureRoutine().days[today()]; const ret = new Set(D.retired.map(q => q.id)), b = bulletToday(), w = weeklySet(weeklyTopics('2026-11-28')), cards = failureCards().map(c => c.id), due = dueFailureIds(5);
      return {due, bulletFail: b.fails.includes('process-l3-003'), weekly: w.filter(q => q.id === 'process-l3-003').length, weeklyOther: w.filter(q => ret.has(q.id) && q.id !== 'process-l3-003').length,
        cards: state.errors.filter(e => e.questionId === 'process-l3-003').every(e => cards.includes('err-' + e.id)), ordinary: allQuestions().filter(q => ret.has(q.id)).length + mockBank().filter(q => ret.has(q.id)).length};
    });
    assert(sel.due.filter(id => id === 'process-l3-003').length === 1, 'el fallo retirado vencido se recupera una sola vez aunque haya dos registros');
    assert(sel.bulletFail && sel.weekly === 1 && sel.cards, 'la versión retirada que fallaste vuelve en el Bullet Quiz, el cuestionario del sábado y como tarjeta');
    assert(sel.weeklyOther === 0 && sel.ordinary === 0, 'ninguna otra retirada entra a selecciones ordinarias, práctica ni simulacros');
    const res = await page.evaluate(() => { const q = questionById('process-l3-003'); noteSuccess(q); noteSuccess(q); return state.errors.filter(e => e.questionId === 'process-l3-003').map(e => e.resolved); });
    assert(res.includes(true), 'acertar dos veces la versión retirada resuelve el fallo de esa misma versión');
    assert(await page.evaluate(() => state.attempts.filter(a => a.questionId === 'process-l3-003-v2').length) === 0, 'los intentos previos no se mezclan con la versión vigente');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
