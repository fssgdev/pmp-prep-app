'use strict';
// Sincronización del progreso con Supabase (tabla public.progress, ver supabase/schema.sql).
// Si js/config.js no tiene credenciales, la app funciona solo con localStorage.
(() => {
  const cfg = window.PMP_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let readyDone; const ready = new Promise(r => { readyDone = r; }); // se resuelve al conocer la sesión (o si no hay servicio)
  let client = null, otpClient = null, user = null, gen = 0, timer = null, status = 'local', lastError = '', lastSync = '', lastPull = 0;

  const app = () => window.PMPApp;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localUpdated = () => { try { return localStorage.getItem(app().KEY + '-updated') || ''; } catch { return ''; } };

  function setStatus(s, err = '') {
    status = s; lastError = err;
    const el = document.getElementById('save-state');
    if (el) el.innerHTML = label();
  }

  function label() {
    if (!enabled) return '<i></i> Guardado en este dispositivo';
    // Sin sesión no hay sincronización: se dice claro y lleva a Ajustes para iniciarla (antes parecía «todo bien»).
    if (!user) return '<button class="sync-off" data-action="settings" data-focus="sync" title="Inicia sesión en Ajustes para compartir tu progreso entre dispositivos"><i></i> Sin sincronizar · iniciar sesión</button>';
    return {
      syncing: '<i></i> Sincronizando…',
      synced: '<i></i> Sincronizado en la nube',
      error: 'Sin conexión · guardado local'
    }[status] || '<i></i> Guardado en este dispositivo';
  }

  function loadLibrary() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar Supabase'));
      document.head.append(s);
    });
  }

  /* Fusión de estados (issue #4): evita que un dispositivo borre lo que registró otro.
     - Listas con id (intentos, errores, notas, simulacros, preguntas, prácticas): unión por id.
       Si el mismo id difiere, gana la nota con 'updated' más reciente o, si no, el estado más nuevo.
     - Borrados: state.deleted {id: fecha} actúa como lápida y se respeta en ambos lados.
     - Actividades hechas: unión; una actividad desmarcada después ('task:<id>' en deleted) se respeta.
     - Tarjetas: gana la que tiene más repasos; historial de tarjetas: unión sin duplicar.
     - Temas, asistencia: por clave; ajustes, cuestionario y simulacro en curso: el estado más nuevo. */
  const LISTS = ['notes', 'errors', 'mocks', 'attempts', 'questions', 'studySessions', 'results', 'classLog', 'slides', 'noteFiles'];
  function merge(local, remote, localNewer) {
    if (!remote) return local; if (!local) return remote;
    const [newer, older] = localNewer ? [local, remote] : [remote, local];
    const out = {...older, ...newer};
    const deleted = {...(older.deleted || {}), ...(newer.deleted || {})};
    Object.keys(older.deleted || {}).forEach(k => { if (newer.deleted?.[k] && newer.deleted[k] < older.deleted[k]) deleted[k] = older.deleted[k]; });
    out.deleted = deleted;
    for (const k of LISTS) {
      const map = new Map();
      for (const item of [...(older[k] || []), ...(newer[k] || [])]) {
        if (!item || !item.id || deleted[item.id]) continue;
        const prev = map.get(item.id);
        if (!prev) { map.set(item.id, item); continue; }
        if (prev.updated && item.updated) map.set(item.id, item.updated >= prev.updated ? item : prev);
        else map.set(item.id, item); // 'item' viene del estado más nuevo
      }
      out[k] = [...map.values()];
      if (k === 'attempts' || k === 'mocks' || k === 'results') out[k].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (k === 'errors' || k === 'notes') out[k].sort((a, b) => String(b.updated || b.date).localeCompare(String(a.updated || a.date)));
    }
    out.tasksDone = {};
    for (const src of [older.tasksDone || {}, newer.tasksDone || {}]) for (const [id, at] of Object.entries(src)) {
      const tomb = deleted['task:' + id];
      if (tomb && tomb > at) continue;
      // Las láminas pueden volver a hacerse al publicarse otra versión (#3): gana la marca más reciente.
      const later = id.startsWith('slide-');
      if (!out.tasksDone[id] || (later ? at > out.tasksDone[id] : at < out.tasksDone[id])) out.tasksDone[id] = at;
    }
    out.cards = {...(older.cards || {})};
    for (const [id, c] of Object.entries(newer.cards || {})) {
      const p = out.cards[id], score = x => x.n || ((x.reps || 0) + (x.lapses || 0));
      if (!p || score(c) > score(p) || (score(c) === score(p) && String(c.due) >= String(p.due))) out.cards[id] = c;
    }
    const count = log => { const m = new Map(); (log || []).forEach(l => { const k = l.at ? l.id + '@' + l.at : [l.id, l.date, l.grade, l.first].join('|'); m.set(k, [...(m.get(k) || []), l]); }); return m; };
    const a = count(older.cardLog), b = count(newer.cardLog), log = [];
    new Set([...a.keys(), ...b.keys()]).forEach(k => { const x = a.get(k) || [], y = b.get(k) || []; log.push(...(y.length >= x.length ? y : x)); });
    out.cardLog = log.sort((p, q) => String(p.at || p.date).localeCompare(String(q.at || q.date))).slice(-3000);
    // Rutina diaria (issue #6): días por fecha (gana la selección generada más tarde), correcciones de lección por semana, ciclos vistos por unión.
    const ro = older.routine || {}, rn = newer.routine || {};
    out.routine = {override: {...(ro.override || {}), ...(rn.override || {})}, days: {...(ro.days || {})}, seen: {}};
    for (const [d, x] of Object.entries(rn.days || {})) { const p = out.routine.days[d]; if (!p || String(x.at || '') >= String(p.at || '')) out.routine.days[d] = x; }
    for (const k of new Set([...Object.keys(ro.seen || {}), ...Object.keys(rn.seen || {})])) out.routine.seen[k] = [...new Set([...(ro.seen?.[k] || []), ...(rn.seen?.[k] || [])])];
    out.cardExtra = {...(older.cardExtra || {})};
    for (const [d, n] of Object.entries(newer.cardExtra || {})) out.cardExtra[d] = Math.max(n, out.cardExtra[d] || 0);
    out.topics = {...(older.topics || {}), ...(newer.topics || {})};
    out.attendance = {...(older.attendance || {}), ...(newer.attendance || {})};
    return out;
  }

  // Progreso aislado por cuenta (#10): el estado local pertenece a la última cuenta que sincronizó (pmp-sync-owner). Si entra otra
  // cuenta en este dispositivo, lo local se guarda aparte (pmp-backup-<id>) y no se mezcla ni se sube a la cuenta nueva; si esa
  // cuenta ya tenía un respaldo aquí, se recupera. Sin dueño registrado (versiones anteriores), la cuenta actual adopta lo local.
  const OWNER = 'pmp-sync-owner';
  function isolate() {
    let owner = ''; try { owner = localStorage.getItem(OWNER) || ''; } catch {}
    if (!owner || owner === user.id) return true;
    let back = null;
    try { localStorage.setItem('pmp-backup-' + owner, JSON.stringify(app().getState())); back = JSON.parse(localStorage.getItem('pmp-backup-' + user.id) || 'null'); } catch { return false; }
    if (!app().setState(back || app().fresh())) return false;
    try { localStorage.removeItem('pmp-backup-' + user.id); localStorage.removeItem(app().KEY + '-updated'); localStorage.setItem(OWNER, user.id); } catch {}
    app().toast('Cambiaste de cuenta: el progreso de la cuenta anterior quedó separado en este dispositivo.');
    return true;
  }
  const isolated = () => { if (isolate()) return true; setStatus('error', 'No se pudo separar el progreso de la cuenta anterior en este dispositivo; no se sincronizó.'); return false; };

  // Cada operación queda atada a la sesión con la que empezó (#10): cuenta + generación de sesión. La generación aumenta al cerrar
  // sesión o cambiar de cuenta (también si luego vuelve a entrar la misma cuenta), pero no al renovar el token. Si mientras espera
  // a la red la sesión deja de ser la vigente, su resultado y sus errores se descartan: no se fusiona en el progreso local, no se
  // sube con otro user_id ni deja avisos de error de una sesión anterior.
  const session = () => user ? {uid: user.id, gen} : null;
  const current = t => !!t && user?.id === t.uid && gen === t.gen;
  const newSession = () => { gen++; clearTimeout(timer); };
  // Ejecuta una operación con la sesión vigente y solo muestra su error si esa sesión sigue vigente.
  const guarded = (fn, t = session()) => fn(t).catch(e => { if (current(t)) setStatus('error', e.message); });
  async function pull(t = session()) {
    if (!current(t) || !isolated()) return;
    const uid = t.uid;
    const {data, error} = await client.from('progress').select('state, updated_at').eq('user_id', uid).maybeSingle();
    if (!current(t)) return;
    if (error) throw error;
    if (!data) { await push(t); return; }                      // primera vez: sube lo local
    if (localUpdated() === data.updated_at) { synced(t); return; }
    const local = app().getState(), merged = merge(local, data.state, localUpdated() > data.updated_at);
    const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
    if (changedLocal) {
      // Si el estado fusionado no se puede aplicar aquí, no se marca como sincronizado ni se pisa la nube.
      if (!app().setState(merged)) { setStatus('error', 'No se pudo aplicar el progreso de la nube en este dispositivo.'); return; }
      app().toast('Progreso actualizado desde la nube.');
    }
    if (JSON.stringify(merged) !== JSON.stringify(data.state)) { if (!(await write(merged, true, t))) return; }
    else { try { localStorage.setItem(app().KEY + '-updated', data.updated_at); } catch {} }
    synced(t);
  }

  async function write(st, mark, t) {
    if (!current(t)) return false;
    const updated_at = new Date().toISOString();
    const {error} = await client.from('progress').upsert({user_id: t.uid, state: st, updated_at});
    if (!current(t)) return false;
    if (error) throw error;
    if (mark) try { localStorage.setItem(app().KEY + '-updated', updated_at); } catch {}
    return true;
  }
  function synced(t) { if (!current(t)) return; lastSync = new Date().toISOString(); try { localStorage.setItem(OWNER, t.uid); } catch {} setStatus('synced'); }

  // Antes de escribir, lee la nube y fusiona: así un guardado no pisa lo que subió otro dispositivo.
  async function push(t = session()) {
    if (!client || !current(t) || !isolated()) return;
    const uid = t.uid;
    setStatus('syncing');
    try {
      const {data, error} = await client.from('progress').select('state, updated_at').eq('user_id', uid).maybeSingle();
      if (!current(t)) return;
      if (error) throw error;
      let st = app().getState();
      if (data?.state && data.updated_at !== localUpdated()) {
        const merged = merge(st, data.state, true);
        if (JSON.stringify(merged) !== JSON.stringify(st)) {
          // Nunca se sube solo lo local si la nube tenía algo más: se sube la fusión.
          if (!app().setState(merged)) { if (!(await write(merged, false, t))) return; setStatus('error', 'No se pudo aplicar el progreso de la nube en este dispositivo.'); return; }
          st = merged;
        }
      }
      if (await write(st, true, t)) synced(t);
    } catch (e) { if (current(t)) setStatus('error', e.message); }
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(timer);
    const t = session(); // un guardado pendiente pertenece a la sesión que lo hizo
    timer = setTimeout(() => { if (current(t)) guarded(push, t); }, 1500);
  }

  function panel() {
    if (!enabled) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Aún no configurada. Mientras tanto, tu progreso se guarda en este navegador.</p></div>`;
    if (user) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Sesión iniciada como <strong>${esc(user.email)}</strong>. Tu progreso se guarda automáticamente y se comparte entre tus dispositivos; al volver a la app se trae lo último de la nube.${lastSync ? '<br>Última sincronización: ' + esc(new Date(lastSync).toLocaleString('es-PE', {timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})) : ''}${lastError ? '<br>Último error: ' + esc(lastError) : ''}</p><div class="actions"><button class="button light small" data-sync="now">Sincronizar ahora</button><button class="button white small" data-sync="logout">Cerrar sesión</button></div>
      <details class="sync-pass"><summary>Crear contraseña para entrar sin correo</summary><p class="hint">Útil para la app de la pantalla de inicio del iPhone u otro navegador: entras con tu correo y esta contraseña, sin esperar enlaces.</p><form id="sync-setpass"><input type="password" name="pass" minlength="8" required autocomplete="new-password" placeholder="Nueva contraseña (mín. 8)" aria-label="Nueva contraseña"><button class="button light small" type="submit">Guardar contraseña</button></form><p class="sync-msg" role="status" aria-live="polite"></p></details></div>`;
    // En la app de la pantalla de inicio del iPhone el enlace del correo se abre en Safari, que guarda su propia sesión:
    // por eso se ofrece también entrar con el código de 6 dígitos del mismo correo (verifyOtp), que funciona en cualquier navegador.
    const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
    let saved = ''; try { saved = localStorage.getItem('pmp-sync-email') || ''; } catch {}
    return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint"><strong>Este dispositivo no está sincronizando:</strong> lo que hagas aquí no llega a tus otros dispositivos. Escribe tu correo (el mismo en todos tus dispositivos) y te llegará un correo con un enlace para entrar.</p>
      <form id="sync-login"><input type="email" name="email" required autocomplete="email" placeholder="tu@correo.com" aria-label="Correo" value="${esc(saved)}"><button class="button small" type="submit">Enviar correo</button></form>
      <form id="sync-pass"><input type="password" name="pass" required autocomplete="current-password" placeholder="Contraseña (si ya creaste una)" aria-label="Contraseña"><button class="button light small" type="submit">Entrar con contraseña</button></form>
      <form id="sync-code"><input name="code" autocomplete="one-time-code" required placeholder="Pega aquí el enlace del correo" aria-label="Enlace o código del correo"><button class="button light small" type="submit">Entrar</button></form>
      <p class="hint" style="margin-top:8px">${standalone ? '<strong>Estás en la app de la pantalla de inicio:</strong> si tocas el enlace se abre Safari, que inicia sesión allí y no aquí. En el correo, <strong>mantén presionado</strong> el botón del enlace → <strong>Copiar enlace</strong>, y pégalo arriba.' : 'Abre el enlace en este mismo navegador. Si lo recibes en otro lado (o usas la app de la pantalla de inicio), mantén presionado el enlace → Copiar enlace, y pégalo arriba.'}</p><p class="sync-msg" role="status" aria-live="polite"></p></div>`;
  }

  // «Load failed» (Safari) / «Failed to fetch» (Chrome): no se llegó al servidor. En el plan gratuito, Supabase pausa el proyecto tras una semana sin uso.
  const netFail = m => /load failed|failed to fetch|networkerror|network request failed/i.test(String(m || ''));
  // Extrae el token del enlace del correo (también si viene envuelto por Gmail/Outlook o con el prefijo pkce_).
  function tokenHashFrom(text) {
    let t = String(text || '').trim();
    for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
    if (!/\/auth\/v1\/verify|token_hash=/.test(t)) return null;
    const m = t.match(/[?&](?:token_hash|token)=([A-Za-z0-9_\-]+)/);
    return m ? {raw: m[1], plain: m[1].replace(/^pkce_/, '')} : null;
  }
  const NET_MSG = 'No se pudo conectar con el servidor de sincronización. Si tienes internet, es probable que el proyecto de Supabase esté en pausa por inactividad: hay que reactivarlo desde supabase.com (Restore project).';
  // Contraseña (Supabase Auth, proveedor de correo): crearla con la sesión iniciada y usarla donde el enlace no sirve.
  document.addEventListener('submit', async ev => {
    if (!['sync-pass', 'sync-setpass'].includes(ev.target.id)) return;
    ev.preventDefault();
    const form = ev.target, box = form.closest('.sync-box'), out = (form.closest('details') || box).querySelector('.sync-msg'), btn = form.querySelector('button'), label = btn.textContent;
    const pass = String(new FormData(form).get('pass') || '');
    const show = (msg, bad) => { out.textContent = msg; out.className = 'sync-msg ' + (bad ? 'bad' : 'ok'); app().toast(msg); };
    if (!client) { show('No se pudo cargar el servicio de sincronización. Recarga la página.', true); return; }
    btn.disabled = true; btn.textContent = 'Un momento…';
    try {
      if (form.id === 'sync-setpass') {
        const {error} = await client.auth.updateUser({password: pass});
        if (error) show(/reauth|recent/i.test(error.message) ? 'Por seguridad, Supabase pide volver a iniciar sesión antes de crear la contraseña. Cierra sesión, entra con un enlace nuevo y vuelve a intentarlo.' : /weak|short|least/i.test(error.message) ? 'La contraseña es muy débil: usa al menos 8 caracteres con letras y números.' : 'No se pudo guardar: ' + error.message, true);
        else { show('Contraseña guardada. En otros navegadores o en la app de inicio entra con tu correo y esta contraseña.', false); form.reset(); }
      } else {
        const email = String(box.querySelector('#sync-login [name=email]')?.value || '').trim();
        if (!email) { show('Escribe tu correo arriba.', true); return; }
        try { localStorage.setItem('pmp-sync-email', email); } catch {}
        const {error} = await client.auth.signInWithPassword({email, password: pass});
        if (error) show(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos. Si aún no creaste una contraseña, créala primero desde un navegador donde tengas la sesión iniciada (Ajustes → Sincronización).' : netFail(error.message) ? NET_MSG : 'No se pudo entrar: ' + error.message, true);
        else { show('Sesión iniciada. Sincronizando tu progreso…', false); setTimeout(() => document.getElementById('modal')?.close(), 900); }
      }
    } catch (e) { show(netFail(e.message) ? NET_MSG : 'Error: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = label; }
  });

  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'sync-code') return;
    ev.preventDefault();
    const box = ev.target.closest('.sync-box'), out = box.querySelector('.sync-msg'), btn = ev.target.querySelector('button');
    const email = String(box.querySelector('#sync-login [name=email]')?.value || '').trim(), raw = String(new FormData(ev.target).get('code') || '').trim();
    const show = (msg, bad) => { out.textContent = msg; out.className = 'sync-msg ' + (bad ? 'bad' : 'ok'); app().toast(msg); };
    if (!client) { show('No se pudo cargar el servicio de sincronización. Recarga la página.', true); return; }
    const hash = tokenHashFrom(raw), code = /^\d{6,10}$/.test(raw.replace(/\s/g, '')) ? raw.replace(/\s/g, '') : '';
    if (!hash && !code) { show('Eso no parece el enlace del correo. Mantén presionado el botón del correo, elige «Copiar enlace» y pégalo completo.', true); return; }
    if (code && !email) { show('Escribe primero tu correo (el mismo al que llegó el código).', true); return; }
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      // Enlace: se verifica su token directamente (no necesita el navegador que pidió el correo). Código: con el correo.
      let error;
      if (code) ({error} = await client.auth.verifyOtp({email, token: code, type: 'email'}));
      else for (const [h, type] of [[hash.plain, 'email'], [hash.plain, 'magiclink'], [hash.raw, 'email']].filter((x, i, a) => a.findIndex(y => y[0] === x[0] && y[1] === x[1]) === i)) {
        ({error} = await client.auth.verifyOtp({token_hash: h, type}));
        if (!error || !/invalid|expired|type|not found/i.test(error.message)) break;
      }
      if (error) show(/expired|invalid/i.test(error.message) ? 'El enlace ya se usó o venció (sirven una sola vez). Ojo: en el iPhone, la vista previa al mantener presionado un enlace lo abre y lo gasta. Si ya tienes la sesión en Safari, es más fácil crear una contraseña allí (Ajustes → Sincronización) y entrar aquí con ella. (' + error.message + ')' : netFail(error.message) ? NET_MSG : 'No se pudo entrar: ' + error.message, true);
      else { show('Sesión iniciada. Sincronizando tu progreso…', false); setTimeout(() => document.getElementById('modal')?.close(), 900); }
    } catch (e) { show(netFail(e.message) ? NET_MSG : 'No se pudo entrar: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });

  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'sync-login') return;
    ev.preventDefault();
    const form = ev.target, email = String(new FormData(form).get('email') || '').trim(), btn = form.querySelector('button'), out = form.parentElement.querySelector('.sync-msg');
    const show = (msg, bad) => { if (out) { out.textContent = msg; out.className = 'sync-msg ' + (bad ? 'bad' : 'ok'); } app().toast(msg); };
    if (!client) { show('No se pudo cargar el servicio de sincronización. Revisa tu conexión y recarga la página (Ctrl + Shift + R).', true); return; }
    try { localStorage.setItem('pmp-sync-email', email); } catch {}
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      // En la app de la pantalla de inicio se pide el correo sin PKCE: así el enlace copiado se puede verificar aquí mismo.
      const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
      const sender = standalone ? (otpClient ||= window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {auth: {flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'pmp-otp'}})) : client;
      const {error} = await sender.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false}});
      if (error) show(/rate|limit|seconds/i.test(error.message) ? 'Ya se enviaron varios enlaces hace poco. Usa el último correo que te llegó o espera unos minutos y vuelve a intentarlo.' : netFail(error.message) ? NET_MSG : 'No se pudo enviar el enlace: ' + error.message, true);
      else show(`Correo enviado a ${email} (revisa también Spam o Promociones). Abre el enlace en este mismo navegador o pega abajo el enlace copiado.`, false);
    } catch (e) { show(netFail(e.message) ? NET_MSG : 'No se pudo enviar el enlace: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Enviar correo'; }
  });

  // Desde la etiqueta «Sin sincronizar», Ajustes se abre directo en la sección de sincronización (en el celular queda abajo).
  document.addEventListener('click', ev => { if (ev.target.closest('[data-focus="sync"]')) setTimeout(() => { const box = document.querySelector('dialog[open] .sync-box'); box?.scrollIntoView({block: 'start', behavior: 'smooth'}); box?.querySelector('input')?.focus({preventScroll: true}); }, 60); });
  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-sync]');
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.sync === 'now') { await guarded(pull); app().toast(status === 'error' ? 'No se pudo sincronizar: ' + lastError : 'Sincronizado: tienes lo último de la nube.'); }
    if (el.dataset.sync === 'logout') { newSession(); user = null; await client.auth.signOut(); user = null; setStatus('local'); window.dispatchEvent(new CustomEvent('pmp-auth', {detail: {user: null}})); app().toast('Sesión cerrada. El progreso sigue guardado en este dispositivo.'); }
    document.getElementById('modal')?.close();
  });

  async function init() {
    if (!enabled) { readyDone(null); return; }
    setTimeout(() => readyDone(null), 8000); // sin respuesta del servicio: la pantalla de acceso ofrece seguir sin conexión
    try {
      await loadLibrary();
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {auth: {flowType: 'pkce', detectSessionInUrl: true, persistSession: true}});
      client.auth.onAuthStateChange((event, sess) => {
        const was = user?.id;
        user = sess?.user || null;
        // Cierre de sesión o cambio de cuenta: nueva generación (se descartan el guardado pendiente y las operaciones en curso).
        // Renovar el token (TOKEN_REFRESHED) o reconfirmar la misma sesión no abre una generación nueva.
        if (user?.id !== was || event === 'SIGNED_OUT') newSession();
        readyDone(user);
        if (!user) setStatus('local');
        window.dispatchEvent(new CustomEvent('pmp-auth', {detail: {user}}));
        if (user && user.id !== was) {
          if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
          guarded(pull);
        }
      });
      window.addEventListener('online', () => user && guarded(pull));
      // Traer lo último de la nube al volver a la pestaña (p. ej., si se dejó abierta desde la mañana) y cada 5 minutos.
      const refresh = (force = false) => { if (!user || document.visibilityState === 'hidden') return; if (!force && Date.now() - lastPull < 20000) return; lastPull = Date.now(); guarded(pull); };
      document.addEventListener('visibilitychange', () => refresh());
      window.addEventListener('focus', () => refresh());
      window.addEventListener('pageshow', ev => ev.persisted && refresh(true));
      setInterval(() => refresh(true), 5 * 60000);
    } catch (e) { setStatus('error', e.message); readyDone(null); }
  }

  window.PMPSync = {init, schedulePush, panel, label, merge, ready, pull: () => guarded(pull), get enabled() { return enabled; }, get user() { return user; }, get client() { return client; }};
})();
