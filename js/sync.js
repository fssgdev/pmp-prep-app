'use strict';
// Sincronización del progreso con Supabase (tabla public.progress, ver supabase/schema.sql).
// Si js/config.js no tiene credenciales, la app funciona solo con localStorage.
(() => {
  const cfg = window.PMP_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let client = null, user = null, timer = null, status = 'local', lastError = '';

  const app = () => window.PMPApp;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localUpdated = () => { try { return localStorage.getItem(app().KEY + '-updated') || ''; } catch { return ''; } };

  function setStatus(s, err = '') {
    status = s; lastError = err;
    const el = document.getElementById('save-state');
    if (el) el.innerHTML = label();
  }

  function label() {
    if (!enabled || !user) return '<i></i> Guardado en este dispositivo';
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
      if (!out.tasksDone[id] || at < out.tasksDone[id]) out.tasksDone[id] = at;
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
    if (localUpdated() === data.updated_at) { setStatus('synced'); return; }
    const local = app().getState(), merged = merge(local, data.state, localUpdated() > data.updated_at);
    const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
    if (changedLocal && app().setState(merged)) app().toast('Progreso actualizado desde la nube.');
    if (JSON.stringify(merged) !== JSON.stringify(data.state)) await write(merged);
    else { try { localStorage.setItem(app().KEY + '-updated', data.updated_at); } catch {} }
    setStatus('synced');
  }

  async function write(st) {
    const updated_at = new Date().toISOString();
    const {error} = await client.from('progress').upsert({user_id: user.id, state: st, updated_at});
    if (error) throw error;
    try { localStorage.setItem(app().KEY + '-updated', updated_at); } catch {}
  }

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
        if (JSON.stringify(merged) !== JSON.stringify(st) && app().setState(merged)) st = merged;
      }
      await write(st);
      setStatus('synced');
    } catch (e) { setStatus('error', e.message); }
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(() => push().catch(e => setStatus('error', e.message)), 1500);
  }

  function panel() {
    if (!enabled) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Aún no configurada. Mientras tanto, tu progreso se guarda en este navegador.</p></div>`;
    if (user) return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Sesión iniciada como <strong>${esc(user.email)}</strong>. Tu progreso se guarda automáticamente y se comparte entre tus dispositivos.${lastError ? '<br>Último error: ' + esc(lastError) : ''}</p><div class="actions"><button class="button light small" data-sync="now">Sincronizar ahora</button><button class="button white small" data-sync="logout">Cerrar sesión</button></div></div>`;
    return `<div class="sync-box"><h3>Sincronización en la nube</h3><p class="hint">Escribe tu correo y abre el enlace que te llegará <strong>en este mismo dispositivo</strong>. Repite en cada dispositivo que uses.</p><form id="sync-login"><input type="email" name="email" required placeholder="tu@correo.com" aria-label="Correo"><button class="button small" type="submit">Enviar enlace</button></form></div>`;
  }

  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'sync-login') return;
    ev.preventDefault();
    const email = new FormData(ev.target).get('email');
    const {error} = await client.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname}});
    app().toast(error ? 'No se pudo enviar el enlace: ' + error.message : 'Revisa tu correo y abre el enlace en este dispositivo.');
  });

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-sync]');
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.sync === 'now') { await pull().catch(e => setStatus('error', e.message)); app().toast('Sincronizado.'); }
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
        if (user && user.id !== was) {
          if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
          pull().catch(e => setStatus('error', e.message));
        }
      });
      window.addEventListener('online', () => user && pull().catch(() => {}));
    } catch (e) { setStatus('error', e.message); }
  }

  window.PMPSync = {init, schedulePush, panel, label, merge, get enabled() { return enabled; }};
})();
