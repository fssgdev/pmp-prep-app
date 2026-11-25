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
    const [modules, calendar, questions, lessons, scenarios, concepts, tips, weeklyPlan, glossary, retired] = await Promise.all([
      get('data/modules.json'), get('data/calendar.json'), get('data/questions.json'), get('data/lessons.json'),
      get('data/scenarios.json'), get('data/concepts.json'), get('data/tips.json'), get('data/weekly-plan.json'), get('data/glossary.json').catch(() => ({terms: []})),
      get('data/questions-retired.json').catch(() => ({questions: []}))
    ]);
    window.PMP_DATA = {modules, sessions: calendar.sessions, stages: calendar.stages, questions, course: lessons, scenarios, concepts, tips, weeklyPlan, glossary: glossary.terms || [], retired: retired.questions || []};
    const load = src => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src)); document.body.append(s); });
    await load('js/study.js');
    await load('js/items.js');
    await load('js/results.js');
    await load('js/pdfimport.js');
    await load('js/sessions.js');
    await load('js/mock.js');
    await load('js/app.js');
  } catch (err) {
    main.innerHTML = '<p class="loading">No se pudo cargar el contenido de la app. Recarga la página.<br><small>' +
      String(err.message).replace(/[<>&]/g, '') + '</small></p>';
  }
})();
