// Prueba de certiFicate (portada, acceso, Face ID local y centro de certificaciones) con un doble de Supabase.
// No usa cuentas ni contraseñas reales. Face ID se simula con un autenticador virtual de WebAuthn (CDP).
const {chromium} = require('playwright');
const URL = 'http://localhost:8765/';
const results = []; const assert = (ok, m) => { results.push(ok); console.log((ok ? 'ok  ' : 'XX  ') + m); };
const lib = logged => `window.supabase={createClient(){let cb;return {auth:{onAuthStateChange(f){cb=f;setTimeout(()=>f('INITIAL_SESSION',${logged ? "{user:{id:'u1',email:'prueba@ejemplo.test'}}" : 'null'}),60);},
  signInWithPassword:async(a)=>{if(a.password!=='clave-de-prueba')return {error:{message:'Invalid login credentials'}};setTimeout(()=>cb('SIGNED_IN',{user:{id:'u1',email:a.email}}),10);return {error:null};},
  signInWithOtp:async()=>({error:null}),verifyOtp:async()=>({error:null}),signOut:async()=>{setTimeout(()=>cb('SIGNED_OUT',null),5);return {};}},
  from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null})}}}}}`;
async function ctxWith(browser, {logged = false, offline = false, width = 390} = {}) {
  const ctx = await browser.newContext({viewport: {width, height: 844}});
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', {get: () => false})); // activa la portada (las otras pruebas la omiten)
  await ctx.route(/supabase-js/, r => offline ? r.abort() : r.fulfill({contentType: 'application/javascript', body: lib(logged)}));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  return {ctx, page, errors};
}
const view = page => page.evaluate(() => window.certiFicate?.view);
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome'});
  {
    const {ctx, page, errors} = await ctxWith(browser);
    await page.goto(URL); await page.waitForTimeout(300);
    assert(await view(page) === 'splash' && await page.locator('.cf-splash .cf-logo').isVisible() && /certiFicate/.test(await page.locator('.cf-splash .cf-word').innerText()), 'lo primero es la portada con el logo y «certiFicate»');
    assert(await page.locator('.cf-splash .cf-word b').innerText() === 'F', 'la F del nombre va resaltada');
    await page.waitForTimeout(2600);
    await page.locator('.cf-splash').click(); await page.waitForTimeout(500);
    assert(await view(page) === 'auth' && await page.locator('#cf-login').isVisible(), 'un toque lleva al inicio de sesión (sin sesión)');
    assert(await page.locator('#main').evaluate(el => el.getBoundingClientRect().top >= 0) && await page.locator('#cf-shell').evaluate(el => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().height >= innerHeight - 1), 'la app de PMP queda tapada hasta iniciar sesión');
    await page.fill('#cf-login [name=email]', 'prueba@ejemplo.test'); await page.fill('#cf-login [name=pass]', 'otra'); await page.locator('#cf-login button').click(); await page.waitForTimeout(300);
    assert(/incorrectos/.test(await page.locator('.cf-msg').innerText()) && await view(page) === 'auth', 'con una contraseña incorrecta no entra y lo explica');
    await page.fill('#cf-login [name=pass]', 'clave-de-prueba'); await page.locator('#cf-login button').click(); await page.waitForTimeout(1200);
    assert(await view(page) === 'hub' && await page.evaluate(() => location.hash) === '#certificate', 'con la contraseña correcta muestra el centro de certificaciones');
    const progs = await page.locator('.cf-prog h2').allInnerTexts();
    assert(JSON.stringify(progs) === JSON.stringify(['PMP Exam Prep', 'Brevete', 'TOEFL iBT', 'Lean Construction']), 'programas en el orden pedido: ' + progs.join(' → '));
    const when = await page.locator('.cf-when').allInnerTexts();
    assert(/Enero\s*2027/.test(when[0]) && /Junio\s*2027/.test(when[1]) && /Diciembre\s*2027/.test(when[2]) && /Marzo\s*2028/.test(when[3]), 'fechas meta: ene 2027, jun 2027, dic 2027, mar 2028');
    assert(await page.locator('.cf-prog.ready [data-cf="pmp"]').count() === 1 && await page.locator('.cf-prog.soon [data-cf]').count() === 0 && await page.locator('.cf-prog.soon', {hasText: 'Aún no disponible'}).count() === 3, 'solo PMP Exam Prep es accesible; los otros dicen «Aún no disponible»');
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'el centro no se desborda a 390 px');
    await page.locator('[data-cf="pmp"]').click(); await page.waitForTimeout(500);
    assert(await view(page) === 'app' && await page.evaluate(() => location.hash) === '#inicio' && await page.locator('main h1').isVisible(), '«Entrar» abre PMP Exam Prep en su Inicio');
    await page.locator('.mobile-brand').click(); await page.waitForTimeout(300);
    assert(await view(page) === 'hub', 'el logo de la barra superior vuelve al centro');
    await page.goBack(); await page.waitForTimeout(300);
    assert(await view(page) === 'app', 'el botón Atrás regresa a PMP');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Con sesión guardada: Face ID (autenticador virtual) para volver a entrar en este dispositivo.
    const {ctx, page, errors} = await ctxWith(browser, {logged: true});
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable'); const {authenticatorId} = await cdp.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
    await page.goto(URL); await page.waitForTimeout(2900); await page.locator('.cf-splash').click(); await page.waitForTimeout(800);
    assert(await view(page) === 'hub', 'con la sesión iniciada, tras la portada pasa directo al centro');
    assert(await page.locator('.cf-bio [data-cf="bio-on"]').isVisible(), 'ofrece activar Face ID en este dispositivo');
    await page.locator('[data-cf="bio-on"]').click(); await page.waitForTimeout(800);
    assert(await page.evaluate(() => JSON.stringify(Object.keys(JSON.parse(localStorage.getItem('cf-bio'))))) === '["id"]' && /Face ID/.test(await page.locator('.cf-note').innerText()), 'Face ID queda activado (cf-bio guarda solo el identificador de la credencial, sin correo ni fecha)');
    assert(await page.locator('.cf-security summary').isVisible() && /no equivale a la seguridad de una app nativa/.test(await page.locator('.cf-security').textContent()), 'el centro explica qué protege Face ID (local) y qué protege la cuenta');
    const page2 = page; await page.evaluate(() => { sessionStorage.clear(); localStorage.setItem('sb-prueba-auth-token', '{"guardada":true}'); }); // nueva sesión en la misma pestaña, con sesión de Supabase guardada
    await page2.goto(URL + '#flashcards'); await page2.reload(); await page2.waitForTimeout(2900); await page2.locator('.cf-splash').click(); await page2.waitForTimeout(1000);
    const afterBio = [await view(page2), await page2.evaluate(() => location.hash)];
    assert(afterBio[0] === 'app' && afterBio[1] === '#flashcards', 'con Face ID activo, el mismo toque de la portada lanza Face ID y entra directo a la sección abierta (#flashcards) ' + JSON.stringify(afterBio));
    // Si Face ID falla, queda la pantalla para reintentar o usar la contraseña.
    await page2.evaluate(() => sessionStorage.clear()); await cdp.send('WebAuthn.setUserVerified', {authenticatorId, isUserVerified: false}); // Face ID rechazado
    await page2.reload(); await page2.waitForTimeout(2900); await page2.locator('.cf-splash').click(); await page2.waitForTimeout(1500);
    assert(await view(page2) === 'auth' && await page2.locator('[data-cf="bio"]').isVisible() && await page2.locator('[data-cf="use-pass"]').isVisible(), 'si Face ID no se puede verificar, ofrece reintentar o usar la contraseña');
    const lockTxt = await page2.locator('.cf-auth').innerText();
    assert(!lockTxt.includes('prueba@ejemplo.test') && /p•••@e•••/.test(lockTxt) && await page2.locator('.cf-auth [data-cf="logout"]').isVisible(), 'la pantalla bloqueada no muestra el correo completo y ofrece cerrar sesión');
    await page2.locator('[data-cf="bio"]').click(); await page2.waitForTimeout(600);
    assert(await view(page2) === 'auth' && /Inténtalo de nuevo|contraseña/.test(await page2.locator('.cf-msg').innerText()), 'un nuevo intento fallido de Face ID se explica y deja reintentar');
    await cdp.send('WebAuthn.setUserVerified', {authenticatorId, isUserVerified: true});
    await page2.evaluate(() => sessionStorage.setItem('cf-unlocked', '1')); await page2.reload(); await page2.waitForTimeout(3200); // recarga en la misma sesión: entra sin volver a pedir Face ID
    assert(await view(page2) === 'app', 'al recargar dentro de la misma sesión no vuelve a pedir Face ID');
    await page2.evaluate(() => certiFicate.hub()); await page2.waitForTimeout(300);
    page2.on('dialog', d => d.accept()); await page2.locator('[data-cf="logout"]').click(); await page2.waitForTimeout(500);
    const lo = [await view(page2), await page2.locator('#cf-login').count(), await page2.locator('.cf-hub [data-cf="logout"]').count()];
    assert(lo[0] === 'auth' && lo[1] === 1, 'cerrar sesión vuelve a la pantalla de acceso ' + JSON.stringify(lo));
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Sin servicio de acceso (sin internet): se puede seguir con lo guardado en el dispositivo.
    const {ctx, page, errors} = await ctxWith(browser, {offline: true});
    await page.goto(URL); await page.waitForTimeout(2900); await page.locator('.cf-splash').click(); await page.waitForTimeout(1500);
    assert(await page.locator('[data-cf="offline"]').isVisible(), 'sin conexión con el servicio, ofrece continuar con lo guardado');
    await page.locator('[data-cf="offline"]').click(); await page.waitForTimeout(300);
    assert(await view(page) === 'hub' && await page.locator('.cf-chip.off').count() === 1, 'y muestra el centro indicando «Sin sincronizar»');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Sin conexión y con Face ID activo: continuar con lo guardado exige verificar primero. cf-bio antiguo se limpia (solo id).
    const {ctx, page, errors} = await ctxWith(browser, {offline: true});
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('s')) { localStorage.setItem('cf-bio', JSON.stringify({id: 'AAAA', email: 'prueba@ejemplo.test', at: '2026-11-25'})); sessionStorage.setItem('s', '1'); } });
    await page.goto(URL); await page.waitForTimeout(2900); await page.locator('.cf-splash').click(); await page.waitForTimeout(1500);
    await page.locator('[data-cf="offline"]').click(); await page.waitForTimeout(800);
    assert(await view(page) === 'auth' && /Face ID/.test(await page.locator('.cf-msg').innerText()), 'sin conexión y con Face ID activo, pide Face ID y no se salta el bloqueo');
    assert(await page.evaluate(() => localStorage.getItem('cf-bio')) === '{"id":"AAAA"}', 'un cf-bio antiguo con correo y fecha queda reducido al identificador');
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Progreso aislado por cuenta: si entra otra cuenta en el dispositivo, lo local de la anterior no se mezcla ni se sube.
    const ctx = await browser.newContext(); await ctx.route(/supabase-js/, r => r.fulfill({contentType: 'application/javascript', body: lib(true).replace("from(){", "from(){window.__ups=window.__ups||[];const self={select(){return self},eq(){return self},maybeSingle:async()=>({data:null,error:null}),upsert:async(r)=>{window.__ups.push(r);return {error:null}}};return self;},_x(){")}));
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { localStorage.setItem('pmp-master-plan-2027-v1', JSON.stringify({version: 1, topics: {}, attendance: {}, notes: [], errors: [], mocks: [], attempts: [{id: 'a-otra', questionId: 'q01', module: 'people', topicId: 'people-1', approach: 'Ágil', selected: [0], correct: true, date: '2026-11-20T10:00:00-05:00'}], questions: [], studySessions: [], settings: {examDate: '', examConfirmed: false, reminderTime: '07:30', dailyMinutes: 45}, tasksDone: {}, cards: {}, cardLog: []})); localStorage.setItem('pmp-sync-owner', 'u0'); sessionStorage.setItem('s', '1'); } });
    await page.goto(URL + '#inicio'); await page.waitForTimeout(1800);
    const iso = await page.evaluate(() => ({att: PMPApp.getState().attempts.length, backup: JSON.parse(localStorage.getItem('pmp-backup-u0') || 'null')?.attempts?.length, owner: localStorage.getItem('pmp-sync-owner'), up: (window.__ups || []).map(r => r.user_id + ':' + r.state.attempts.length)}));
    assert(iso.att === 0 && iso.backup === 1 && iso.owner === 'u1' && iso.up.every(x => x === 'u1:0'), 'al entrar otra cuenta, el progreso de la anterior queda aparte y no se sube a la nueva ' + JSON.stringify(iso));
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Las pruebas automáticas (navigator.webdriver) entran directo a PMP, como antes.
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(URL + '#inicio'); await page.waitForTimeout(1200);
    assert(await page.evaluate(() => window.certiFicate.view) === 'app' && await page.locator('main h1').isVisible(), 'en pruebas automáticas no hay portada (el resto de las suites no cambia)');
    await ctx.close();
  }
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
