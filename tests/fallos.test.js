// Historial automático, bucle de fallos, importación de PDF de Google Forms, frecuencia semanal y calendario (issue #9).
// Uso: python3 -m http.server 8765 &  node tests/fallos.test.js [ruta-al-Glossary-PDF-opcional]
// El PDF de prueba (tests/fixtures/forms-quiz-sintetico.pdf) es sintético: imita el «printable» de un quiz de Google Forms.
const {chromium} = require('playwright');
const {execSync} = require('child_process');
const path = require('path');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
(async () => {
  execSync('node tools/build-ics.mjs --check', {cwd: path.join(__dirname, '..'), stdio: 'pipe'});
  assert(true, 'calendar.ics está al día con data/calendar.json y data/weekly-plan.json');
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  for (const [name, vp] of [['escritorio', {width: 1366, height: 900}], ['movil', {width: 375, height: 812}]]) {
    console.log('\n== ' + name);
    const ctx = await browser.newContext({viewport: vp}); const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message)); await page.route(/supabase-js|fonts\.g/, r => r.abort());
    await page.clock.install({time: new Date('2026-11-25T09:00:00-05:00')}); // miércoles
    const boot = async h => { await page.goto(URL + '#' + h); await page.waitForFunction(() => typeof renderHistory === 'function' && typeof state === 'object'); await page.evaluate(() => render()); };
    await boot('inicio');
    // Bullet Quiz con 2 fallos
    await page.evaluate(() => { const qs = D.questions.filter(q => q.topicId === 'people-4' && q.type === 'single' && !q.scenarioId).slice(0, 5); startQuiz(qs, 'all', 'Bullet Quiz · Lección 3 (v4.1)', false, bulletId()); });
    for (let i = 0; i < 5; i++) await page.evaluate(i => { const s = state.quiz, q = quizQuestion(); s.selected = i < 2 ? [(q.correct[0] + 1) % 4] : [...q.correct]; checkAnswer(); actions['next-question'](); }, i);
    const r1 = await page.evaluate(() => ({res: state.results.map(r => [r.kind, r.correct, r.total, r.wrong.length]), open: openFailures().map(e => e.due)}));
    assert(JSON.stringify(r1.res) === JSON.stringify([['bullet', 3, 5, 2]]), 'el Bullet Quiz terminado queda en el historial (3/5, 2 fallos)');
    assert(r1.open.length === 2 && r1.open.every(d => d === '2026-11-26'), 'los 2 fallos vuelven el siguiente día de rutina');
    // PDF de Google Forms
    await page.evaluate(() => { location.hash = 'simulacros'; simTab = 'externos'; render(); });
    await page.setInputFiles('#forms-pdf', path.join(__dirname, 'fixtures/forms-quiz-sintetico.pdf'));
    await page.waitForSelector('.pdf-blocks', {timeout: 30000});
    const imp = await page.evaluate(() => ({t: pdfImport.topicId, w: pdfImport.blocks.map(b => b.wrong)}));
    assert(imp.t === 'people-2' && JSON.stringify(imp.w) === JSON.stringify([false, true, false, true, false]), 'PDF: detecta la tarea ECO 1.2 y las preguntas 2 y 4 en rojo como fallos');
    await page.getByRole('button', {name: /Guardar 2 fallos/}).click();
    const r2 = await page.evaluate(() => ({pdf: state.errors.filter(e => e.source === 'pdf').length, imp: state.results.filter(r => r.kind === 'import').length, cards: allCards().filter(c => c.failCard).length, weak: weakTopics()}));
    assert(r2.pdf === 2 && r2.imp === 1 && r2.cards === 4, 'PDF: 2 fallos guardados, quiz en el historial y 4 tarjetas de fallos');
    assert(r2.weak.includes('people-2'), 'la tarea con fallos importados se refuerza en los cuestionarios');
    assert(await page.locator('.history-row').count() === 2, 'el historial muestra el Bullet Quiz y el quiz importado');
    // Jueves: el Bullet Quiz trae los fallos vencidos; el sábado también
    await page.clock.fastForward(24 * 3600 * 1000); await boot('inicio');
    const r3 = await page.evaluate(() => { const b = bulletToday(); return {n: b.ids.length, f: b.fails.length, inB: b.fails.every(id => b.ids.includes(id)), q: buildQueue().filter(id => id.startsWith('err-')).length, w: weeklySet(weeklyTopics('2026-11-28')).filter(q => openFailures().some(e => e.questionId === q.id)).length}; });
    assert(r3.n === 5 && r3.f === 2 && r3.inB, 'Bullet Quiz del jueves: 5 preguntas, 2 de ellas fallos por repasar');
    assert(r3.q === 4 && r3.w === 2, 'los fallos entran como tarjetas y en el cuestionario del sábado');
    // Dos aciertos seguidos cierran el fallo
    const closed = await page.evaluate(() => { const e = openFailures().find(x => x.questionId), q = D.questions.find(x => x.id === e.questionId); noteSuccess(q); const mid = e.resolved; noteSuccess(q); return [mid, e.resolved]; });
    assert(closed[0] === false && closed[1] === true, 'un fallo se cierra al acertarlo dos veces');
    // Frecuencia: sábado cuestionario, domingo descanso
    await page.clock.fastForward(2 * 24 * 3600 * 1000); await boot('inicio');
    assert(await page.evaluate(() => today()) === '2026-11-28' && await page.locator('[data-routine="quizday"]').count() === 1 && /Cuestionario/.test(await page.locator('.d-next h2').innerText()), 'sábado: sin rutina y con el cuestionario de 20');
    await page.clock.fastForward(24 * 3600 * 1000); await boot('inicio');
    assert(await page.locator('[data-routine="rest"]').count() === 1 && /descanso/.test(await page.locator('.d-next h2').innerText()), 'domingo: día de descanso sin tareas');
    assert(await page.evaluate(() => buildPlan().every(t => weekday(t.date) !== 0 && weekday(t.due) !== 0)), 'ninguna tarea del plan cae en domingo');
    // Glosario oficial (opcional: solo si se pasa la ruta del PDF, que no está en el repositorio)
    if (process.argv[2]) {
      await page.evaluate(() => { location.hash = 'conceptos/glosario'; }); await page.waitForSelector('#gloss-pdf');
      await page.setInputFiles('#gloss-pdf', process.argv[2]); await page.waitForFunction(() => officialGlossary(), null, {timeout: 60000});
      const g = await page.evaluate(() => ({n: officialGlossary().terms.length, m: D.glossary.filter(x => officialFor(x.term)).length}));
      assert(g.n > 600 && g.m > 130, `glosario oficial: ${g.n} términos, ${g.m} enlazados a las definiciones simplificadas`);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'sin desplazamiento horizontal');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
