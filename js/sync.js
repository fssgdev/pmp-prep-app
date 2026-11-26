'use strict';
// Sincronización del progreso con Supabase (tabla public.progress, ver supabase/schema.sql).
// Si js/config.js no tiene credenciales, la app funciona solo con localStorage.
(() => {
  const cfg = window.PMP_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let client = null, user = null, timer = null, status = 'local', lastError = '', lastSync = '', lastPull = 0;

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
    if (!user) return '<button class="sync-off" data-action="settings" title="Inicia sesión en Ajustes para compartir tu progreso entre dispositivos"><i></i> Sin sincronizar · iniciar sesión</button>';
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

  async function pull() {
    const {data, error} = await client.from('progress').select('state, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) { await push(); return; }                       // primera vez: sube lo local
    if (localUpdated() === data.updated_at) { synced(); return; }
    const local = app().getState(), merged = merge(local, data.state, localUpdated() > data.updated_at);
    const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
    if (changedLocal) {
      // Si el estado fusionado no se puede aplicar aquí, no se marca como sincronizado ni se pisa la nube.
      if (!app().setState(merged)) { setStatus('error', 'No se pudo aplicar el progreso de la nube en este dispositivo.'); return; }
      app().toast('Progreso actualizado desde la nube.');
    }
    if (JSON.stringify(merged) !== JSON.stringify(data.state)) await write(merged);
    else { try { localStorage.setItem(app().KEY + '-updated', data.updated_at); } catch {} }
    synced();
  }

  async function write(st, mark = true) {
    const updated_at = new Date().toISOString();
    const {error} = await client.from('progress').upsert({user_id: user.id, state: st, updated_at});
    if (error) throw error;
    if (mark) try { localStorage.setItem(app().KEY + '-updated', updated_at); } catch {}
  }
  function synced() { lastSync = new Date().toISOString(); setStatus('synced'); }

  // Antes de escribir, lee la nube y fusiona: así un guardado no pisa lo que subió otro dispositivo.
  async function push() {
    if (!client || !user) return;
    setStatus('syncing');
    try {
      const {data, error} = await client.from('progress').select('state, updated_at').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      let st = app().getState();
      if (data?.state && data.updated_at !== localUpdated()) {
        const merged = merge(st, data.state, true);
        if (JSON.stringify(merged) !== JSON.stringify(st)) {
          // Nunca se sube solo lo local si la nube tenía algo más: se sube la fusión.
          if (!app().setState(merged)) { await write(merged, false); setStatus('error', 'No se pudo aplicar el progreso de la nube en este dispositivo.'); return; }
          st = merged;
        }
      }
      await write(st);
      synced();
    } catch (e) { setStatus('error', e.message); }
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(() => push().catch(e => setStatus('error', e.message)), 1500);
  }

  function panel() {
    if (!enabled) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Aún no configurada. Mientras tanto, tu progreso se guarda en este navegador.</p></div>`;
    if (user) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Sesión iniciada como <strong>${esc(user.email)}</strong>. Tu progreso se guarda automáticamente y se comparte entre tus dispositivos; al volver a la app se trae lo último de la nube.${lastSync ? '<br>Última sincronización: ' + esc(new Date(lastSync).toLocaleString('es-PE', {timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})) : ''}${lastError ? '<br>Último error: ' + esc(lastError) : ''}</p><div class="actions"><button class="button light small" data-sync="now">Sincronizar ahora</button><button class="button white small" data-sync="logout">Cerrar sesión</button></div></div>`;
    return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint"><strong>Este dispositivo no está sincronizando:</strong> lo que hagas aquí no llega a tus otros dispositivos. Escribe tu correo y abre el enlace que te llegará <strong>en este mismo dispositivo y navegador</strong>. Usa el mismo correo en cada dispositivo.</p><form id="sync-login"><input type="email" name="email" required autocomplete="email" placeholder="tu@correo.com" aria-label="Correo"><button class="button small" type="submit">Enviar enlace</button></form><p class="sync-msg" role="status" aria-live="polite"></p></div>`;
  }

  // «Load failed» (Safari) / «Failed to fetch» (Chrome): no se llegó al servidor. En el plan gratuito, Supabase pausa el proyecto tras una semana sin uso.
  const netFail = m => /load failed|failed to fetch|networkerror|network request failed/i.test(String(m || ''));
  const NET_MSG = 'No se pudo conectar con el servidor de sincronización. Si tienes internet, es probable que el proyecto de Supabase esté en pausa por inactividad: hay que reactivarlo desde supabase.com (Restore project).';
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'sync-login') return;
    ev.preventDefault();
    const form = ev.target, email = String(new FormData(form).get('email') || '').trim(), btn = form.querySelector('button'), out = form.parentElement.querySelector('.sync-msg');
    const show = (msg, bad) => { if (out) { out.textContent = msg; out.className = 'sync-msg ' + (bad ? 'bad' : 'ok'); } app().toast(msg); };
    if (!client) { show('No se pudo cargar el servicio de sincronización. Revisa tu conexión y recarga la página (Ctrl + Shift + R).', true); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const {error} = await client.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname}});
      if (error) show(/rate|limit|seconds/i.test(error.message) ? 'Ya se enviaron varios enlaces hace poco. Usa el último correo que te llegó o espera unos minutos y vuelve a intentarlo.' : netFail(error.message) ? NET_MSG : 'No se pudo enviar el enlace: ' + error.message, true);
      else show(`Enlace enviado a ${email}. Ábrelo en este mismo navegador (revisa también Spam o Promociones).`, false);
    } catch (e) { show(netFail(e.message) ? NET_MSG : 'No se pudo enviar el enlace: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Enviar enlace'; }
  });

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-sync]');
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.sync === 'now') { await pull().catch(e => setStatus('error', e.message)); app().toast(status === 'error' ? 'No se pudo sincronizar: ' + lastError : 'Sincronizado: tienes lo último de la nube.'); }
    if (el.dataset.sync === 'logout') { await client.auth.signOut(); user = null; setStatus('local'); app().toast('Sesión cerrada. El progreso sigue guardado en este dispositivo.'); }
    document.getElementById('modal')?.close();
  });

  async function init() {
    if (!enabled) return;
    try {
      await loadLibrary();
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {auth: {flowType: 'pkce', detectSessionInUrl: true, persistSession: true}});
      client.auth.onAuthStateChange((_event, session) => {
        const was = user?.id;
        user = session?.user || null;
        if (!user) setStatus('local');
        if (user && user.id !== was) {
          if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
          pull().catch(e => setStatus('error', e.message));
        }
      });
      window.addEventListener('online', () => user && pull().catch(() => {}));
      // Traer lo último de la nube al volver a la pestaña (p. ej., si se dejó abierta desde la mañana) y cada 5 minutos.
      const refresh = (force = false) => { if (!user || document.visibilityState === 'hidden') return; if (!force && Date.now() - lastPull < 20000) return; lastPull = Date.now(); pull().catch(e => setStatus('error', e.message)); };
      document.addEventListener('visibilitychange', () => refresh());
      window.addEventListener('focus', () => refresh());
      window.addEventListener('pageshow', ev => ev.persisted && refresh(true));
      setInterval(() => refresh(true), 5 * 60000);
    } catch (e) { setStatus('error', e.message); }
  }

  window.PMPSync = {init, schedulePush, panel, label, merge, pull: () => pull(), get enabled() { return enabled; }, get user() { return user; }};
})();
