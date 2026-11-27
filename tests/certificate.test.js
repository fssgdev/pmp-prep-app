// Prueba de certiFicate (portada, acceso, Face ID local y centro de certificaciones) con un doble de Supabase.
// No usa cuentas ni contraseñas reales. Face ID se simula con un autenticador virtual de WebAuthn (CDP).
const {chromium} = require('playwright');
const URL = 'http://localhost:8765/';
const results = []; const assert = (ok, m) => { results.push(ok); console.log((ok ? 'ok  ' : 'XX  ') + m); };
const lib = logged => `window.supabase={createClient(){let cb;return {auth:{onAuthStateChange(f){cb=f;setTimeout(()=>f('INITIAL_SESSION',${logged ? "{user:{id:'u1',email:'prueba@ejemplo.test'}}" : 'null'}),60);},
  signInWithPassword:async(a)=>{if(a.password!=='clave-de-prueba')return {error:{message:'Invalid login credentials'}};setTimeout(()=>cb('SIGNED_IN',{user:{id:'u1',email:a.email}}),10);return {error:null};},
  signInWithOtp:async(a)=>{(window.__otp=window.__otp||[]).push(['send',a.email,a.options&&a.options.shouldCreateUser]);return {error:null};},
  verifyOtp:async(a)=>{(window.__otp=window.__otp||[]).push(['verify',a.token_hash,a.type]);if(a.token_hash!=='enlace-sintetico-123')return {error:{message:'Token has expired or is invalid'}};setTimeout(()=>cb('SIGNED_IN',{user:{id:'u1',email:'prueba@ejemplo.test'}}),10);return {error:null};},signOut:async()=>{setTimeout(()=>cb('SIGNED_OUT',null),5);return {};}},
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
    // #10: detrás del portal, PMP no está en el árbol de accesibilidad ni en la navegación con teclado.
    const inertAll = () => page.evaluate(() => [...document.body.children].filter(el => el.id !== 'cf-shell' && el.tagName !== 'SCRIPT').every(el => el.inert));
    assert(await inertAll(), 'mientras se muestra el acceso, todo el contenido de PMP queda inerte');
    const aria = await page.locator('body').ariaSnapshot();
    assert(/Inicia sesión/.test(aria) && !/MI PREPARACIÓN|Ir al contenido|Navegación principal|Centro de control|Guía de uso/i.test(aria), 'el árbol accesible solo contiene la vista de acceso');
    const tabs = []; for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); tabs.push(await page.evaluate(() => { const a = document.activeElement; return document.getElementById('cf-shell').contains(a) ? 'cf' : a === document.body || !a ? 'navegador' : 'PMP:' + (a.id || a.className || a.tagName); })); }
    assert(!tabs.some(t => t.startsWith('PMP')) && tabs.filter(t => t === 'cf').length >= 8, 'con Tab el foco recorre solo la vista de acceso, nunca PMP (14 pulsaciones) ' + JSON.stringify([...new Set(tabs)]));
    const ax = await (await page.context().newCDPSession(page)).send('Accessibility.getFullAXTree');
    const axNames = ax.nodes.filter(n => !n.ignored).map(n => n.name?.value || '').join(' | ');
    assert(/Inicia sesión/.test(axNames) && !/Tu día de estudio|Centro de control|Ir al contenido|Guía de uso/.test(axNames), 'el árbol de accesibilidad real de Chrome (CDP) tampoco expone PMP');
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
    const restored = await page.evaluate(() => ({inert: [...document.body.children].filter(el => el.inert).length, focus: document.activeElement?.id}));
    assert(restored.inert === 0 && restored.focus === 'main', 'al entrar a PMP se restaura el contenido (nada inerte) y el foco pasa a la vista principal ' + JSON.stringify(restored));
    assert(/Tu día de estudio/.test(await page.locator('body').ariaSnapshot()), 'y PMP vuelve a estar en el árbol accesible');
    await page.locator('.mobile-brand').click(); await page.waitForTimeout(300);
    assert(await view(page) === 'hub', 'el logo de la barra superior vuelve al centro');
    assert(await inertAll() && await page.evaluate(() => document.getElementById('cf-shell').contains(document.activeElement)), 'en el centro, PMP vuelve a quedar inerte y el foco está en el centro');
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
    // Acceso completo por enlace (respaldo), sin enviar correos: el doble entrega una sesión sintética al verificar el token.
    const {ctx, page, errors} = await ctxWith(browser);
    await page.goto(URL + '#flashcards'); await page.waitForTimeout(2900); await page.locator('.cf-splash').click(); await page.waitForTimeout(500);
    await page.fill('#cf-login [name=email]', 'prueba@ejemplo.test'); await page.locator('.cf-alt summary').click();
    await page.locator('[data-cf="link-send"]').click(); await page.waitForTimeout(300);
    assert(/Enlace enviado/.test(await page.locator('.cf-msg').innerText()) && JSON.stringify(await page.evaluate(() => window.__otp[0])) === '["send","prueba@ejemplo.test",false]', '«Enviar enlace» pide el enlace sin crear cuentas nuevas (doble, sin correo real)');
    await page.fill('#cf-paste [name=link]', 'https://ejemplo.supabase.co/auth/v1/verify?token=pkce_vencido-999&type=magiclink'); await page.locator('#cf-paste button').click(); await page.waitForTimeout(400);
    assert(await view(page) === 'auth' && /venció/.test(await page.locator('.cf-msg').innerText()) && await page.evaluate(() => !window.PMPSync.user), 'un enlace vencido no entra y lo explica');
    const wrapped = 'https://www.google.com/url?q=' + encodeURIComponent('https://ejemplo.supabase.co/auth/v1/verify?token=pkce_enlace-sintetico-123&type=magiclink&redirect_to=x');
    await page.fill('#cf-paste [name=link]', wrapped); await page.locator('#cf-paste button').click(); await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({v: certiFicate.view, hash: location.hash, user: PMPSync.user?.id, last: window.__otp.at(-1), inert: [...document.body.children].filter(el => el.inert).length}));
    assert(st.user === 'u1' && st.last[1] === 'enlace-sintetico-123' && st.v === 'app' && st.hash === '#flashcards' && st.inert === 0, 'un enlace válido (incluso envuelto por el correo) inicia la sesión sintética y entra a la sección abierta ' + JSON.stringify(st));
    assert(errors.length === 0, 'sin errores de JavaScript ' + JSON.stringify(errors));
    await ctx.close();
  }
  {
    // Operaciones de sincronización atadas a su sesión: una lectura en curso de la cuenta u1 no se aplica ni se sube si entra otra cuenta
    // o se cierra la sesión mientras espera a la red; un guardado pendiente se descarta al cambiar de cuenta.
    const remoteU1 = {version: 1, topics: {}, attendance: {}, notes: [], errors: [], mocks: [], attempts: [{id: 'a-nube-u1', questionId: 'q01', module: 'people', topicId: 'people-1', approach: 'Ágil', selected: [0], correct: true, date: '2026-11-20T10:00:00-05:00'}], questions: [], studySessions: [], settings: {examDate: '', examConfirmed: false, reminderTime: '07:30', dailyMinutes: 45}, tasksDone: {}, cards: {}, cardLog: []};
    const slowLib = `window.supabase={createClient(){let cb;return {auth:{onAuthStateChange(f){cb=f;window.__auth=(e,u)=>f(e,u?{user:u}:null);setTimeout(()=>f('INITIAL_SESSION',{user:{id:'u1',email:'prueba@ejemplo.test'}}),60);},signOut:async()=>{cb('SIGNED_OUT',null);return {};}},
      from(){let who;const self={select(){return self},eq(k,v){who=v;return self},maybeSingle:async()=>{const w=who;(window.__reads=window.__reads||[]).push(w);await new Promise(r=>setTimeout(r,window.__delay||0));return {data:w==='u1'?{state:${JSON.stringify(remoteU1)},updated_at:'2026-11-20T15:00:00.000Z'}:null,error:null};},upsert:async(r)=>{(window.__ups=window.__ups||[]).push({uid:r.user_id,ids:r.state.attempts.map(a=>a.id),t:Date.now()});return {error:null};}};return self;}}}}`;
    const ctx = await browser.newContext(); await ctx.route(/supabase-js/, r => r.fulfill({contentType: 'application/javascript', body: slowLib}));
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.__delay = 700; });
    await page.goto(URL + '#inicio'); await page.waitForFunction(() => (window.__reads || []).includes('u1')); await page.waitForTimeout(100); // la lectura inicial de u1 sigue en curso (700 ms)
    await page.evaluate(() => window.__auth('SIGNED_IN', {id: 'u2', email: 'otra@ejemplo.test'}));
    await page.waitForTimeout(1600);
    const sw = await page.evaluate(() => ({local: PMPApp.getState().attempts.map(a => a.id), ups: window.__ups || [], owner: localStorage.getItem('pmp-sync-owner'), user: PMPSync.user?.id}));
    assert(sw.user === 'u2' && !sw.local.includes('a-nube-u1') && sw.ups.every(u => u.uid === 'u2' && !u.ids.includes('a-nube-u1')) && sw.owner === 'u2', 'una lectura en curso de u1 no se fusiona en la cuenta u2 ni se sube con otro user_id ' + JSON.stringify(sw));
    // Guardado pendiente de u2 y cierre de sesión antes de que se envíe: no se sube nada después.
    await page.evaluate(() => { window.__ups = []; window.__delay = 0; const s = PMPApp.getState(); s.attempts.push({id: 'a-local-u2', questionId: 'q02', module: 'people', topicId: 'people-1', approach: 'Ágil', selected: [1], correct: false, date: '2026-11-27T10:00:00-05:00'}); PMPApp.setState(s); PMPSync.schedulePush(); });
    await page.evaluate(() => window.__auth('SIGNED_OUT', null)); await page.waitForTimeout(2200);
    const lo = await page.evaluate(() => ({ups: window.__ups, label: document.getElementById('save-state').textContent}));
    assert(lo.ups.length === 0 && /Sin sincronizar/.test(lo.label), 'un guardado pendiente no se envía tras cerrar la sesión ' + JSON.stringify(lo));
    // Lectura en curso y cierre de sesión durante la espera: no se aplica ni se sube.
    await page.evaluate(() => { window.__delay = 700; window.__auth('SIGNED_IN', {id: 'u1', email: 'prueba@ejemplo.test'}); }); await page.waitForTimeout(200);
    await page.evaluate(() => window.__auth('SIGNED_OUT', null)); await page.waitForTimeout(1200);
    const lo2 = await page.evaluate(() => ({ups: window.__ups, local: PMPApp.getState().attempts.map(a => a.id), label: document.getElementById('save-state').textContent}));
    assert(lo2.ups.length === 0 && !lo2.local.includes('a-nube-u1') && !/Sin conexión/.test(lo2.label), 'una lectura en curso no se aplica ni se sube si la sesión se cierra mientras espera ' + JSON.stringify(lo2));
    // Control: con la sesión estable, la misma lectura sí se aplica (la prueba no pasa por no sincronizar nunca).
    await page.evaluate(() => { window.__delay = 50; window.__auth('SIGNED_IN', {id: 'u1', email: 'prueba@ejemplo.test'}); }); await page.waitForTimeout(1500);
    assert(await page.evaluate(() => PMPApp.getState().attempts.some(a => a.id === 'a-nube-u1')), 'control: con la sesión estable, el progreso de la nube de u1 sí llega');
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
