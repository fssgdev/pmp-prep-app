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

  async function pull() {
    const {data, error} = await client.from('progress').select('state, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) { await push(); return; }                       // primera vez: sube lo local
    if (!localUpdated() || data.updated_at > localUpdated()) { // la nube es más reciente
      if (app().setState(data.state)) {
        try { localStorage.setItem(app().KEY + '-updated', data.updated_at); } catch {}
        app().toast('Progreso actualizado desde la nube.');
      }
    } else if (localUpdated() > data.updated_at) {
      await push();
    }
    setStatus('synced');
  }

  async function push() {
    if (!client || !user) return;
    setStatus('syncing');
    const updated_at = localUpdated() || new Date().toISOString();
    const {error} = await client.from('progress').upsert({user_id: user.id, state: app().getState(), updated_at});
    if (error) { setStatus('error', error.message); return; }
    setStatus('synced');
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

  window.PMPSync = {init, schedulePush, panel, label, get enabled() { return enabled; }};
})();
