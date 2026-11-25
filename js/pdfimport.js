'use strict';
/* Importación de PDF en el navegador (nada se sube a ningún servidor). Usa pdf.js (Apache-2.0) en assets/vendor/pdfjs.
   1) Quiz de Google Forms impreso a PDF («printable»): detecta cada pregunta, la marca como fallada si su bloque
      tiene rojo (íconos o texto), puntaje menor que el máximo o una sección «Respuesta correcta», y tras tu revisión
      guarda los fallos en el registro (fuente 'pdf'), que entran al bucle de repaso (tarjetas y temas reforzados).
   2) Glosario oficial (Glossary_for_PMP_2026_ES_v4.1.pdf): extrae término y definición textual y los guarda SOLO en
      este dispositivo (localStorage 'pmp-glossary-official'), porque es material de PMI y el repositorio es público. */

let pdfjsLib = null, pdfImport = null, pdfBusy = false;
const OFFICIAL_KEY = 'pmp-glossary-official';
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(new URL('assets/vendor/pdfjs/pdf.min.js', location.href).href);
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.js', location.href).href;
  return pdfjsLib;
}
const isRedPx = (r, g, b) => r > 150 && r - g > 70 && r - b > 60;
/* Líneas de una página: texto, y (en el lienzo), fuente en negrita y píxeles rojos de su franja. */
async function pdfPageLines(pdf, page, pn, {render = false} = {}) {
  const scale = 1.5, vp = page.getViewport({scale});
  let red = null;
  if (render) {
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    await page.render({canvasContext: ctx, viewport: vp}).promise;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; red = new Uint32Array(canvas.height);
    for (let y = 0; y < canvas.height; y++) { let c = 0; for (let x = 0, i = y * canvas.width * 4; x < canvas.width; x++, i += 4) if (isRedPx(data[i], data[i + 1], data[i + 2])) c++; red[y] = c; }
  } else await page.getOperatorList();
  const tc = await page.getTextContent(), rows = new Map();
  for (const it of tc.items) {
    if (!it.str) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform), y = Math.round(t[5] / 3) * 3, h = Math.hypot(t[2], t[3]);
    let font = ''; try { font = page.commonObjs.get(it.fontName)?.name || ''; } catch (e) { font = ''; }
    const r = rows.get(y) || {page: pn, y, h, x: t[4], parts: []};
    r.parts.push({x: t[4], str: it.str, bold: /bold|black|heavy|semibold/i.test(font)}); r.x = Math.min(r.x, t[4]); r.h = Math.max(r.h, h);
    rows.set(y, r);
  }
  return [...rows.values()].sort((a, b) => a.y - b.y).map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    const text = r.parts.map(p => p.str).join('').replace(/\s+/g, ' ').trim(), vis = r.parts.filter(p => p.str.trim());
    return {page: pn, y: r.y, h: r.h, x: r.x, ph: vp.height, text, allBold: vis.length > 0 && vis.every(p => p.bold || /^[\s.,;:()]+$/.test(p.str)), red: red ? red : null};
  }).filter(l => l.text);
}
async function pdfLines(file, opts) {
  const lib = await loadPdfjs(), pdf = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise, out = [];
  for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); out.push(...await pdfPageLines(pdf, page, p, opts)); page.cleanup(); }
  return out;
}

/* ---------- quiz de Google Forms ---------- */
const POINTS = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(?:pts?\.?|puntos?)?\s*$/i;
function redBetween(lines, a, b) {
  // píxeles rojos en la franja vertical de las líneas a..b (puede cruzar páginas)
  let total = 0;
  for (let i = a; i <= b; i++) {
    const l = lines[i], nxt = lines[i + 1], top = Math.max(0, Math.floor(l.y - l.h * 1.2)), bottom = nxt && nxt.page === l.page ? Math.floor(nxt.y - nxt.h * 1.2) : Math.min(l.red?.length || 0, Math.floor(l.y + l.h * 2));
    if (!l.red) continue; for (let y = top; y < bottom && y < l.red.length; y++) total += l.red[y];
  }
  return total;
}
function parseFormsLines(lines) {
  const header = lines.slice(0, 6).map(l => l.text);
  const title = header.find(t => /Q\d+|ECO|PMP/i.test(t)) || header[0] || 'Quiz importado';
  const eco = (title.match(/ECO\s*(\d)\.(\d{1,2})/i) || []), topic = eco[1] ? (D.modules.flatMap(m => m.topics).find(t => t.code === `${eco[1]}.${eco[2]}`) || null) : null;
  const isTotal = t => /total|puntuaci[oó]n|score/i.test(t);
  let starts = lines.map((l, i) => POINTS.test(l.text) && !isTotal(l.text) && i > 0 ? i : -1).filter(i => i >= 0);
  let mode = 'puntos';
  if (!starts.length) { starts = lines.map((l, i) => /^\s*\d{1,3}\s*[.)]\s+\S/.test(l.text) ? i : -1).filter(i => i >= 0); mode = 'numeradas'; }
  const blocks = starts.map((s, k) => {
    const e = (starts[k + 1] ?? lines.length) - 1, ls = lines.slice(s, e + 1), m = ls[0].text.match(POINTS);
    let prompt = ls[0].text.replace(POINTS, '').replace(/\*\s*$/, '').trim();
    if (mode === 'puntos' && prompt.length < 25) {
      // la pregunta puede estar en las líneas anteriores al puntaje
      if (prompt.length < 25 && ls[1]) prompt = (prompt + ' ' + ls[1].text).trim();
    }
    const ci = ls.findIndex(l => /^respuestas? correctas?/i.test(l.text));
    const correctText = ci >= 0 ? ls.slice(ci + 1).filter(l => !/^(comentarios?|feedback|retroalimentaci)/i.test(l.text)).slice(0, 3).map(l => l.text).join(' · ') : '';
    const earned = m ? parseFloat(m[1].replace(',', '.')) : null, max = m ? parseFloat(m[2].replace(',', '.')) : null;
    const red = redBetween(lines, s, e), redLines = ls.slice(1).filter((l, i) => l.red && redBetween(lines, s + 1 + i, s + 1 + i) > 15).map(l => l.text);
    const reasons = [];
    if (m && earned < max) reasons.push(`puntaje ${m[1]}/${m[2]}`);
    if (red > 40) reasons.push('marcada en rojo');
    if (ci >= 0) reasons.push('muestra la respuesta correcta');
    return {n: k + 1, prompt: prompt.slice(0, 600), correctText: correctText.slice(0, 400), yourText: redLines.filter(t => !POINTS.test(t)).slice(0, 2).join(' · ').slice(0, 300), wrong: reasons.length > 0, reasons, pick: reasons.length > 0};
  });
  return {title, topicId: topic?.id || null, mode, blocks};
}
async function importFormsPdf(file) {
  pdfBusy = true; render();
  try {
    const lines = await pdfLines(file, {render: true});
    pdfImport = {file: file.name, ...parseFormsLines(lines)};
    if (!pdfImport.blocks.length) toast('No encontré preguntas en este PDF. Envíaselo a Claude para ajustar el lector.');
  } catch (err) { toast('No se pudo leer el PDF: ' + err.message); pdfImport = null; }
  pdfBusy = false; render();
}
function saveFormsImport() {
  const imp = pdfImport; if (!imp) return;
  ensureResults();
  const t = imp.topicId ? topicBy(imp.topicId) : null, module = imp.topicId ? imp.topicId.split('-')[0] : null;
  const next = workDay(plusDays(today(), 1), true); let n = 0;
  imp.blocks.filter(b => b.pick).forEach(b => {
    const prev = state.errors.find(e => !e.resolved && e.source === 'pdf' && e.prompt === b.prompt);
    if (prev) { prev.misses = (prev.misses || 1) + 1; prev.due = next; prev.updated = stamp(); n++; return; }
    state.errors.unshift({id: uid(), questionId: null, topicId: imp.topicId, module, prompt: b.prompt, correctText: b.correctText, yourText: b.yourText, quiz: imp.title, category: 'Conceptual', lesson: b.correctText ? 'Respuesta correcta: ' + b.correctText : 'Revisa la respuesta correcta en el quiz.', action: 'Vuelve como tarjeta en Flashcards y refuerza su tema en tus cuestionarios.', date: today(), due: next, resolved: false, source: 'pdf', hits: 0, misses: 1, updated: stamp()});
    n++;
  });
  const total = imp.blocks.length, wrong = imp.blocks.filter(b => b.pick).length;
  recordResult({kind: 'import', label: imp.title + (t ? '' : ''), taskId: null, total, correct: total - wrong, dom: module ? {[module]: {total, correct: total - wrong}} : {}, wrong: [], source: imp.file});
  pdfImport = null; save(); render();
  toast(`${n} ${n === 1 ? 'fallo guardado' : 'fallos guardados'}: volverán como tarjetas y reforzarán ${t ? 'la tarea ' + t.code : 'tus repasos'}.`);
}
function renderPdfImport() {
  const imp = pdfImport;
  if (imp) return `<section class="card pdf-import"><div class="card-header"><div><h2>Revisa lo detectado</h2><p>${esc(imp.file)} · ${esc(imp.title)}${imp.topicId ? ' · ' + esc(topicLabel(imp.topicId)) : ''}</p></div></div>
    <p class="hint">Marqué como fallo ${imp.blocks.filter(b => b.wrong).length} de ${imp.blocks.length} preguntas (rojo, puntaje menor o «Respuesta correcta»). Corrige lo que haga falta antes de guardar.</p>
    <div class="pdf-blocks">${imp.blocks.map((b, i) => `<label class="pdf-block ${b.pick ? 'wrong' : ''}"><input type="checkbox" data-pdf-pick="${i}" ${b.pick ? 'checked' : ''}><span><strong>${b.n}.</strong> ${esc(b.prompt || '(sin texto)')}${b.correctText ? `<br><small>Correcta: ${esc(b.correctText)}</small>` : ''}${b.reasons.length ? `<br><small class="pdf-why">${esc(b.reasons.join(' · '))}</small>` : ''}</span></label>`).join('')}</div>
    <div class="actions">${button(`Guardar ${imp.blocks.filter(b => b.pick).length} fallos`, 'pdf-save', '')}${button('Descartar', 'pdf-cancel', 'white')}</div></section>`;
  return `<section class="card pdf-import"><div class="card-header"><div><h2>Importar un quiz de Google Forms</h2><p>PDF del «printable» de tus cuestionarios Q1–Q28</p></div>${icon('download')}</div>
    <p class="hint">En el formulario, abre «Ver puntuación», imprime y elige «Guardar como PDF» (con «Gráficos de fondo» activado). Las preguntas en rojo se guardan como fallos, vuelven como tarjetas y refuerzan su tarea del ECO en tus cuestionarios. El PDF se lee en tu dispositivo; no se sube a ningún lado.</p>
    <label class="button light file-button">${pdfBusy ? 'Leyendo el PDF…' : 'Elegir PDF'}<input type="file" id="forms-pdf" accept="application/pdf" ${pdfBusy ? 'disabled' : ''}></label></section>`;
}

/* ---------- glosario oficial (solo en este dispositivo) ---------- */
function parseGlossaryLines(lines) {
  const out = []; let cur = null, prev = null;
  const skip = l => l.y > l.ph * 0.93 || /^[®\s]+$|^Preparación para el examen PMP|autorizado\/a pedido de PMI|^\d+$|^Glosario de términos|^Project Management|^Curso de preparación|^Abril de 20\d\d/i.test(l.text);
  for (const l of lines) {
    if (skip(l)) continue;
    const gap = prev && prev.page === l.page ? l.y - prev.y : 99;
    if (l.allBold && gap > l.h * 1.6) { cur = {term: l.text.replace(/\s+/g, ' ').trim(), def: ''}; out.push(cur); }
    else if (cur) cur.def = (cur.def + ' ' + l.text).trim();
    prev = l;
  }
  return out.map(e => ({term: e.term, def: e.def.replace(/(\s*®)+\s*$/g, '').replace(/^\s*(®\s*)+/, '').trim()})).filter(e => e.term.length < 120 && e.def.length > 3);
}
async function importOfficialGlossary(file) {
  pdfBusy = true; render();
  try {
    const terms = parseGlossaryLines(await pdfLines(file, {render: false}));
    if (terms.length < 50) throw new Error('el archivo no parece el glosario del curso');
    localStorage.setItem(OFFICIAL_KEY, JSON.stringify({file: file.name, at: stamp(), terms}));
    officialGlossary.cache = null; allCards.cache = null;
    toast(`Glosario oficial cargado en este dispositivo: ${terms.length} términos.`);
  } catch (err) { toast('No se pudo leer el glosario: ' + err.message); }
  pdfBusy = false; render();
}
function officialGlossary() {
  if (officialGlossary.cache === undefined || officialGlossary.cache === null) { try { officialGlossary.cache = JSON.parse(localStorage.getItem(OFFICIAL_KEY) || 'null'); } catch (e) { officialGlossary.cache = false; } }
  return officialGlossary.cache || null;
}
const normTerm = t => plain(String(t)).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
function officialFor(term) {
  const g = officialGlossary(); if (!g) return null;
  if (!officialFor.map || officialFor.src !== g) { officialFor.map = new Map(g.terms.map(t => [normTerm(t.term), t])); officialFor.src = g; officialFor.alias = new Map((D.glossary || []).filter(x => x.official).map(x => [normTerm(x.term), normTerm(x.official)])); }
  const k = normTerm(term);
  return officialFor.map.get(k) || officialFor.map.get(officialFor.alias.get(k)) || null;
}
function renderOfficialBox() {
  const g = officialGlossary();
  return `<section class="card official-box"><div class="card-header"><div><h2>Definiciones oficiales (texto de PMI)</h2><p>${g ? `${g.terms.length} términos cargados en este dispositivo el ${date(stampDay(g.at))}` : 'Aún no cargadas en este dispositivo'}</p></div>${g ? badge('Cargado', 'green') : badge('Opcional', 'orange')}</div>
  <p class="hint">Sube el PDF «Glossary_for_PMP_2026_ES_v4.1» de la carpeta 0 del Drive. El texto oficial se guarda solo en este navegador (no en el sitio público ni en la nube): aparece junto a cada definición simplificada y en el reverso de sus tarjetas. Hazlo una vez en cada dispositivo.</p>
  <div class="actions"><label class="button light file-button">${pdfBusy ? 'Leyendo el PDF…' : g ? 'Volver a cargar el PDF' : 'Cargar el PDF del glosario'}<input type="file" id="gloss-pdf" accept="application/pdf" ${pdfBusy ? 'disabled' : ''}></label>
  ${g ? `<label class="checkline"><input type="checkbox" id="gloss-all-cards" ${state.settings.glossaryAllCards ? 'checked' : ''}> Crear también tarjetas con los ${Math.max(0, g.terms.length - (D.glossary || []).filter(x => officialFor(x.term)).length)} términos oficiales que no tienen versión simplificada</label>${button('Quitar de este dispositivo', 'gloss-official-remove', 'ghost small')}` : ''}</div></section>`;
}
/* Tarjetas extra con los términos oficiales sin versión simplificada (opcional). */
function officialOnlyCards() {
  const g = officialGlossary(); if (!g || !state.settings?.glossaryAllCards) return [];
  const mine = new Set((D.glossary || []).flatMap(x => [normTerm(x.term), x.official ? normTerm(x.official) : '']));
  return g.terms.filter(t => !mine.has(normTerm(t.term))).map(t => ({id: 'go-' + normTerm(t.term).replace(/ /g, '-').slice(0, 48), front: t.term, back: t.def, gloss: true, official: true, lesson: 9, concept: 'Glosario oficial'}));
}

const PDF_ACTIONS = {
  'pdf-save': () => saveFormsImport(),
  'pdf-cancel': () => { pdfImport = null; render(); },
  'gloss-official-remove': () => { localStorage.removeItem(OFFICIAL_KEY); officialGlossary.cache = null; allCards.cache = null; render(); toast('Se quitaron las definiciones oficiales de este dispositivo.'); }
};
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'forms-pdf' && el.files[0]) importFormsPdf(el.files[0]);
  else if (el.id === 'gloss-pdf' && el.files[0]) importOfficialGlossary(el.files[0]);
  else if (el.dataset.pdfPick !== undefined && pdfImport) { pdfImport.blocks[Number(el.dataset.pdfPick)].pick = el.checked; render(); }
  else if (el.id === 'gloss-all-cards') { state.settings.glossaryAllCards = el.checked; allCards.cache = null; save(); render(); }
});

Object.assign(STUDY_ACTIONS, PDF_ACTIONS);
