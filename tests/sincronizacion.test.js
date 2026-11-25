// Prueba de sincronización entre dos dispositivos con el mismo método de la app (js/sync.js):
// la librería de Supabase se sustituye por un doble de prueba que guarda la fila `progress`
// en memoria (un solo "servidor" compartido por los dos navegadores). No se usan claves ni cuentas reales.
const {chromium} = require('playwright');
const fs = require('fs');
const URL = 'http://localhost:8765/';
const OLD = process.argv[2] === 'old' ? fs.readFileSync(process.argv[3], 'utf8') : null;
const results = []; const log = (ok, m) => { results.push([ok, m]); console.log((ok ? 'ok  ' : 'XX  ') + m); };
let row = null; const offline = {};
const FAKE = `window.supabase={createClient(){const dev=localStorage.getItem('dev');const api=(m,b)=>fetch('https://fake-supabase.test/progress?dev='+dev,{method:m,body:b?JSON.stringify(b):undefined}).then(async r=>{if(!r.ok)return {data:null,error:{message:'sin conexión ('+r.status+')'}};return {data:await r.json(),error:null};});
const q={select(){return q},eq(){return q},maybeSingle(){return api('GET')},upsert(row){return api('POST',row)}};
return {auth:{onAuthStateChange(cb){setTimeout(()=>cb('SIGNED_IN',{user:{id:'u-prueba',email:'prueba@ejemplo.test'}}),50);return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({})},from(){return q}};}};`;
async function device(browser, name) {
  const ctx = await browser.newContext({viewport: {width: 1200, height: 900}});
  await ctx.addInitScript(n => localStorage.setItem('dev', n), name);
  await ctx.route(/supabase-js/, r => r.fulfill({contentType: 'application/javascript', body: FAKE}));
  if (OLD) await ctx.route(/js\/sync\.js/, r => r.fulfill({contentType: 'application/javascript', body: OLD}));
  await ctx.route('https://fake-supabase.test/**', async r => {
    if (offline[name]) return r.fulfill({status: 503, body: '{}'});
    if (r.request().method() === 'GET') return r.fulfill({contentType: 'application/json', body: JSON.stringify(row)});
    const b = JSON.parse(r.request().postData()); row = {state: b.state, updated_at: b.updated_at}; return r.fulfill({contentType: 'application/json', body: '{}'});
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL + '#inicio'); await page.waitForFunction(() => typeof MOCK_ACTIONS !== 'undefined');
  await page.waitForTimeout(2500);
  return {page, errors, name};
}
const answer = (page, n, wrongEvery) => page.evaluate(([n, w]) => {
  startQuiz(allQuestions(), n, 'Prueba de sincronización', true);
  for (let i = 0; i < n; i++) { const q = quizQuestion(); const ok = (i + 1) % w !== 0; state.quiz.selected = ok ? [...q.correct] : q.type === 'match' ? q.correct.map(c => (c + 1) % q.options.length) : q.type === 'dropdown' ? q.correct.map((c, j) => (c + 1) % q.choices[j].length) : q.type === 'hotspot' ? [q.correct[0] === 0 ? 1 : 0] : [q.options.findIndex((_, k) => !q.correct.includes(k))]; checkAnswer(); actions['next-question'](); }
}, [n, wrongEvery]);
const grade = (page, n) => page.evaluate(n => { location.hash = 'flashcards'; cardQueue = buildQueue(); for (let i = 0; i < n; i++) { cardRevealed = true; gradeCard('good'); } }, n);
const snap = page => page.evaluate(() => ({attempts: state.attempts.map(a => a.id).sort(), errors: state.errors.map(e => e.id).sort(), notes: state.notes.map(e => e.id).sort(), mocks: state.mocks.map(e => e.id).sort(), cards: Object.keys(state.cards).sort(), cardLog: state.cardLog.length, tasks: Object.keys(state.tasksDone).sort(), act7: JSON.stringify(activity7()), due: cardsDueCount()}));
const syncNow = async d => { await d.page.evaluate(() => document.querySelector('[data-action="settings"]')?.click()); await d.page.evaluate(() => { const b = document.querySelector('[data-sync="now"]'); if (b) b.click(); }); await d.page.waitForTimeout(2500); };
(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
  const A = await device(browser, 'A');
  await answer(A.page, 4, 4); await A.page.waitForTimeout(2500);
  const B = await device(browser, 'B');
  const a0 = await snap(A.page), b0 = await snap(B.page);
  log(JSON.stringify(a0.attempts) === JSON.stringify(b0.attempts) && a0.attempts.length === 4, `B recibe los 4 intentos iniciales de A (${b0.attempts.length})`);
  // Trabajo concurrente: A sin conexión, B en línea.
  offline.A = true;
  await answer(A.page, 3, 3); await grade(A.page, 2);
  await A.page.evaluate(() => { markTask(buildPlan()[0].id, true); state.notes.unshift({id: 'nota-A', title: 'Nota de A', body: 'creada sin conexión', topicId: '', updated: stamp()}); save(); });
  await answer(B.page, 2, 2); await grade(B.page, 3);
  await B.page.evaluate(() => { state.mocks.push({id: 'mock-B', name: 'Externo B', date: today(), correct: 120, total: 180, minutes: 230, realistic: true}); save(); });
  await A.page.waitForTimeout(2500); await B.page.waitForTimeout(2500);
  const aOff = await snap(A.page), bOn = await snap(B.page);
  offline.A = false;
  await syncNow(A); await syncNow(B); await syncNow(A);
  const a1 = await snap(A.page), b1 = await snap(B.page), cloud = row.state;
  const expAtt = new Set([...aOff.attempts, ...bOn.attempts]);
  log(a1.attempts.length === expAtt.size && b1.attempts.length === expAtt.size, `intentos: A=${a1.attempts.length}, B=${b1.attempts.length}, esperados ${expAtt.size} (4 + 3 de A sin conexión + 2 de B)`);
  log(new Set(a1.attempts).size === a1.attempts.length && cloud.attempts.length === expAtt.size, `sin intentos duplicados (nube: ${cloud.attempts.length})`);
  log(JSON.stringify(a1.errors) === JSON.stringify(b1.errors) && a1.errors.length === new Set([...aOff.errors, ...bOn.errors]).size, `registro de errores igual en ambos (${a1.errors.length})`);
  log(JSON.stringify(a1.cards) === JSON.stringify(b1.cards) && a1.cardLog === b1.cardLog && a1.cardLog === aOff.cardLog + bOn.cardLog - a0.cardLog, `tarjetas: ${a1.cards.length} con estado; historial ${a1.cardLog} repasos (2 de A + 3 de B)`);
  log(JSON.stringify(a1.tasks) === JSON.stringify(b1.tasks) && b1.tasks.length >= aOff.tasks.length, `actividades hechas iguales (${a1.tasks.length})`);
  log(a1.notes.includes('nota-A') && b1.notes.includes('nota-A'), 'la nota creada sin conexión en A llega a B');
  log(a1.mocks.includes('mock-B') && b1.mocks.includes('mock-B'), 'el simulacro registrado en B llega a A');
  log(a1.act7 === b1.act7 && a1.due === b1.due, `métricas del panel iguales (actividad 7 días y tarjetas por repasar: ${a1.due})`);
  // Rutina diaria (issue #6): A corrige la lección de la semana sin conexión; B genera el Bullet Quiz del día.
  offline.A = true;
  await A.page.evaluate(() => { ensureRoutine().override[weekStart()] = 4; save(); });
  const bIds = await B.page.evaluate(() => { const b = bulletToday(); save(); return b.ids; });
  await A.page.waitForTimeout(2500); await B.page.waitForTimeout(2500);
  offline.A = false;
  await syncNow(A); await syncNow(B); await syncNow(A);
  const rA = await A.page.evaluate(() => state.routine), rB = await B.page.evaluate(() => state.routine);
  log(rA.override[Object.keys(rA.override)[0]] === 4 && JSON.stringify(rA.override) === JSON.stringify(rB.override), 'la lección corregida en A sin conexión llega a B');
  log(JSON.stringify(rA.days) === JSON.stringify(rB.days) && JSON.stringify(Object.values(rB.days)[0].ids) === JSON.stringify(bIds), 'la selección del Bullet Quiz del día es la misma en A y B, sin duplicarse');
  log(JSON.stringify(rA.seen) === JSON.stringify(rB.seen), 'el ciclo de preguntas vistas coincide en ambos');
  // Con la lección corregida, el quiz de hoy (aún sin empezar) se regenera en un dispositivo y ambos convergen.
  await A.page.evaluate(() => { bulletToday(); save(); }); await A.page.waitForTimeout(2500);
  await syncNow(B); await B.page.evaluate(() => { bulletToday(); save(); }); await B.page.waitForTimeout(2500); await syncNow(A);
  const cA = await A.page.evaluate(() => state.routine.days[today()]), cB = await B.page.evaluate(() => state.routine.days[today()]);
  log(cA.lesson === 4 && cB.lesson === 4 && JSON.stringify(cA.ids) === JSON.stringify(cB.ids), `tras corregir la lección, ambos muestran el mismo Bullet Quiz de la lección ${cA.lesson}`);
  // Borrado: B elimina la nota; no debe reaparecer al sincronizar A.
  await B.page.evaluate(() => { actions['confirm-delete']({dataset: {id: 'nota-A', type: 'notes'}}); }); await B.page.waitForTimeout(2500);
  await syncNow(A); await A.page.evaluate(() => { save(); }); await A.page.waitForTimeout(2500); await syncNow(B);
  const a2 = await snap(A.page), b2 = await snap(B.page);
  log(!a2.notes.includes('nota-A') && !b2.notes.includes('nota-A') && !row.state.notes.some(n => n.id === 'nota-A'), 'una nota borrada en B no reaparece en A ni en la nube');
  log(A.errors.length + B.errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify([...A.errors, ...B.errors]));
  await browser.close();
  process.exit(results.every(r => r[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
