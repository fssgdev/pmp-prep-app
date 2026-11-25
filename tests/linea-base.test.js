// Línea base del 25/11 (issues #3, #5, #6, #7, #8): avance de clase, meta 4/4 con yapa, recuperación de fallos retirados,
// prioridad del glosario y tareas de la semana. Estado sintético; nunca datos reales.
// Uso: python3 -m http.server 8765 &  node tests/linea-base.test.js
const {chromium} = require('playwright');
const os = require('os');
const path = require('path');
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
  // ---------- #8: prioridad del glosario en tarjetas nuevas ----------
  console.log('\n== #8 glosario');
  {
    const {ctx, page, errors, boot} = await fresh('2026-11-26T09:00:00-05:00');
    await boot('inicio');
    await page.evaluate(() => { ensureClassLog().push({id: 'cl-s7', session: 7, date: '2026-11-25', lessons: [3], updated: stamp()}); allCards.cache = null; });
    const r = await page.evaluate(() => {
      const f = freshCards(), cov = coveredLessons(today()), top = f.slice(0, 8), t3 = new Set(lessonCfg(3).topics);
      const firstFuture = f.findIndex(c => !cov.includes(cardLesson(c)) && cardLesson(c) > Math.max(...cov)), lastPast = f.map(c => cov.includes(cardLesson(c)) || cardLesson(c) <= Math.max(...cov)).lastIndexOf(true);
      const firstConcept = f.findIndex(c => !c.gloss), lastPastGloss = f.map(c => c.gloss && cardLesson(c) <= Math.max(...cov)).lastIndexOf(true);
      const fronts = allCards().filter(c => c.gloss).map(c => c.front), aka = D.glossary.flatMap(g => g.aka || []);
      return {top: top.every(c => c.gloss && (cardLesson(c) === 3 || t3.has(c.topicId))), order: firstFuture > lastPast, glossFirst: firstConcept > lastPastGloss, dup: fronts.length - new Set(fronts).size, akaCards: fronts.filter(x => aka.includes(x)).length, n: fronts.length};
    });
    assert(r.top, 'con la lección 3 declarada, las primeras tarjetas nuevas son del glosario de la lección 3 o de sus tareas ECO');
    assert(r.glossFirst, 'el glosario de lecciones vistas va antes que las tarjetas de conceptos');
    assert(r.order, 'las tarjetas de lecciones futuras nunca desplazan a las ya vistas');
    assert(r.dup === 0 && r.akaCards === 0 && r.n === 618, 'una tarjeta por término (618), sin duplicar sinónimos ni alias');
    const ids = await page.evaluate(() => { cardQueue = buildQueue(); const g = []; for (let i = 0; i < 2; i++) { g.push(cardQueue[0]); cardRevealed = true; gradeCard('good'); } return g; });
    await boot('flashcards');
    assert(await page.evaluate(ids => ids.every(id => state.cards[id]) && !freshCards().some(c => ids.includes(c.id)), ids), 'las tarjetas aprendidas persisten y no vuelven como nuevas');
    const cupo = await page.evaluate(() => newAllowance()); await page.selectOption('#new-per-day', '12');
    assert(await page.evaluate(() => newPerDay()) === 12 && await page.evaluate(() => newAllowance()) === cupo + 4 && await page.evaluate(() => CARD_DAILY_GOAL) === 4, 'el cupo de nuevas se configura (8 → 12) sin cambiar la meta de 4 aprendidas');
    await page.evaluate(() => { location.hash = 'conceptos/glosario'; conceptSearch = 'espina de pescado'; render(); });
    assert(await page.locator('.gloss-item h4', {hasText: 'Diagrama de causa y efecto'}).count() === 1, 'el glosario completo se puede buscar también por sus alias');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  // ---------- #3: línea base (semana, láminas 18:00, Forms por clase, apuntes y contexto) ----------
  console.log('\n== #3 línea base');
  {
    const {ctx, page, errors, boot} = await fresh('2026-11-30T08:00:00-05:00', {width: 375, height: 812});
    await boot('inicio');
    const plan = await page.evaluate(() => { const p = buildPlan(); return {ids: p.map(t => t.id), byDate: d => 0, list: p.map(t => [t.id, t.kind, t.date, t.due, t.time || ''])}; });
    const on = d => plan.list.filter(t => t[2] === d).map(t => t[0]).sort();
    assert(new Set(plan.ids).size === plan.ids.length, 'sin tareas duplicadas en el plan');
    assert(on('2026-11-30').length === 0, 'lunes 30/11: solo la rutina (sin tareas de clase)');
    assert(JSON.stringify(on('2026-12-02')) === JSON.stringify(['forms-s9', 'log-s9', 'slide-s8']), 'miércoles 2/12: lámina de la clase 8 a las 18:00, registro de avance y quiz de Forms de la clase 9');
    assert(plan.list.find(t => t[0] === 'slide-s8')[4] === '18:00', 'la lámina se programa a las 18:00');
    assert(JSON.stringify(on('2026-12-04')) === JSON.stringify(['forms-s10', 'log-s10', 'slide-s9']), 'viernes 4/12: lámina de la clase 9, registro y Forms de la clase 10');
    assert(JSON.stringify(on('2026-12-05')) === JSON.stringify(['week20-2026-12-05']), 'sábado 5/12: cuestionario de 20');
    assert(on('2026-12-06').length === 0 && plan.list.every(t => new Date(t[3] + 'T12:00:00Z').getUTCDay() !== 0), 'domingo sin tareas y ningún vencimiento en domingo');
    assert(JSON.stringify(on('2026-12-07')) === JSON.stringify(['forms-s11', 'log-s11', 'slide-s10']), 'clase excepcional en lunes (7/12): la lámina de la clase 10 queda en la fecha real');
    assert(plan.ids.includes('mock-0') && !plan.ids.some(id => /^mock-[12]$|^mix-|^rev-s|^quiz-s/.test(id)), 'solo el examen de fin de curso es obligatorio; sin repasos genéricos ni simulacros −14/−7');
    const moved = await page.evaluate(() => { D.sessions.find(s => s.id === 12).date = '2026-12-10'; return buildPlan().find(t => t.id === 'slide-s11').date; });
    assert(moved === '2026-12-10', 'si cambia la fecha de la clase siguiente, la lámina se mueve con ella');
    await page.evaluate(() => { D.sessions.find(s => s.id === 12).date = '2026-12-11'; });
    // Lámina: pendiente → disponible (enlace o PDF local) → revisada; versiones conservadas
    await page.evaluate(() => { state.tasksDone['rev-s3-d1'] = '2026-11-12T12:00:00Z'; save(); });
    let st = await page.evaluate(() => slideStatus(7));
    await page.evaluate(() => slideDialog(7, 'slide-s7')); await page.fill('#slide-link', 'https://drive.google.com/file/d/ejemplo-sintetico/view'); await page.getByRole('button', {name: 'Guardar enlace'}).click();
    await page.evaluate(async () => { await filePut('slide-s7-local', new Blob(['%PDF-1.4 sintético'], {type: 'application/pdf'})); addSlideVersion(7, {key: 'slide-s7-local', name: 'lamina-clase-7.pdf', local: true}); });
    const st2 = await page.evaluate(() => [slideStatus(7), slideFor(7).versions.length]);
    await page.getByRole('button', {name: 'Marcar como revisada'}).click();
    const st3 = await page.evaluate(() => [slideStatus(7), !!state.tasksDone['slide-s7']]);
    assert(st === 'pendiente' && st2[0] === 'disponible' && st2[1] === 2 && st3[0] === 'revisada' && st3[1], 'lámina: pendiente → disponible (2 versiones: enlace y PDF) → revisada, y la tarea queda hecha');
    // Apuntes de OneNote por sesión (solo en el dispositivo)
    await page.evaluate(() => { location.hash = 'notas'; render(); });
    const nf = await page.evaluate(async () => { document.getElementById('nf-session').value = '7'; document.getElementById('nf-lesson').value = '3'; await addNoteFile(new File(['%PDF-1.4 apunte'], 'Clase7.pdf', {type: 'application/pdf'})); const before = state.noteFiles.length; await addNoteFile(new File(['x'], 'Seccion.one')); return [before, state.noteFiles.length, state.noteFiles[0].label, filesMem.has(state.noteFiles[0].key)]; });
    assert(nf[0] === 1 && nf[1] === 1 && nf[2] === '2026-11-25_L3' && nf[3], 'apunte PDF de la clase 7 guardado como 2026-11-25_L3 y un .one se rechaza con explicación');
    assert(await page.locator('.note-file').count() === 1, 'Mis notas muestra el apunte vinculado a la sesión');
    // Paquete de contexto: con avance, notas del profesor, apunte y discrepancia; y sin nada
    const pk = await page.evaluate(() => { ensureClassLog().push({id: 'cl-s7', session: 7, date: '2026-11-25', lessons: [3], lastTopic: 'Diapositiva 40', updated: stamp()}); const s7 = D.sessions.find(s => s.id === 7); s7.mapping = 'confirmada'; s7.lesson41 = [2, 3]; const a = contextPackage(7); s7.mapping = 'por confirmar'; const b = contextPackage(8); return [a, b]; });
    assert(/lección v4.1 3/.test(pk[0]) && /confirmadas, lección 2 y 3/.test(pk[0]) && /Clase7\.pdf/.test(pk[0]) && /Discrepancia/.test(pk[0]), 'el paquete de contexto reúne avance, notas del profesor, apuntes y la discrepancia');
    assert(/sin registrar/.test(pk[1]) && /No hay avance declarado/.test(pk[1]) && /por confirmar/.test(pk[1]) && !/https?:/.test(pk[0] + pk[1]), 'sin fuentes, el paquete lo declara como brechas y no incluye enlaces privados');
    // Forms asociado a la clase, sin duplicar
    const fx = path.join(os.tmpdir(), 'forms-quiz-texto-lb.pdf');
    { const c = await browser.newContext(), p2 = await c.newPage(); await p2.goto(URL + 'tests/fixtures/forms-quiz.html'); await p2.pdf({path: fx, format: 'A4', printBackground: true}); await c.close(); }
    await page.evaluate(() => doTask('forms-s7'));
    await page.setInputFiles('#forms-pdf', fx); await page.waitForFunction(() => !pdfBusy && pdfImport, null, {timeout: 60000});
    assert(await page.evaluate(() => pdfImport.session) === 7, 'al abrir el quiz de Forms desde la tarea, la clase 7 queda asociada');
    await page.getByRole('button', {name: /Guardar 2 fallos/}).click();
    let f = await page.evaluate(() => ({done: !!state.tasksDone['forms-s7'], r: state.results.filter(r => r.kind === 'import').map(r => r.session), e: state.errors.filter(e => e.source === 'pdf').map(e => e.misses)}));
    assert(f.done && JSON.stringify(f.r) === '[7]' && f.e.length === 2, 'el resultado queda asociado a la clase 7, la tarea se marca y sus 2 fallos van al repaso');
    await page.evaluate(() => { location.hash = 'simulacros'; simTab = 'externos'; render(); });
    await page.setInputFiles('#forms-pdf', fx); await page.waitForFunction(() => !pdfBusy && pdfImport, null, {timeout: 60000});
    await page.getByRole('button', {name: /Guardar 2 fallos/}).click();
    f = await page.evaluate(() => ({r: state.results.filter(r => r.kind === 'import').length, e: state.errors.filter(e => e.source === 'pdf').map(e => e.misses || 1)}));
    assert(f.r === 1 && f.e.every(m => m === 1), 'importar el mismo resultado otra vez no duplica el historial ni suma fallos');
    // Persistencia, progreso anterior y móvil
    await boot('inicio');
    const keep = await page.evaluate(() => ({legacy: state.tasksDone['rev-s3-d1'], slides: slideStatus(7), notes: state.noteFiles.length, log: !!classLogFor(7)}));
    assert(keep.legacy && keep.slides === 'revisada' && keep.notes === 1 && keep.log, 'al recargar se conservan lámina, apuntes, avance y las marcas de tareas de la línea anterior');
    for (const h of ['inicio', 'agenda', 'ruta', 'notas', 'simulacros']) { await page.evaluate(h => { location.hash = h; render(); }, h); assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `#${h} sin desplazamiento horizontal a 375 px`); }
    assert(await page.evaluate(() => { const r = buildMock(); return !!r && r.ids.length === 180; }), 'el simulacro libre de 180 sigue disponible (voluntario)');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Lámina publicada por GPT en el repositorio (data/slides.json + slides/): aparece sola en la tarea de las 18:00
    require('child_process').execSync('node tools/check-slides.mjs', {cwd: path.join(__dirname, '..'), stdio: 'pipe'});
    const {ctx, page, errors, boot} = await fresh('2026-11-27T18:10:00-05:00');
    await boot('inicio');
    const r = await page.evaluate(() => { const before = slideStatus(7); D.slidesRepo = [{session: 7, version: 1, file: 'slides/clase-07-v1.pdf', title: 'Lámina clase 7', status: 'provisional', createdAt: '2026-11-27T17:55:00-05:00', author: 'GPT'}]; return [before, slideStatus(7), slideVersions(7)[0].link]; });
    assert(r[0] === 'pendiente' && r[1] === 'disponible' && /\/slides\/clase-07-v1\.pdf$/.test(r[2]), 'la lámina publicada por GPT en slides/ queda disponible sola, sin cargarla a mano');
    await page.evaluate(() => doTask('slide-s7'));
    assert(/publicada por GPT/.test(await page.locator('#modal').innerText()) && await page.locator('#modal a', {hasText: 'Abrir lámina'}).count() === 1, 'la tarea muestra la versión publicada y el enlace para abrirla');
    await page.getByRole('button', {name: 'Marcar como revisada'}).click();
    const r2 = await page.evaluate(() => { const a = [slideStatus(7), !!state.tasksDone['slide-s7']]; D.slidesRepo.push({session: 7, version: 2, file: 'slides/clase-07-v2.pdf', status: 'final', createdAt: '2026-11-27T21:00:00-05:00'}); state.slides[0].reviewedAt = '2026-11-28T00:10:00.000Z'; return [...a, slideStatus(7)]; });
    assert(r2[0] === 'revisada' && r2[1], 'al marcarla como revisada, la tarea queda hecha');
    assert(r2[2] === 'disponible', 'si GPT publica una versión nueva después de la revisión, vuelve a mostrarse como disponible');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // 18:00 del día de clase: Inicio propone abrir la lámina
    const {ctx, page, errors, boot} = await fresh('2026-12-02T18:05:00-05:00');
    await boot('inicio');
    assert(/Repasar láminas/.test(await page.locator('.d-next h2').innerText()) && /18:00/.test(await page.locator('.d-next').innerText()), 'a las 18:00 del día de clase, Inicio propone repasar la lámina');
    const tasks = await page.locator('.d-today .task-row h3').allInnerTexts();
    assert(tasks.indexOf('Repasar láminas de la sesión anterior') < tasks.indexOf('Indicar lección avanzada del PPT de preparación v4.1') && tasks.indexOf('Indicar lección avanzada del PPT de preparación v4.1') < tasks.findIndex(x => /Google Forms/.test(x)), 'Inicio ordena: lámina, registro de avance y quiz de Forms');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
