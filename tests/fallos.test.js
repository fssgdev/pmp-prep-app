// Historial automático, bucle de fallos, importación de PDF de Google Forms, frecuencia semanal y calendario (issue #9).
// Uso: python3 -m http.server 8765 &  node tests/fallos.test.js [ruta-al-Glossary-PDF-opcional]
//      QUIZ_PDF=ruta node tests/fallos.test.js  → además lee un printable real (que no está en el repositorio) y muestra lo detectado.
// PDF de prueba: forms-quiz-sintetico.pdf (solo texto, sin íconos) y forms-quiz.html, que imita la vista «Ver puntuación» de
// Google Forms y se imprime aquí de dos formas: con texto («Guardar como PDF») y como imagen («Microsoft Print to PDF»).
const {chromium} = require('playwright');
const {execSync} = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
(async () => {
  execSync('node tools/build-ics.mjs --check', {cwd: path.join(__dirname, '..'), stdio: 'pipe'});
  assert(true, 'calendar.ics está al día con data/calendar.json y data/weekly-plan.json');
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  // Quiz tipo Forms impreso con texto y como imagen (sin texto)
  const fxText = path.join(os.tmpdir(), 'forms-quiz-texto.pdf'), fxImg = path.join(os.tmpdir(), 'forms-quiz-imagen.pdf');
  { const c = await browser.newContext({viewport: {width: 900, height: 1000}, deviceScaleFactor: 2}), p = await c.newPage();
    await p.goto(URL + 'tests/fixtures/forms-quiz.html'); await p.pdf({path: fxText, format: 'A4', printBackground: true});
    const png = await p.screenshot({fullPage: true}), [w, h] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
    await p.setContent(`<html><head><title>Q90 PMP V4 ECO1.2 Prueba sintética</title><style>body{margin:0}img{display:block;width:${w}px}</style></head><body><img src="data:image/png;base64,${png.toString('base64')}"></body></html>`);
    await p.pdf({path: fxImg, width: w + 'px', height: h + 'px', printBackground: true}); await c.close(); }
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
      const cov = await page.evaluate(() => {
        const words = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(Boolean);
        const grams = new Set(); officialGlossary().terms.forEach(o => { const w = words(o.def); for (let i = 0; i + 7 <= w.length; i++) grams.add(w.slice(i, i + 7).join(' ')); });
        const copied = D.glossary.filter(x => ['def', 'ex'].some(k => { const w = words(x[k] || ''); for (let i = 0; i + 7 <= w.length; i++) if (grams.has(w.slice(i, i + 7).join(' '))) return true; return false; })).map(x => x.term);
        return {uncovered: officialUncovered().map(t => t.term), copied};
      });
      assert(cov.uncovered.length === 0, 'cada término del glosario oficial tiene su versión simplificada (por nombre, «official» o alias) ' + cov.uncovered.slice(0, 5).join(', '));
      assert(cov.copied.length === 0, 'ninguna definición ni ejemplo propio repite 7 palabras seguidas del texto de PMI ' + cov.copied.slice(0, 5).join(', '));
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'sin desplazamiento horizontal');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
    // Quiz con el diseño de Forms: preguntas ubicadas por su ícono ✓/×, con texto o solo como imagen
    const ctx2 = await browser.newContext({viewport: vp}); const p2 = await ctx2.newPage(); const errors2 = [];
    p2.on('pageerror', e => errors2.push(e.message)); await p2.route(/supabase-js|fonts\.g/, r => r.abort());
    await p2.clock.install({time: new Date('2026-11-25T09:00:00-05:00')});
    const boot2 = async h => { await p2.goto(URL + '#' + h); await p2.waitForFunction(() => typeof renderHistory === 'function' && typeof state === 'object'); await p2.evaluate(() => { simTab = 'externos'; render(); }); };
    const readPdf = async f => { await p2.setInputFiles('#forms-pdf', f); await p2.waitForFunction(() => !pdfBusy && pdfImport, null, {timeout: 60000}); return p2.evaluate(() => ({title: pdfImport.title, t: pdfImport.topicId, textless: pdfImport.textless, mode: pdfImport.mode, b: pdfImport.blocks.map(b => ({n: b.n, w: b.wrong, p: b.prompt, c: b.correctText, y: b.yourText, img: !!b.front && !!b.back}))})); };
    await boot2('simulacros');
    const tx = await readPdf(fxText);
    assert(tx.mode === 'íconos' && !tx.textless && tx.t === 'people-2' && JSON.stringify(tx.b.map(b => b.w)) === JSON.stringify([false, true, false, true, false]), 'PDF con texto: 5 preguntas por su ícono, la 2 y la 4 en rojo, tarea 1.2');
    assert(/subcontratista/.test(tx.b[1].p) && tx.b[1].c === 'B. Conversar en privado sobre la regla y su impacto' && tx.b[1].y === 'A. Aplicarle una penalidad contractual', 'PDF con texto: enunciado, respuesta correcta y tu respuesta de cada fallo');
    await p2.getByRole('button', {name: 'Descartar'}).click();
    const im = await readPdf(fxImg);
    assert(im.mode === 'íconos' && im.textless && im.t === 'people-2' && JSON.stringify(im.b.map(b => b.w)) === JSON.stringify([false, true, false, true, false]) && im.b.every(b => b.img), 'PDF sin texto (como «Microsoft Print to PDF»): 5 preguntas, la 2 y la 4 como fallos, con su imagen');
    assert(await p2.locator('.pdf-block img.quiz-img').count() === 5 && await p2.locator('.pdf-note').count() === 1, 'la revisión muestra la imagen de cada pregunta y explica que el PDF no trae texto');
    await p2.selectOption('#pdf-topic', 'people-4');
    await p2.getByRole('button', {name: /Guardar 2 fallos/}).click();
    await p2.waitForFunction(() => pdfImgs.size === 2);
    await boot2('flashcards'); await p2.waitForFunction(() => pdfImgs.size === 2);
    const fc = await p2.evaluate(() => ({errs: state.errors.filter(e => e.img && e.topicId === 'people-4').length, cards: allCards().filter(c => c.imgId).length}));
    assert(fc.errs === 2 && fc.cards === 2, 'los 2 fallos quedan con la tarea elegida y como tarjetas con imagen');
    assert(await p2.locator('.flashcard img.quiz-img').count() === 1, 'después de recargar, la tarjeta muestra el enunciado como imagen (guardada en el dispositivo)');
    const zw = await p2.evaluate(() => { const w = document.querySelector('.flashcard .quiz-img-wrap'), a = w.querySelector('img').getBoundingClientRect().width; w.click(); const b = w.querySelector('img').getBoundingClientRect().width; return [a, b, document.documentElement.scrollWidth - innerWidth]; });
    assert(zw[1] >= 680 && zw[2] <= 1 && (vp.width > 700 || zw[0] < zw[1]), 'tocar la imagen la amplía sin desbordar la página');
    await p2.getByRole('button', {name: 'Mostrar respuesta'}).click();
    assert(await p2.locator('.flashcard img.quiz-img').count() === 1 && /imagen de tu quiz/.test(await p2.locator('.flash-back').innerText()), 'al mostrar la respuesta aparece la pregunta completa con la respuesta correcta');
    await boot2('errores'); await p2.waitForFunction(() => pdfImgs.size === 2 && document.querySelectorAll('.item-card h3 + .quiz-img-wrap img.quiz-img').length > 0, null, {timeout: 10000}).catch(() => {});
    assert(await p2.locator('.item-card h3 + .quiz-img-wrap img.quiz-img').count() === 2 && await p2.locator('.item-card details.quiz-full').count() === 2, 'el registro de errores muestra la imagen de cada fallo importado');
    if (process.env.QUIZ_PDF) {
      await boot2('simulacros'); const real = await readPdf(process.env.QUIZ_PDF);
      console.log(`    (QUIZ_PDF) ${real.title}: ${real.b.length} preguntas, fallos ${real.b.filter(b => b.w).map(b => b.n).join(', ') || 'ninguno'}${real.textless ? ' · sin texto' : ''}`);
      assert(real.b.length > 0, 'el printable real se lee');
    }
    assert(await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'sin desplazamiento horizontal (importación por imagen)');
    assert(errors2.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors2));
    await ctx2.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
