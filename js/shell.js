'use strict';
/* certiFicate: portada animada, acceso y centro de certificaciones (pedido de Fabrizio, 25/11).
   - Portada: logo con animación breve (preparación → sello de certificación). Un toque continúa.
   - Acceso: cuenta de Supabase (correo + contraseña, o enlace por correo como respaldo). La contraseña no se guarda en el código:
     se crea desde Ajustes → Sincronización con la sesión iniciada.
   - Face ID / huella: bloqueo local con WebAuthn (autenticador de la plataforma). Es una comodidad para volver a entrar en este
     dispositivo; la protección de los datos en la nube la da la sesión de Supabase.
   - Centro: programas en orden (PMP ene 2027, Brevete jun 2027, TOEFL iBT dic 2027, Lean Construction mar 2028); solo PMP está disponible.
   El resto de la app (PMP Exam Prep) no cambia: sus rutas (#inicio, #flashcards, …) siguen igual y #certificate muestra el centro. */
(() => {
  const AUTO = navigator.webdriver === true; // pruebas automáticas: sin portada ni acceso (la prueba de certiFicate lo desactiva)
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const store = {get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} }};
  const sess = {get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }};
  const HUB = 'certificate';
  const PROGRAMS = [
    {id: 'pmp', name: 'PMP Exam Prep', cert: 'Project Management Professional · PMI', when: 'Enero 2027', ready: true, icon: 'target'},
    {id: 'brevete', name: 'Brevete', cert: 'Licencia de conducir · MTC', when: 'Junio 2027', icon: 'wheel'},
    {id: 'toefl', name: 'TOEFL iBT', cert: 'Inglés académico · ETS', when: 'Diciembre 2027', icon: 'talk'},
    {id: 'lean', name: 'Lean Construction', cert: 'Construcción sin pérdidas', when: 'Marzo 2028', icon: 'flow'}
  ];
  const ICONS = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M15 9l5-5M17 4h3v3"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 14.5V21M9.6 12.6 3.4 14M14.4 12.6l6.2 1.4"/>',
    talk: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9.5h3M8 12h6M14.5 8.5l1.8 4M18.1 8.5l-1.8 4M15.2 11h2.4"/>',
    flow: '<path d="M3 17h4l3-8 4 6 3-4h4"/><path d="M18 9l3 2-3 2"/><circle cx="7" cy="17" r="1.3" fill="currentColor"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1M15 9v1M12 9v4h-1M9.5 15.5c1.5 1.2 3.5 1.2 5 0"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  const ico = (n, cls = '') => `<svg class="cf-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  const ROSETTE = 'M60.00 20.50 Q67.36 14.24 72.14 22.64 Q81.20 19.28 82.82 28.81 Q92.48 28.75 90.74 38.25 Q99.84 41.50 94.96 49.84 Q102.40 56.00 94.96 62.16 Q99.84 70.50 90.74 73.75 Q92.48 83.25 82.82 83.19 Q81.20 92.72 72.14 89.36 Q67.36 97.76 60.00 91.50 Q52.64 97.76 47.86 89.36 Q38.80 92.72 37.18 83.19 Q27.52 83.25 29.26 73.75 Q20.16 70.50 25.04 62.16 Q17.60 56.00 25.04 49.84 Q20.16 41.50 29.26 38.25 Q27.52 28.75 37.18 28.81 Q38.80 19.28 47.86 22.64 Q52.64 14.24 60.00 20.50Z';
  const logo = (cls = '') => `<svg class="cf-logo ${cls}" viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="cfG-${cls || 'x'}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#f2b84b"/><stop offset="1" stop-color="#d9902a"/></linearGradient>
    <linearGradient id="cfI-${cls || 'x'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2d6e"/><stop offset="1" stop-color="#15173f"/></linearGradient></defs>
    <g class="cf-ribbons"><path d="M44 84 L36 112 L46 106 L52 114 L58 88Z" fill="#c9792a"/><path d="M76 84 L84 112 L74 106 L68 114 L62 88Z" fill="#e39a3a"/></g>
    <g class="cf-seal"><path d="${ROSETTE}" fill="url(#cfG-${cls || 'x'})"/><circle cx="60" cy="56" r="29" fill="url(#cfI-${cls || 'x'})"/>
    <circle cx="60" cy="56" r="25.5" fill="none" stroke="#f2b84b" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 3"/></g>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round"><path class="cf-f1" pathLength="1" d="M50 74 V40 H72" stroke="#fff" stroke-width="6.5"/><path class="cf-f2" pathLength="1" d="M50 56 H64" stroke="#fff" stroke-width="6.5"/>
    <path class="cf-check" pathLength="1" d="M60 70 L65.5 75.5 L76 63" stroke="url(#cfG-${cls || 'x'})" stroke-width="5.5"/></g></svg>`;
  const word = (cls = '') => `<span class="cf-word ${cls}">certi<b>F</b>icate</span>`;

  /* ---------- WebAuthn local (Face ID / Touch ID / huella) ---------- */
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const bio = () => { try { return JSON.parse(store.get('cf-bio') || 'null'); } catch { return null; } };
  async function bioAvailable() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; } }
  async function bioEnable(email) {
    const cred = await navigator.credentials.create({publicKey: {challenge: rand(32), rp: {name: 'certiFicate', id: location.hostname}, user: {id: rand(16), name: email || 'certificate', displayName: email || 'certiFicate'},
      pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}], authenticatorSelection: {authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred'}, timeout: 60000}});
    store.set('cf-bio', JSON.stringify({id: b64(cred.rawId), email: email || '', at: new Date().toISOString()}));
  }
  async function bioCheck() {
    const b = bio(); if (!b) return false;
    const a = await navigator.credentials.get({publicKey: {challenge: rand(32), rpId: location.hostname, allowCredentials: [{type: 'public-key', id: unb64(b.id), transports: ['internal', 'hybrid']}], userVerification: 'required', timeout: 60000}});
    return !!a && b64(a.rawId) === b.id;
  }

  /* ---------- estructura ---------- */
  const root = document.createElement('div');
  root.id = 'cf-shell'; root.className = 'cf';
  root.innerHTML = `<section class="cf-view cf-splash" data-view="splash" aria-label="certiFicate">
      <div class="cf-sky" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="cf-stage">
        <svg class="cf-steps" viewBox="0 0 240 120" aria-hidden="true"><path pathLength="1" d="M10 110 H60 V85 H110 V60 H160 V35 H230" fill="none" stroke="#8f95ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".55"/></svg>
        ${logo('splash')}
        <div class="cf-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      ${word('big')}
      <p class="cf-tag">Prepárate · Practica · <b>Certifícate</b></p>
      <button class="cf-tap" type="button">Toca para continuar</button>
    </section>
    <section class="cf-view cf-auth" data-view="auth" aria-label="Acceso"></section>
    <section class="cf-view cf-hub" data-view="hub" aria-label="Tus certificaciones"></section>`;
  document.body.prepend(root);
  document.documentElement.classList.add('cf-on');

  let unlocked = AUTO || sess.get('cf-unlocked') === '1', splashDone = false, wantPast = false;
  const startHash = location.hash.slice(1).split('/')[0];
  const show = view => { root.dataset.view = view; root.hidden = false; document.documentElement.classList.add('cf-on'); window.scrollTo(0, 0); };
  const hide = () => { root.hidden = true; document.documentElement.classList.remove('cf-on'); };
  const goPmp = (route = 'inicio') => { hide(); if (location.hash.slice(1) !== route) location.hash = route; else window.PMPApp?.render?.(); };
  const unlock = () => { unlocked = true; sess.set('cf-unlocked', '1'); if (startHash && startHash !== HUB && !wantPast) { wantPast = true; goPmp(location.hash.slice(1) || 'inicio'); } else hub(); };
  const syncReady = () => (window.PMPSync?.ready || Promise.resolve(null));
  const waitSync = () => new Promise(res => { const t0 = Date.now(); const tick = () => window.PMPSync?.ready ? res(syncReady()) : Date.now() - t0 > 9000 ? res(null) : setTimeout(tick, 50); tick(); });

  if (AUTO) { hide(); root.dataset.view = 'hub'; }
  else {
    show('splash');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { splashDone = true; root.classList.add('cf-ready'); if (unlocked) proceed(); }, reduce ? 300 : 2600);
  }

  // ¿Hay una sesión de Supabase guardada en este navegador? (para lanzar Face ID sin esperar a la red)
  const storedSession = () => { try { return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)); } catch { return false; } };
  async function proceed(bioTry = null) {
    if (root.dataset.view !== 'splash' || root.classList.contains('cf-busy')) return;
    root.classList.add('cf-busy');
    const user = await waitSync();
    root.classList.remove('cf-busy');
    if (unlocked && (user || !window.PMPSync?.client)) return unlock();
    if (user && bio()) {
      if (bioTry) {
        // Mientras Face ID responde se muestra la pantalla de acceso (con reintento y contraseña) en lugar de esperar en la portada.
        lockScreen(user); msg('Verificando con Face ID…', false);
        const ok = await bioTry.catch(() => false);
        if (root.dataset.view !== 'auth' || !root.querySelector('[data-cf="bio"]')) return; // el usuario ya eligió otra opción
        if (ok) return unlock();
        msg('No se pudo verificar con Face ID. Vuelve a intentarlo o usa tu contraseña.', true); return;
      }
      return lockScreen(user);
    }
    if (user) return unlock();
    login();
  }
  // Fluidez (26/11): con Face ID activo y sesión guardada, el mismo toque de la portada abre Face ID
  // (debe llamarse dentro del gesto del usuario; iOS no lo permite después de una espera).
  root.querySelector('.cf-splash').addEventListener('click', () => {
    if (!splashDone) { splashDone = true; root.classList.add('cf-ready', 'cf-skip'); }
    const bioTry = !unlocked && bio() && storedSession() && root.dataset.view === 'splash' && !root.classList.contains('cf-busy') ? bioCheck() : null;
    proceed(bioTry);
  });
  document.addEventListener('keydown', ev => { if (!root.hidden && root.dataset.view === 'splash' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); root.querySelector('.cf-splash').click(); } });

  /* ---------- acceso ---------- */
  function authFrame(inner) {
    root.querySelector('.cf-auth').innerHTML = `<div class="cf-card">${logo('mini')}${word()}${inner}</div><p class="cf-foot">Tus datos se guardan cifrados en tu cuenta y en este dispositivo.</p>`;
    show('auth');
  }
  const msg = (text, bad) => { const m = root.querySelector('.cf-msg'); if (m) { m.textContent = text; m.className = 'cf-msg ' + (bad ? 'bad' : 'ok'); } };
  const NET = /load failed|failed to fetch|networkerror|network request failed/i;

  function login(note = '') {
    const client = window.PMPSync?.client, saved = store.get('pmp-sync-email') || bio()?.email || '';
    if (!client) {
      authFrame(`<h1>Sin conexión con tu cuenta</h1><p class="cf-sub">No se pudo contactar el servicio de acceso. Puedes seguir con lo guardado en este dispositivo; se sincronizará cuando vuelva la conexión e inicies sesión.</p>
        <div class="cf-actions"><button class="cf-btn" data-cf="offline">Continuar sin conexión</button><button class="cf-link" data-cf="retry">Reintentar</button></div>`);
      return;
    }
    authFrame(`<h1>Inicia sesión</h1><p class="cf-sub">${esc(note) || 'Entra con tu cuenta para ver tus programas de preparación.'}</p>
      <form id="cf-login" autocomplete="on"><label>Correo<input type="email" name="email" required autocomplete="username" value="${esc(saved)}" placeholder="tu@correo.com"></label>
      <label>Contraseña<input type="password" name="pass" required autocomplete="current-password" placeholder="••••••••"></label>
      <button class="cf-btn" type="submit">Entrar ${ico('arrow')}</button></form>
      <p class="cf-msg" role="status" aria-live="polite"></p>
      <details class="cf-alt"><summary>¿Aún no tienes contraseña o la olvidaste?</summary>
        <p>Te enviamos un enlace de acceso. En la app de la pantalla de inicio del iPhone, mantén presionado el enlace del correo → «Copiar enlace» y pégalo aquí (sin abrir la vista previa).</p>
        <div class="cf-row"><button class="cf-btn ghost" data-cf="link-send">Enviar enlace a mi correo</button></div>
        <form id="cf-paste"><input name="link" required placeholder="Pega aquí el enlace del correo" aria-label="Enlace del correo"><button class="cf-btn ghost" type="submit">Entrar con el enlace</button></form>
        <p>Una vez dentro, crea tu contraseña en Ajustes → Sincronización.</p>
      </details>`);
    const f = root.querySelector('#cf-login'); (f.email.value ? f.pass : f.email).focus({preventScroll: true});
  }

  function lockScreen(user) {
    authFrame(`<h1>Hola de nuevo</h1><p class="cf-sub">${esc(user?.email || '')}</p>
      <div class="cf-actions"><button class="cf-btn" data-cf="bio">${ico('face')} Entrar con Face ID</button><button class="cf-link" data-cf="use-pass">Usar contraseña</button></div><p class="cf-msg" role="status" aria-live="polite"></p>`);
    setTimeout(() => root.querySelector('[data-cf="bio"]')?.focus(), 50);
  }

  async function doBio() {
    try { if (await bioCheck()) return unlock(); msg('No se pudo verificar. Inténtalo de nuevo o usa tu contraseña.', true); }
    catch (e) { msg(e?.name === 'NotAllowedError' ? 'Se canceló la verificación. Inténtalo de nuevo o usa tu contraseña.' : 'Face ID no está disponible ahora: usa tu contraseña.', true); }
  }

  root.addEventListener('submit', async ev => {
    const f = ev.target; if (!['cf-login', 'cf-paste'].includes(f.id)) return;
    ev.preventDefault();
    const client = window.PMPSync?.client, btn = f.querySelector('button'), label = btn.innerHTML;
    if (!client) return login();
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      if (f.id === 'cf-login') {
        const email = f.email.value.trim(); store.set('pmp-sync-email', email);
        const {error} = await client.auth.signInWithPassword({email, password: f.pass.value});
        if (error) msg(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos. Si aún no creaste tu contraseña, entra con el enlace (abajo) y créala en Ajustes → Sincronización.' : NET.test(error.message) ? 'No se pudo conectar con el servicio de acceso. Revisa tu internet e inténtalo de nuevo.' : 'No se pudo entrar: ' + error.message, true);
        else { f.pass.value = ''; afterLogin(); }
      } else {
        const t = tokenFrom(f.link.value);
        if (!t) { msg('Eso no parece el enlace del correo. Cópialo completo (mantén presionado → Copiar enlace).', true); return; }
        let error;
        for (const [h, type] of [[t.plain, 'email'], [t.plain, 'magiclink'], [t.raw, 'email']]) { ({error} = await client.auth.verifyOtp({token_hash: h, type})); if (!error || !/invalid|expired|type|not found/i.test(error.message)) break; }
        if (error) msg('El enlace ya se usó o venció. Pide uno nuevo y no abras su vista previa. (' + error.message + ')', true); else afterLogin();
      }
    } catch (e) { msg(NET.test(e.message) ? 'No se pudo conectar con el servicio de acceso.' : 'Error: ' + e.message, true); }
    finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  });
  function tokenFrom(text) {
    let t = String(text || '').trim();
    for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
    if (!/\/auth\/v1\/verify|token_hash=/.test(t)) return null;
    const m = t.match(/[?&](?:token_hash|token)=([A-Za-z0-9_\-]+)/); return m ? {raw: m[1], plain: m[1].replace(/^pkce_/, '')} : null;
  }
  async function afterLogin() { msg('¡Listo! Entrando…', false); sess.set('cf-fresh', '1'); setTimeout(unlock, 350); }

  root.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-cf]'); if (!el || !root.contains(el)) return;
    const a = el.dataset.cf, client = window.PMPSync?.client;
    if (a === 'offline') unlock();
    if (a === 'retry') location.reload();
    if (a === 'bio') doBio();
    if (a === 'use-pass') login();
    if (a === 'link-send') {
      const email = root.querySelector('#cf-login [name=email]')?.value.trim();
      if (!email) { msg('Escribe tu correo arriba.', true); return; }
      store.set('pmp-sync-email', email); el.disabled = true; el.textContent = 'Enviando…';
      const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
      try {
        const sender = standalone ? window.supabase.createClient(window.PMP_CONFIG.supabaseUrl, window.PMP_CONFIG.supabaseAnonKey, {auth: {flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cf-otp'}}) : client;
        const {error} = await sender.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false}});
        msg(error ? (/rate|limit|seconds/i.test(error.message) ? 'Ya se enviaron varios enlaces hace poco: usa el último que te llegó o espera unos minutos.' : 'No se pudo enviar: ' + error.message) : `Enlace enviado a ${email}. ${standalone ? 'Cópialo (sin abrir la vista previa) y pégalo abajo.' : 'Ábrelo en este mismo navegador.'}`, !!error);
      } catch (e) { msg('No se pudo enviar: ' + e.message, true); }
      finally { el.disabled = false; el.textContent = 'Enviar enlace a mi correo'; }
    }
    if (a === 'pmp') { sess.set('cf-unlocked', '1'); goPmp('inicio'); }
    if (a === 'logout') { if (!confirm('¿Cerrar sesión en este dispositivo? Tu progreso queda guardado en la nube.')) return; try { await client?.auth.signOut(); } catch {} sess.set('cf-unlocked', ''); unlocked = false; window.dispatchEvent(new CustomEvent('pmp-auth', {detail: {user: null}})); login('Sesión cerrada.'); }
    if (a === 'bio-on') { try { await bioEnable(window.PMPSync?.user?.email || store.get('pmp-sync-email') || ''); store.del('cf-bio-skip'); hub('Listo: la próxima vez podrás entrar con Face ID.'); } catch (e) { hub(e?.name === 'NotAllowedError' ? 'Activación cancelada.' : 'No se pudo activar en este dispositivo.'); } }
    if (a === 'bio-skip') { store.set('cf-bio-skip', '1'); hub(); }
    if (a === 'bio-off') { store.del('cf-bio'); hub('Face ID desactivado en este dispositivo.'); }
  });

  /* ---------- centro de certificaciones ---------- */
  const daysTo = d => Math.ceil((new Date(d + 'T12:00:00-05:00') - Date.now()) / 864e5);
  async function hub(note = '') {
    if (!unlocked) return;
    if (location.hash.slice(1) !== HUB) history.replaceState(null, '', '#' + HUB);
    const st = window.PMPApp?.getState?.(), exam = st?.settings?.examDate || '2027-01-31', left = daysTo(exam);
    const user = window.PMPSync?.user, canBio = user && !bio() && !store.get('cf-bio-skip') && await bioAvailable();
    const routine = typeof cardsGradedToday === 'function' && typeof bulletProgress === 'function' ? `Hoy · Anki ${Math.min(cardsGradedToday(), 4)}/4 · Bullet ${Math.min(bulletProgress(), 5)}/5` : 'Rutina diaria: Anki y Bullet Quiz';
    const card = (p, i) => p.ready
      ? `<article class="cf-prog ready" style="--i:${i}"><div class="cf-when"><b>${esc(p.when.split(' ')[0])}</b><span>${esc(p.when.split(' ')[1])}</span></div>
          <div class="cf-prog-body"><div class="cf-prog-top">${ico(p.icon, 'big')}<span class="cf-pill on">Disponible</span></div><h2>${esc(p.name)}</h2><p>${esc(p.cert)}</p>
          <div class="cf-meta"><span><b>${left > 0 ? left : 0}</b> días para el examen</span><span>${esc(routine)}</span></div>
          <button class="cf-btn" data-cf="pmp">Entrar ${ico('arrow')}</button></div></article>`
      : `<article class="cf-prog soon" style="--i:${i}" aria-disabled="true"><div class="cf-when"><b>${esc(p.when.split(' ')[0])}</b><span>${esc(p.when.split(' ')[1])}</span></div>
          <div class="cf-prog-body"><div class="cf-prog-top">${ico(p.icon, 'big')}<span class="cf-pill">${ico('lock')} Próximamente</span></div><h2>${esc(p.name)}</h2><p>${esc(p.cert)}</p><p class="cf-na">Aún no disponible</p></div></article>`;
    root.querySelector('.cf-hub').innerHTML = `<header class="cf-top">${logo('mini')}${word()}<span class="cf-sp"></span>${user ? `<button class="cf-chip" data-cf="logout" title="Cerrar sesión">${esc((user.email || '').split('@')[0])} · salir</button>` : '<span class="cf-chip off">Sin sincronizar</span>'}</header>
      <div class="cf-hub-in">
        <p class="cf-eyebrow">TU RUTA DE CERTIFICACIONES · 2027–2028</p>
        <h1>Hola, Fabrizio</h1><p class="cf-sub">Un programa a la vez. Cuando apruebes uno, el siguiente se habilita aquí.</p>
        ${note ? `<p class="cf-note">${esc(note)}</p>` : ''}
        ${canBio ? `<div class="cf-bio">${ico('face', 'big')}<div><b>Entra más rápido con Face ID</b><span>Solo en este dispositivo. Siempre podrás usar tu contraseña.</span></div><button class="cf-btn small" data-cf="bio-on">Activar</button><button class="cf-link" data-cf="bio-skip">Ahora no</button></div>` : ''}
        <div class="cf-timeline">${PROGRAMS.map(card).join('')}</div>
        ${bio() ? '<p class="cf-small">Face ID activo en este dispositivo · <button class="cf-link" data-cf="bio-off">desactivar</button></p>' : ''}
      </div>`;
    show('hub');
  }

  // Desde PMP: el logo de certiFicate (o el botón Atrás hasta #certificate) vuelve al centro.
  document.addEventListener('click', ev => { if (ev.target.closest('[data-cf-hub]')) { ev.preventDefault(); if (unlocked || AUTO) { unlocked = true; if (location.hash.slice(1) !== HUB) location.hash = HUB; else hub(); } } });
  window.addEventListener('hashchange', () => { if (location.hash.slice(1) === HUB) { if (unlocked) hub(); } else if (unlocked && !root.hidden && root.dataset.view === 'hub') hide(); });
  window.addEventListener('pmp-auth', ev => { if (!ev.detail.user && unlocked && !AUTO && window.PMPSync?.client && sess.get('cf-unlocked') === '1' && root.hidden === false && root.dataset.view === 'hub') hub(); });
  window.certiFicate = {hub: () => { unlocked = true; hub(); }, login, lockScreen, get view() { return root.hidden ? 'app' : root.dataset.view; }};
})();
