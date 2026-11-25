const {chromium} = require('playwright');
const URL = 'http://localhost:8765/';
const OUT = process.argv[2];
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  for (const [name, vp] of [['escritorio', {width: 1366, height: 900}], ['movil', {width: 375, height: 812}]]) {
    console.log('\n== ' + name);
    const ctx = await browser.newContext({viewport: vp, deviceScaleFactor: name === 'movil' ? 2 : 1, isMobile: name === 'movil', hasTouch: name === 'movil'});
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && !/supabase|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
    await page.route(/supabase-js/, r => r.abort()); await page.goto(URL + '#inicio'); await page.waitForFunction(() => window.MOCK_ACTIONS !== undefined || typeof MOCK_ACTIONS !== 'undefined');
    for (const r of ['inicio', 'agenda', 'ruta', 'conceptos', 'flashcards', 'simulacros', 'modulos', 'practica', 'errores', 'preparacion', 'notas']) {
      await page.evaluate(r => { location.hash = r; }, r); await page.waitForTimeout(150);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(sw <= 1, `#${r} sin desplazamiento horizontal (${sw})`);
    }
    await page.evaluate(() => { location.hash = 'simulacros'; simTab = 'completo'; render(); });
    const btn = page.getByRole('button', {name: 'Comenzar simulacro completo'});
    assert(await btn.count() === 1 && await btn.isEnabled(), 'botón de simulacro completo habilitado');
    if (name === 'escritorio') await page.screenshot({path: OUT + '/sim-disponibilidad.png', fullPage: true});
    await btn.click(); await page.getByRole('button', {name: 'Empezar ahora'}).click();
    await page.waitForSelector('.mock-bar');
    const info = await page.evaluate(() => { const r = state.mockRun, scored = r.ids.filter(id => !r.unscored.includes(id)), c = {}; scored.forEach(id => { const m = D.questions.find(q => q.id === id).module; c[m] = (c[m] || 0) + 1; }); return {n: r.ids.length, uniq: new Set(r.ids).size, uns: r.unscored.length, c}; });
    assert(info.n === 180 && info.uniq === 180, '180 preguntas únicas');
    assert(info.uns === 10, '10 no puntuadas');
    assert(info.c.people === 56 && info.c.process === 70 && info.c.business === 44, 'calificadas 56/70/44 ' + JSON.stringify(info.c));
    // issue #7: 200 simulacros generados sin preguntas introductorias ni dos de la misma familia
    const integ = await page.evaluate(() => { let bad = 0; for (let k = 0; k < 200; k++) { const r = buildMock(); if (!r) { bad++; continue; } const qs = r.ids.map(mockQ), fam = qs.filter(q => q.family).map(q => q.family); if (qs.some(q => q.level === 'intro') || new Set(fam).size !== fam.length || new Set(r.ids).size !== 180) bad++; } return bad; });
    assert(integ === 0, 'simulacros sin introductorias ni reformulaciones (200 generados, fallos: ' + integ + ')');
    // ECO julio 2026: ~40 % predictivo en las 170 calificadas
    const mix = await page.evaluate(() => { const v = []; for (let k = 0; k < 50; k++) { const r = buildMock(); v.push(r.ids.filter(id => !r.unscored.includes(id)).map(mockQ).filter(q => q.approach === 'Predictivo').length); } return [Math.min(...v), Math.max(...v)]; });
    assert(mix[0] >= 66 && mix[1] <= 70, 'enfoque predictivo ≈ 40 % de las calificadas ' + JSON.stringify(mix));
    // responde la primera con la UI
    const first = page.locator('.options input, .match-list select').first();
    if (await page.locator('.options input').count()) await page.locator('.options label').first().click(); else await page.locator('.match-list select').first().selectOption('0');
    await page.getByRole('button', {name: /Marcar para revisar/}).click();
    await page.getByRole('button', {name: /Siguiente/}).click();
    assert(await page.evaluate(() => state.mockRun.index) === 1, 'avanza a la pregunta 2');
    if (name === 'escritorio') await page.screenshot({path: OUT + '/sim-pregunta-escritorio.png'}); else await page.screenshot({path: OUT + '/sim-pregunta-movil.png'});
    // persistencia al recargar
    await page.reload(); await page.waitForSelector('.mock-bar');
    assert(await page.evaluate(() => state.mockRun.index === 1 && Object.keys(state.mockRun.answers).length === 1 && Object.keys(state.mockRun.flags).length === 1), 'el intento se conserva al recargar');
    // contesta el resto correctamente salvo 20, por código (ruta rápida)
    await page.evaluate(() => { const r = state.mockRun; r.ids.forEach((id, i) => { if (i % 9 === 0) return; const q = D.questions.find(x => x.id === id); r.answers[id] = [...q.correct]; }); r.index = 59; save(); render(); });
    await page.getByRole('button', {name: /Revisar el bloque/}).click();
    assert(await page.locator('text=Antes de cerrar el bloque 1').count() === 1, 'pantalla de revisión del bloque 1');
    const used0 = await page.evaluate(() => state.mockRun.usedMs);
    await page.getByRole('button', {name: /Cerrar bloque e iniciar pausa 1/}).click();
    assert(await page.locator('#mock-break-clock').count() === 1, 'pausa 1 iniciada con cuenta regresiva');
    if (name === 'escritorio') await page.screenshot({path: OUT + '/sim-pausa.png'});
    const u1 = await page.evaluate(() => mockUsed()); await page.waitForTimeout(2200); const u2 = await page.evaluate(() => mockUsed());
    assert(u1 === u2, 'el reloj del examen se detiene en la pausa');
    await page.getByRole('button', {name: /Continuar con el bloque 2/}).click();
    assert(await page.evaluate(() => state.mockRun.block === 1 && state.mockRun.index === 60), 'bloque 2 empieza en la pregunta 61');
    await page.evaluate(() => MOCK_ACTIONS['mock-goto']({dataset: {id: '5'}}));
    assert(await page.evaluate(() => state.mockRun.index) === 60, 'el bloque 1 quedó cerrado (no se puede volver)');
    assert(await page.locator('.mock-cell').count() === 60, 'navegador muestra solo las 60 del bloque');
    await page.evaluate(() => { state.mockRun.index = 119; save(); render(); });
    await page.getByRole('button', {name: /Revisar el bloque/}).click();
    await page.getByRole('button', {name: 'Cerrar bloque sin pausa'}).click();
    assert(await page.evaluate(() => state.mockRun.block === 2 && state.mockRun.phase === 'exam'), 'bloque 3 tras omitir la pausa 2');
    await page.evaluate(() => { state.mockRun.index = 179; save(); render(); });
    await page.getByRole('button', {name: /Revisar el bloque/}).click();
    await page.getByRole('button', {name: 'Terminar y calificar'}).click();
    await page.waitForSelector('text=Desglose por dominio');
    const res = await page.evaluate(() => { const r = state.mockRun, exp = r.ids.filter((id, i) => !r.unscored.includes(id) && (i % 9 !== 0 || (i === 0 && answeredOk(D.questions.find(q => q.id === id), r.answers[id])))).length; return {res: r.result, exp, mock: state.mocks[state.mocks.length - 1], att: state.attempts.filter(a => a.mock).length}; });
    assert(res.res.total === 170 && res.res.correct === res.exp, `calificación ${res.res.correct}/170 coincide con lo esperado (${res.exp})`);
    assert(res.mock.source === 'app' && res.mock.total === 170 && res.mock.domains.people.total === 56, 'resultado guardado en simulacros con desglose');
    assert(res.att >= 159, 'respuestas registradas en el historial');
    const rows = await page.locator('.mock-review-row').count(); assert(rows > 0, 'revisión final lista incorrectas (' + rows + ')');
    await page.getByRole('button', {name: 'Todas'}).click(); assert(await page.locator('.mock-review-row').count() === 180, 'revisión final con las 180');
    await page.locator('.mock-review-row summary').first().click();
    await page.screenshot({path: OUT + `/sim-resultado-${name}.png`, fullPage: false});
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'resultado sin desplazamiento horizontal');
    // fin por tiempo
    await page.getByRole('button', {name: 'Nuevo simulacro'}).click(); await page.getByRole('button', {name: 'Empezar ahora'}).click();
    await page.evaluate(() => { state.mockRun.usedMs = MOCK_FORMAT.minutes * 60000 - 1500; save(); });
    await page.waitForTimeout(3000);
    assert(await page.evaluate(() => state.mockRun.phase === 'done' && state.mockRun.reason === 'tiempo'), 'al agotarse el tiempo se califica automáticamente');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
