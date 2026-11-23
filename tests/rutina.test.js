// Pruebas de flashcards con reloj controlado (issue #5) y del Bullet Quiz diario (issue #6).
// Uso: python3 -m http.server 8765 &  node tests/rutina.test.js
const {chromium} = require('playwright');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
const KEY = 'pmp-master-plan-2027-v1';

(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  for (const [name, vp] of [['escritorio', {width: 1366, height: 900}], ['movil', {width: 375, height: 812}]]) {
    console.log('\n== ' + name);
    const ctx = await browser.newContext({viewport: vp, isMobile: name === 'movil', hasTouch: name === 'movil'});
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/supabase-js/, r => r.abort());
    // 23:52 del lunes 23/11/2026, hora de Lima
    await page.clock.install({time: new Date('2026-11-23T23:52:00-05:00')});
    await page.goto(URL + '#inicio'); await page.waitForFunction(() => typeof gradeCard === 'function' && typeof state === 'object' && typeof D === 'object' && D.concepts);
    const reload = async hash => { await page.goto(URL + '#inicio'); await page.waitForFunction(() => typeof gradeCard === 'function' && typeof state === 'object' && typeof D === 'object' && D.concepts); await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(80); };

    /* ---------- flashcards: vencimiento real por marca de tiempo ---------- */
    // sin cupo de nuevas hoy y una sola tarjeta en aprendizaje que ya venció
    const id = await page.evaluate(() => {
      ensureStudyState(); const cards = allCards(), id = cards[0].id;
      state.cardLog = cards.slice(1, 1 + NEW_CARDS_PER_DAY).map(c => ({id: c.id, date: today(), grade: 'good', first: true, at: stamp()}));
      cards.slice(1, 1 + NEW_CARDS_PER_DAY).forEach(c => { state.cards[c.id] = {interval: 1, ease: 2.5, reps: 1, lapses: 0, phase: 'review', due: plusDays(today(), 10), n: 1}; });
      state.cardExtra = {'2026-11-24': -NEW_CARDS_PER_DAY, '2026-11-25': -NEW_CARDS_PER_DAY}; // sin tarjetas nuevas los días siguientes, para aislar la prueba
      state.cards[id] = {interval: 0, ease: 2.5, reps: 0, lapses: 0, phase: 'learning', n: 1, due: today(), dueAt: new Date(Date.now() - 1000).toISOString()};
      save(); return id;
    });
    await reload('flashcards');
    assert(await page.evaluate(i => cardQueue[0] === i && cardQueue.length === 1, id), 'la tarjeta en aprendizaje vencida aparece');
    await page.evaluate(() => { cardRevealed = true; render(); });
    assert((await page.locator('[data-action="card-grade"][data-id="hard"] small').textContent()) === '10 min', 'Difícil anuncia 10 min');
    await page.locator('[data-action="card-grade"][data-id="hard"]').click();
    const st = await page.evaluate(i => state.cards[i], id);
    assert(st.due === '2026-11-24' && Math.abs(Date.parse(st.dueAt) - Date.parse('2026-11-24T00:02:00-05:00')) < 5000, 'Difícil a las 23:52 vence 00:02 del 24/11 (cruza la medianoche de Lima)');
    assert(await page.locator('.flash-wait h2').textContent() === 'Próxima tarjeta en 10 min', 'no se repite antes de tiempo: muestra la espera');
    assert(await page.locator('.flash-wait a[href="#inicio"]').count() === 1, 'se puede salir mientras espera');
    await reload('flashcards');
    assert(await page.locator('.flash-wait').count() === 1 && await page.evaluate(() => !cardQueue.length), 'tras recargar sigue esperando (no aparece antes de los 10 min)');
    await page.clock.fastForward('09:00');
    await reload('flashcards');
    assert(await page.locator('.flash-wait h2').textContent() === 'Próxima tarjeta en 1 min', 'a los 9 min (00:01 del día siguiente) aún falta 1 min');
    // repaso extra voluntario desde la espera: no cambia la programación ni la meta
    const goal0 = await page.evaluate(() => cardsGradedToday());
    await page.locator('[data-action="cards-extra-learning"]').click();
    await page.evaluate(() => { cardRevealed = true; render(); });
    assert((await page.locator('[data-action="card-grade"][data-id="good"] small').textContent()) === 'sin cambios', 'el repaso extra se distingue (sin cambios)');
    await page.locator('[data-action="card-grade"][data-id="good"]').click();
    const after = await page.evaluate(i => ({s: state.cards[i], log: state.cardLog[state.cardLog.length - 1], g: cardsGradedToday()}), id);
    assert(after.s.dueAt === st.dueAt && after.log.extra === true && after.g === goal0, 'el repaso extra no reprograma la tarjeta ni suma a la meta');
    await page.clock.runFor(61000);
    await page.waitForTimeout(100);
    assert(await page.evaluate(i => cardQueue[0] === i, id), 'al cumplirse los 10 min la pantalla se actualiza sola y la tarjeta vuelve');
    assert(await page.evaluate(() => today()) === '2026-11-24', 'el día cambió a 24/11 en Lima');
    // Otra vez = 1 min
    await page.evaluate(() => { cardRevealed = true; render(); });
    await page.locator('[data-action="card-grade"][data-id="again"]').click();
    await page.clock.fastForward('00:30');
    await reload('flashcards');
    assert(await page.evaluate(i => !buildQueue().includes(i), id), 'Otra vez: a los 30 s todavía no vuelve');
    await page.clock.fastForward('00:31');
    await reload('flashcards');
    assert(await page.evaluate(i => buildQueue().includes(i), id), 'Otra vez: vuelve pasado 1 min');
    // Bien = 1 día: no vuelve hasta la medianoche de Lima
    await page.evaluate(() => { cardQueue = [cardQueue.find(Boolean)]; cardRevealed = true; render(); });
    await page.locator('[data-action="card-grade"][data-id="good"]').click();
    assert(await page.evaluate(i => state.cards[i].due === '2026-11-25' && !state.cards[i].dueAt && !buildQueue().includes(i), id), 'Bien: vence el 25/11 y no se muestra antes');
    await page.clock.fastForward('23:58:00');
    await reload('flashcards');
    assert(await page.evaluate(i => today() === '2026-11-25' && buildQueue().includes(i), id), 'Bien: vuelve el 25/11 tras la medianoche de Lima');

    /* ---------- Bullet Quiz: lección con menos de 5 preguntas ---------- */
    await page.evaluate(() => { localStorage.removeItem('pmp-master-plan-2027-v1'); });
    await reload('inicio');
    await page.evaluate(() => { D.weeklyPlan.lessons['99'] = {title: 'Prueba corta', topics: ['agile-1'], status: 'por confirmar'}; ensureRoutine().override[weekStart()] = 99; save(); render(); });
    const short = await page.evaluate(() => bulletToday());
    assert(short.ids.length < 5 && short.short, 'lección corta: ' + short.ids.length + ' preguntas elegibles');
    await page.locator('[data-routine="bullet"] [data-action="bullet-start"]').click();
    assert(await page.locator('dialog[open]').filter({hasText: 'Faltan preguntas'}).count() === 1, 'muestra cuántas faltan en lugar de iniciar');
    assert(await page.evaluate(() => !state.quiz), 'no inicia un Bullet Quiz incompleto');
    await page.locator('[data-action="bullet-free"]').click();
    const ans = async () => page.evaluate(() => { const s = state.quiz, q = quizQuestion(); s.selected = q.type === 'match' ? [...q.correct] : [...q.correct]; checkAnswer(); actions['next-question'](); });
    for (let i = 0; i < short.ids.length; i++) await ans();
    assert(await page.evaluate(() => !state.tasksDone[bulletId()] && bulletProgress() === 0), 'la práctica libre no cuenta: meta sigue en 0/5');
    await page.evaluate(() => { location.hash = 'inicio'; });
    await page.waitForTimeout(80);
    assert((await page.locator('[data-routine="bullet"] .routine-count').textContent()) === '0/5', 'Inicio muestra 0/5');

    /* ---------- Bullet Quiz: recuperar el avance tras iniciar otra práctica ---------- */
    await page.evaluate(() => { delete ensureRoutine().override[weekStart()]; delete state.routine.days[today()]; save(); render(); });
    await page.locator('[data-routine="bullet"] [data-action="bullet-start"]').click();
    await page.waitForTimeout(80);
    assert(await page.evaluate(() => state.quiz?.taskId === bulletId() && state.quiz.ids.length === 5), 'Bullet Quiz de 5 iniciado');
    await ans(); await ans();
    const bIds = await page.evaluate(() => state.quiz.ids.join());
    await page.evaluate(() => startQuiz(allQuestions(), 5, 'Otra práctica'));
    await page.locator('[data-action="replace-quiz"]').click();
    assert(await page.evaluate(() => state.quiz.label === 'Otra práctica' && bulletProgress() === 2), 'otra práctica en curso; el Bullet Quiz conserva 2/5');
    await reload('inicio');
    assert((await page.locator('[data-routine="bullet"] .routine-count').textContent()) === '2/5', 'tras recargar, Inicio muestra 2/5');
    await page.locator('[data-routine="bullet"] [data-action="bullet-start"]').click();
    await page.locator('[data-action="bullet-restore"]').click();
    await page.waitForTimeout(80);
    assert(await page.evaluate(ids => state.quiz.taskId === bulletId() && state.quiz.ids.join() === ids && state.quiz.answers.length === 2 && state.quiz.index === 2, bIds), 'se retoma el mismo Bullet Quiz en la pregunta 3');
    await ans(); await ans(); await ans();
    assert(await page.evaluate(() => Boolean(state.tasksDone[bulletId()]) && bulletProgress() === 5), 'al completar 5/5 la rutina queda hecha');
    await page.evaluate(() => { location.hash = 'inicio'; }); await page.waitForTimeout(80);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'Inicio sin desplazamiento horizontal');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
