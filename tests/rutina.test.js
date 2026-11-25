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
    // 23:59:20 del lunes 23/11/2026, hora de Lima
    await page.clock.install({time: new Date('2026-11-23T23:59:20-05:00')});
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
    // intervalos pedidos por Fabrizio (#5): nueva o en aprendizaje 1 min / 1 / 2 / 4 días; en repaso, esos valores son mínimos
    const grid = await page.evaluate(() => {
      const bad = [];
      for (const ph of ['new', 'learning', 'relearning']) { const s = ph === 'new' ? null : {phase: ph, interval: 0, ease: 2.5, reps: 1}; const v = nextIntervals(s); if (!(v.again.min === 1 && v.hard.days === 1 && v.good.days === 2 && v.easy.days === 4)) bad.push(ph); }
      for (let I = 1; I <= 120; I++) for (let E = 1.3; E <= 3.01; E += .05) { const v = nextIntervals({phase: 'review', interval: I, ease: E, reps: 1}); if (!(v.again.min === 1 && v.hard.days >= 1 && v.good.days >= 2 && v.easy.days >= 4 && v.hard.days < v.good.days && v.good.days < v.easy.days && v.hard.days > I - 0)) bad.push(I + '/' + E.toFixed(2)); }
      return bad;
    });
    assert(grid.length === 0, 'intervalos: nuevas y en aprendizaje 1 min · 1 · 2 · 4 días; repaso con mínimos y orden estricto (3 fases + 4 080 combinaciones) ' + grid.slice(0, 5));
    await page.evaluate(() => { cardRevealed = true; render(); });
    const labels = await page.$$eval('[data-action="card-grade"] small', els => els.map(e => e.textContent).join(' | '));
    assert(labels === '1 min | 1 día | 2 días | 4 días', 'los botones anuncian ' + labels);
    await page.locator('[data-action="card-grade"][data-id="again"]').click();
    const st = await page.evaluate(i => state.cards[i], id);
    assert(st.due === '2026-11-24' && Math.abs(Date.parse(st.dueAt) - Date.parse('2026-11-24T00:00:20-05:00')) < 5000, 'Otra vez a las 23:59:20 vence 00:00:20 del 24/11 (cruza la medianoche de Lima)');
    assert(await page.locator('.flash-wait h2').textContent() === 'Próxima tarjeta en 1 min', 'no se repite antes de tiempo: muestra la espera');
    assert(await page.locator('.flash-wait a[href="#inicio"]').count() === 1, 'se puede salir mientras espera');
    await reload('flashcards');
    assert(await page.locator('.flash-wait').count() === 1 && await page.evaluate(() => !cardQueue.length), 'tras recargar sigue esperando');
    await page.clock.fastForward('00:30');
    await reload('flashcards');
    assert(await page.evaluate(i => !buildQueue().includes(i), id) && await page.locator('.flash-wait').count() === 1, 'Otra vez: a los 30 s (00:00 del 24/11) todavía no vuelve');
    // repaso extra voluntario desde la espera: no cambia la programación ni la meta
    const goal0 = await page.evaluate(() => cardsGradedToday());
    await page.locator('[data-action="cards-extra-learning"]').click();
    await page.evaluate(() => { cardRevealed = true; render(); });
    assert((await page.locator('[data-action="card-grade"][data-id="good"] small').textContent()) === 'sin cambios', 'el repaso extra se distingue (sin cambios)');
    await page.locator('[data-action="card-grade"][data-id="good"]').click();
    const after = await page.evaluate(i => ({s: state.cards[i], log: state.cardLog[state.cardLog.length - 1], g: cardsGradedToday()}), id);
    assert(after.s.dueAt === st.dueAt && after.log.extra === true && after.g === goal0, 'el repaso extra no reprograma la tarjeta ni suma a la meta');
    await page.clock.runFor(31000);
    await page.waitForTimeout(100);
    assert(await page.evaluate(i => cardQueue[0] === i, id), 'al cumplirse el minuto la pantalla se actualiza sola y la tarjeta vuelve');
    assert(await page.evaluate(() => today()) === '2026-11-24', 'el día cambió a 24/11 en Lima');
    // Difícil = 1 día: no vuelve hasta la medianoche de Lima del 25/11
    await page.evaluate(() => { cardRevealed = true; render(); });
    await page.locator('[data-action="card-grade"][data-id="hard"]').click();
    assert(await page.evaluate(i => state.cards[i].due === '2026-11-25' && !state.cards[i].dueAt && !buildQueue().includes(i) && state.cardLog[state.cardLog.length - 1].applied.days === 1, id), 'Difícil: aplica 1 día, vence el 25/11 y no se muestra antes');
    await page.clock.fastForward(24 * 3600 * 1000);
    await reload('flashcards');
    assert(await page.evaluate(i => today() === '2026-11-25' && buildQueue().includes(i), id), 'Difícil: vuelve el 25/11 tras la medianoche de Lima');
    // en repaso, progresión adaptativa (I = 1): 2 < 3 < 4 días, y Bien aplica lo anunciado
    await page.evaluate(i => { cardQueue = [i]; cardRevealed = true; render(); }, id);
    const rl = await page.$$eval('[data-action="card-grade"] small', els => els.map(e => e.textContent).join(' | '));
    assert(rl === '1 min | 2 días | 3 días | 4 días', 'en repaso los botones anuncian ' + rl);
    await page.locator('[data-action="card-grade"][data-id="good"]').click();
    assert(await page.evaluate(i => state.cards[i].due === '2026-11-28' && state.cards[i].interval === 3, id), 'Bien en repaso: aplica 3 días (vence el 28/11), igual a lo anunciado');
    /* ---------- Bullet Quiz: lección con menos de 5 preguntas ---------- */
    await page.evaluate(() => { localStorage.removeItem('pmp-master-plan-2027-v1'); });
    await reload('inicio');
    await page.evaluate(() => { D.weeklyPlan.lessons['99'] = {title: 'Prueba corta', topics: [], questionIds: ['q27', 'x7-agl-001', 'z7-agl-001'], status: 'por confirmar'}; ensureRoutine().override[weekStart()] = 99; save(); render(); });
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
