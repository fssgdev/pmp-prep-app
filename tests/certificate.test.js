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
    await cdp.send('WebAuthn.enable'); await cdp.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
    await page.goto(URL); await page.waitForTimeout(2900); await page.locator('.cf-splash').click(); await page.waitForTimeout(800);
    assert(await view(page) === 'hub', 'con la sesión iniciada, tras la portada pasa directo al centro');
    assert(await page.locator('.cf-bio [data-cf="bio-on"]').isVisible(), 'ofrece activar Face ID en este dispositivo');
    await page.locator('[data-cf="bio-on"]').click(); await page.waitForTimeout(800);
    assert(await page.evaluate(() => !!localStorage.getItem('cf-bio')) && /Face ID/.test(await page.locator('.cf-note').innerText()), 'Face ID queda activado (solo se guarda el identificador de la credencial)');
    const page2 = page; await page.evaluate(() => sessionStorage.clear()); // nueva sesión en la misma pestaña (el autenticador virtual es de esta pestaña)
    await page2.goto(URL + '#flashcards'); await page2.reload(); await page2.waitForTimeout(2900); await page2.locator('.cf-splash').click(); await page2.waitForTimeout(600);
    const lockOk = await view(page2) === 'auth' && await page2.locator('[data-cf="bio"]').isVisible();
    assert(lockOk, 'en una nueva sesión pide Face ID antes de entrar');
    assert(await page2.locator('[data-cf="use-pass"]').isVisible(), 'siempre se puede usar la contraseña en lugar de Face ID');
    await page2.locator('[data-cf="bio"]').click(); await page2.waitForTimeout(800);
    const afterBio = [await view(page2), await page2.evaluate(() => location.hash)];
    assert(afterBio[0] === 'app' && afterBio[1] === '#flashcards', 'con Face ID entra directo a la sección que se abrió (#flashcards) ' + JSON.stringify(afterBio));
    await page2.evaluate(() => certiFicate.hub()); await page2.waitForTimeout(300);
    page2.on('dialog', d => d.accept()); await page2.locator('[data-cf="logout"]').click(); await page2.waitForTimeout(500);
    assert(await view(page2) === 'auth' && await page2.locator('#cf-login').isVisible(), 'cerrar sesión vuelve a la pantalla de acceso');
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
    // Las pruebas automáticas (navigator.webdriver) entran directo a PMP, como antes.
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(URL + '#inicio'); await page.waitForTimeout(1200);
    assert(await page.evaluate(() => window.certiFicate.view) === 'app' && await page.locator('main h1').isVisible(), 'en pruebas automáticas no hay portada (el resto de las suites no cambia)');
    await ctx.close();
  }
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
