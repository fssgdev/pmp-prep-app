'use strict';
// Carga el contenido (data/*.json) y luego arranca la app (js/app.js).
(async () => {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="loading">Cargando tu espacio de preparación…</p>';
  const get = path => fetch(path, {cache: 'no-cache'}).then(r => {
    if (!r.ok) throw new Error(path + ' → ' + r.status);
    return r.json();
  });
  try {
    const [modules, calendar, questions, lessons, scenarios] = await Promise.all([
      get('data/modules.json'), get('data/calendar.json'), get('data/questions.json'), get('data/lessons.json'), get('data/scenarios.json')
    ]);
    window.PMP_DATA = {modules, sessions: calendar.sessions, stages: calendar.stages, questions, course: lessons, scenarios};
    const s = document.createElement('script');
    s.src = 'js/app.js';
    document.body.append(s);
  } catch (err) {
    main.innerHTML = '<p class="loading">No se pudo cargar el contenido de la app. Recarga la página.<br><small>' +
      String(err.message).replace(/[<>&]/g, '') + '</small></p>';
  }
})();
