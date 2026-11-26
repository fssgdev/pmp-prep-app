// Mapeo v10 (issue #7): las preguntas nuevas viven en la tarea oficial del ECO (module/topicId) y pueden llevar
// aux: "agile-N" para encontrarlas también desde la práctica transversal. Cada pregunta cuenta una sola vez en su dominio.
// Verifica el esquema, la selección por tema/módulo/simulación a medida y el simulacro (180 únicas, 56/70/44 calificadas).
// Uso: python3 -m http.server 8765 &  node tests/aux.test.js
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:8765/';
const assert = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('ok  ' + m); };
const root = path.join(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/questions.json')));
const modules = JSON.parse(fs.readFileSync(path.join(root, 'data/modules.json')));
const topics = new Set(modules.flatMap(m => m.topics.map(t => t.id)));

(async () => {
  /* ---------- esquema ---------- */
  const withAux = bank.filter(q => q.aux !== undefined);
  assert(withAux.length >= 30, `hay ${withAux.length} preguntas con aux`);
  assert(withAux.every(q => typeof q.aux === 'string' && /^agile-[1-6]$/.test(q.aux) && topics.has(q.aux)), 'aux siempre apunta a una tarea transversal existente (agile-1 … agile-6)');
  assert(withAux.every(q => q.module !== 'agile' && q.topicId.split('-')[0] === q.module && topics.has(q.topicId)), 'las preguntas con aux tienen module y topicId de una tarea oficial coherentes entre sí');
  const v10 = bank.filter(q => q.id.startsWith('v10-'));
  assert(v10.length === 30 && v10.every(q => q.aux && ['Ágil', 'Híbrido'].includes(q.approach)), 'el lote v10 son 30 preguntas ágiles o híbridas, todas con aux');
  const dom = d => v10.filter(q => q.module === d).length;
  assert(dom('people') === 8 && dom('process') === 14 && dom('business') === 8, 'v10 reparte 8 People, 14 Process y 8 Business Environment');
  assert(v10.filter(q => ['match', 'dropdown', 'hotspot'].includes(q.type) || q.table).length >= 12, 'v10 tiene al menos 12 formatos no convencionales');
  assert(v10.filter(q => ['single', 'multi'].includes(q.type)).every(q => q.why?.length === q.options.length), 'toda pregunta de opción única o múltiple de v10 trae why por opción');
  const fam = new Map(); bank.forEach(q => q.family && fam.set(q.family, (fam.get(q.family) || []).concat(q.id)));
  assert(v10.filter(q => q.family).every(q => fam.get(q.family).every(id => id.startsWith('v10-'))), 'las familias de v10 son nuevas (no reformulan casos existentes)');

  /* ---------- en la app ---------- */
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  const errors = [];
  for (const vp of [{width: 1366, height: 900}, {width: 375, height: 812}]) {
    const ctx = await browser.newContext({viewport: vp}); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); await page.route(/supabase-js|fonts\.g/, r => r.abort());
    await page.goto(URL + '#modulos/agile'); await page.waitForFunction(() => typeof buildMock === 'function' && typeof state === 'object' && D.questions?.length);
    const tag = vp.width === 375 ? ' (375 px)' : '';
    if (!tag) {
      const sel = await page.evaluate(() => {
        const ids = qs => qs.map(q => q.id);
        const topicA3 = ids(allQuestions().filter(q => inTopic(q, 'agile-3')));
        const topic34 = ids(allQuestions().filter(q => inTopic(q, 'business-6')));
        const modAgile = ids(allQuestions().filter(q => inModule(q, 'agile')));
        const modBusiness = ids(allQuestions().filter(q => inModule(q, 'business')));
        simFilter = {...defaultSimFilter(), modules: ['agile'], topics: ['agile-3']};
        const simA3 = ids(simMatches());
        simFilter = {...defaultSimFilter(), modules: ['business'], topics: ['business-6']};
        const sim36 = ids(simMatches());
        simFilter = defaultSimFilter(); const simAll = simMatches().length;
        return {topicA3, topic34, modAgile, modBusiness, simA3, sim36, simAll, total: allQuestions().length};
      });
      assert(sel.topicA3.includes('v10-b36-001') && sel.topicA3.includes('v9-a3-001'), 'practicar A.3 incluye sus preguntas propias y las de otras tareas con aux agile-3');
      assert(sel.topic34.includes('v10-b36-001'), 'la misma pregunta sigue en su tarea oficial 3.6');
      assert(sel.modAgile.includes('v10-p14-002') && !sel.modBusiness.includes('v10-p14-002'), 'el módulo AGILE/HYBRID encuentra las preguntas con aux; Business no toma las de People');
      assert(sel.simA3.includes('v10-b36-001') && sel.sim36.includes('v10-b36-001'), 'la práctica a medida encuentra la pregunta por su tarea oficial y por su transversal');
      assert(sel.simAll === sel.total, `con todos los filtros, la práctica a medida no duplica preguntas (${sel.simAll} de ${sel.total})`);
      const mock = await page.evaluate(() => {
        const out = {ok: 0, bad: [], v10: 0};
        for (let i = 0; i < 200; i++) {
          const r = buildMock(); if (!r) { out.bad.push('null'); continue; }
          const scored = r.ids.filter(id => !r.unscored.includes(id)).map(mockQ), c = d => scored.filter(q => q.module === d).length;
          const fams = scored.concat(r.unscored.map(mockQ)).map(q => q.family).filter(Boolean);
          if (new Set(r.ids).size === 180 && r.unscored.length === 10 && c('people') === 56 && c('process') === 70 && c('business') === 44 && new Set(fams).size === fams.length) out.ok++; else out.bad.push([c('people'), c('process'), c('business')].join('/'));
          out.v10 += scored.filter(q => q.id.startsWith('v10-')).length;
        }
        return out;
      });
      assert(mock.ok === 200, `200 simulacros: 180 únicas, 56/70/44 calificadas, 10 no puntuadas y sin familias repetidas (${mock.bad.slice(0, 3).join(', ')})`);
      assert(mock.v10 > 0, `las preguntas v10 entran a las calificadas (${(mock.v10 / 200).toFixed(1)} por simulacro en promedio)`);
    }
    /* La pregunta se ve y se califica en la práctica, con su insignia de tarea relacionada. */
    await page.evaluate(() => { location.hash = '#practica'; startQuiz(allQuestions().filter(q => q.id === 'v10-b36-001'), 1, 'aux'); });
    await page.waitForSelector('.hs-band');
    assert(!/Relacionada con/.test(await page.locator('.quiz-top').innerText()), 'antes de responder no se muestra la tarea relacionada (no da pistas)' + tag);
    await page.locator('.hs-band').nth(3).click(); await page.locator('button:has-text("Comprobar")').first().click();
    assert(/Relacionada con A\.3/.test(await page.locator('.quiz-top').innerText()), 'al responder se muestra «Relacionada con A.3»' + tag);
    const ok = await page.evaluate(() => state.attempts.at(-1));
    assert(ok.correct && ok.topicId === 'business-6', 'responderla registra el intento en su tarea oficial 3.6' + tag);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert(!overflow, 'sin desplazamiento horizontal' + tag);
    await ctx.close();
  }
  assert(!errors.length, 'sin errores de JavaScript ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
