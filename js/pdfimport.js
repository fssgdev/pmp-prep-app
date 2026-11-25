'use strict';
/* Importación de PDF en el navegador (nada se sube a ningún servidor). Usa pdf.js (Apache-2.0) en assets/vendor/pdfjs.
   1) Quiz de Google Forms impreso a PDF («printable»): detecta cada pregunta, la marca como fallada si su bloque
      tiene rojo (íconos o texto), puntaje menor que el máximo o una sección «Respuesta correcta», y tras tu revisión
      guarda los fallos en el registro (fuente 'pdf'), que entran al bucle de repaso (tarjetas y temas reforzados).
   2) Glosario oficial (Glossary_for_PMP_2026_ES_v4.1.pdf): extrae término y definición textual y los guarda SOLO en
      este dispositivo (localStorage 'pmp-glossary-official'), porque es material de PMI y el repositorio es público. */

let pdfjsLib = null, pdfImport = null, pdfBusy = false, pdfImportSession = null;
const OFFICIAL_KEY = 'pmp-glossary-official';
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(new URL('assets/vendor/pdfjs/pdf.min.js', location.href).href);
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.js', location.href).href;
  return pdfjsLib;
}
const isRedPx = (r, g, b) => r > 150 && r - g > 70 && r - b > 60;
const isGreenPx = (r, g, b) => g > 90 && g - r > 40 && g - b > 15;
const isLavPx = (r, g, b) => r > 215 && g > 205 && b - r >= 5 && b - g >= 6; // fondo lila/celeste de Forms
const isWhitePx = (r, g, b) => r > 244 && g > 244 && b > 244;
/* Líneas de una página: texto, y (en el lienzo), fuente en negrita y píxeles rojos de su franja.
   Con visual: true además ubica las preguntas calificadas de Google Forms por su ícono (× rojo / ✓ verde) y recorta cada una;
   así funciona aunque el PDF no tenga texto (por ejemplo, «Microsoft Print to PDF» dibuja las letras como figuras). */
async function pdfPageLines(pdf, page, pn, {render = false, visual = false} = {}) {
  const w1 = page.getViewport({scale: 1}).width, scale = visual ? Math.min(3, Math.max(1.5, 1300 / w1)) : 1.5, vp = page.getViewport({scale});
  let red = null, icons = [];
  if (render || visual) {
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({canvasContext: ctx, viewport: vp}).promise;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; red = new Uint32Array(canvas.height);
    for (let y = 0; y < canvas.height; y++) { let c = 0; for (let x = 0, i = y * canvas.width * 4; x < canvas.width; x++, i += 4) if (isRedPx(data[i], data[i + 1], data[i + 2])) c++; red[y] = c; }
    if (visual) icons = formsIcons(data, canvas.width, canvas.height, canvas, pn);
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
  const lines = [...rows.values()].sort((a, b) => a.y - b.y).map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    const text = r.parts.map(p => p.str).join('').replace(/\s+/g, ' ').trim(), vis = r.parts.filter(p => p.str.trim());
    return {page: pn, y: r.y, h: r.h, x: r.x, ph: vp.height, text, allBold: vis.length > 0 && vis.every(p => p.bold || /^[\s.,;:()]+$/.test(p.str)), red: red ? red : null};
  }).filter(l => l.text);
  return visual ? {lines, icons} : lines;
}
async function pdfLines(file, opts) {
  const lib = await loadPdfjs(), pdf = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise, out = [];
  for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); out.push(...await pdfPageLines(pdf, page, p, opts)); page.cleanup(); }
  return out;
}
/* Quiz completo: líneas de texto (si las hay), íconos de cada pregunta con sus recortes y título del documento. */
async function pdfScanForms(file) {
  const lib = await loadPdfjs(), pdf = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise, lines = [], icons = [];
  let title = ''; try { title = String((await pdf.getMetadata())?.info?.Title || '').trim(); } catch (e) { title = ''; }
  for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p), r = await pdfPageLines(pdf, page, p, {visual: true}); lines.push(...r.lines); icons.push(...r.icons); page.cleanup(); }
  return {title, lines, icons};
}

/* ---------- detección visual de las preguntas de Google Forms ---------- */
/* Bordes de las tarjetas blancas: primer píxel que no es fondo lila al entrar desde cada lado (moda de muchas filas). */
function formsCardEdges(d, W, H) {
  const L = new Map(), R = new Map(), lav = i => isLavPx(d[i], d[i + 1], d[i + 2]);
  for (let y = Math.floor(H * 0.04); y < H * 0.96; y += 5) {
    let seen = 0, l = -1, r = -1;
    for (let x = 0; x < W / 2; x++) { if (lav((y * W + x) * 4)) seen++; else if (seen >= 8) { l = x; break; } }
    seen = 0;
    for (let x = W - 1; x > W / 2; x--) { if (lav((y * W + x) * 4)) seen++; else if (seen >= 8) { r = x; break; } }
    if (l > 0 && r > 0) { L.set(l, (L.get(l) || 0) + 1); R.set(r, (R.get(r) || 0) + 1); }
  }
  const mode = m => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  const left = mode(L), right = mode(R);
  return left != null && right != null && right - left > W * 0.3 ? {left, right} : null;
}
/* Íconos de calificación (× rojo o ✓ verde) a la izquierda del enunciado de cada pregunta, con sus recortes. */
function formsIcons(d, W, H, canvas, pn) {
  const kind = i => isRedPx(d[i], d[i + 1], d[i + 2]) ? 1 : isGreenPx(d[i], d[i + 1], d[i + 2]) ? 2 : 0;
  const blank = i => isWhitePx(d[i], d[i + 1], d[i + 2]) || isLavPx(d[i], d[i + 1], d[i + 2]);
  const edges = formsCardEdges(d, W, H), cw = edges ? edges.right - edges.left : W * 0.6;
  const y0 = 0, y1 = H; // toda la página: una tarjeta puede empezar justo en el borde
  const xa = edges ? edges.left + 1 : Math.floor(W * 0.04), xb = edges ? edges.left + Math.round(cw * 0.12) : Math.floor(W * 0.45);
  let ix = -1; // columna del ícono: la primera con color dentro del margen izquierdo de la tarjeta
  for (let x = xa; x < xb && ix < 0; x++) { let c = 0; for (let y = y0; y < y1; y++) if (kind((y * W + x) * 4) && ++c >= 3) { ix = x; break; } }
  if (ix < 0) return [];
  const bx = ix + Math.max(6, Math.round(cw * 0.038)), runs = []; let cur = null;
  for (let y = y0; y < y1; y++) {
    let r = 0, g = 0, mn = 1e9, mx = -1;
    for (let x = Math.max(0, ix - 2); x <= bx; x++) { const k = kind((y * W + x) * 4); if (k) { if (k === 1) r++; else g++; mn = Math.min(mn, x); mx = Math.max(mx, x); } }
    if (!(r + g)) continue;
    if (cur && y - cur.y1 <= 3) { cur.y1 = y; cur.r += r; cur.g += g; cur.mn = Math.min(cur.mn, mn); cur.mx = Math.max(cur.mx, mx); }
    else runs.push(cur = {y0: y, y1: y, r, g, mn, mx});
  }
  const icons = runs.filter(u => {
    const h = u.y1 - u.y0 + 1, w = u.mx - u.mn + 1;
    if (h < cw * 0.014 || h > cw * 0.05 || w / h < 0.5 || w / h > 2) return false;
    // un ícono va seguido de un espacio en blanco antes del número de la pregunta (las letras no)
    for (let y = u.y0; y <= u.y1; y++) for (let x = u.mx + 2; x <= Math.min(W - 1, u.mx + Math.ceil(h * 0.45)); x++) if (!blank((y * W + x) * 4)) return false;
    return true;
  }).map(u => ({page: pn, y0: u.y0, y1: u.y1, x0: u.mn, x1: u.mx, h: u.y1 - u.y0 + 1, color: u.r >= u.g ? 'red' : 'green'}));
  icons.forEach((ic, k) => {
    // fin del enunciado: líneas del mismo color que el ícono (el enunciado se pinta de rojo o verde)
    const want = ic.color === 'red' ? isRedPx : isGreenPx, limit = k + 1 < icons.length ? icons[k + 1].y0 - 2 : y1;
    const ta = ic.x1 + Math.ceil(ic.h * 0.6), tb = edges ? edges.left + Math.round(cw * 0.82) : Math.min(W - 1, ic.x0 + Math.round(cw * 0.78));
    let last = ic.y1;
    for (let y = ic.y0; y < limit && y - last <= ic.h * 1.6; y++) for (let x = ta; x < tb; x++) { const i = (y * W + x) * 4; if (want(d[i], d[i + 1], d[i + 2])) { last = y; break; } }
    ic.titleBottom = last;
    // tarjeta completa: a lo largo de su borde izquierdo (gris) hasta que vuelve el fondo
    let top = Math.max(0, ic.y0 - ic.h), bottom = Math.min(limit, ic.y0 + Math.round(cw * 0.9));
    if (edges) {
      const on = y => { const i = (y * W + edges.left) * 4; return !blank(i); };
      let miss = 0, y = ic.y0; while (y > 0 && miss < 3) { y--; miss = on(y) ? 0 : miss + 1; } top = y + 3;
      miss = 0; y = ic.y1; while (y < H - 1 && y < limit && miss < 3) { y++; miss = on(y) ? 0 : miss + 1; } bottom = y - 3;
    }
    const left = edges ? edges.left : Math.max(0, ic.x0 - Math.round(cw * 0.05)), right = edges ? edges.right : Math.min(W - 1, ic.x0 + Math.round(cw * 0.95));
    ic.cardBottom = bottom;
    ic.front = cropJpeg(canvas, left, Math.max(0, ic.y0 - Math.round(ic.h * 0.9)), right - left + 1, Math.min(H, ic.titleBottom + Math.round(ic.h * 0.9)) - Math.max(0, ic.y0 - Math.round(ic.h * 0.9)));
    ic.back = cropJpeg(canvas, left, top, right - left + 1, Math.max(ic.h * 3, Math.min(bottom - top, Math.round(cw * 1.6))));
  });
  return icons;
}
function cropJpeg(canvas, x, y, w, h, maxW = 720) {
  if (w < 4 || h < 4) return '';
  const s = Math.min(1, maxW / w), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
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
const quizTopicId = title => { const eco = String(title).match(/ECO\s*(\d)\.(\d{1,2})/i) || []; return eco[1] ? (D.modules.flatMap(m => m.topics).find(t => t.code === `${eco[1]}.${eco[2]}`)?.id || null) : null; };
const quizTitle = (lines, docTitle) => {
  const quizLike = t => /Q\d+|ECO|PMP/i.test(t || ''), meta = /^(untitled|sin t[ií]tulo|documento?)$/i.test(docTitle || '') ? '' : (docTitle || '');
  return (quizLike(meta) ? meta : lines.slice(0, 6).map(l => l.text).find(quizLike)) || meta || lines[0]?.text || 'Quiz importado';
};
function parseFormsLines(lines, docTitle = '') {
  const title = quizTitle(lines, docTitle), topic = quizTopicId(title) ? {id: quizTopicId(title)} : null;
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
/* Preguntas ubicadas por su ícono; el texto (si el PDF lo tiene) se toma de la zona de cada pregunta. */
const redOn = l => { if (!l.red) return 0; let c = 0; for (let y = Math.max(0, Math.floor(l.y - l.h)); y <= Math.min(l.red.length - 1, Math.ceil(l.y + l.h * 0.3)); y++) c += l.red[y]; return c; };
function parseFormsVisual(scan) {
  const {icons, lines} = scan, title = quizTitle(lines, scan.title), clean = t => t.replace(POINTS, '').replace(/\*\s*$/, '').trim();
  const blocks = icons.map((ic, k) => {
    const pl = lines.filter(l => l.page === ic.page);
    const tl = pl.filter(l => l.y >= ic.y0 - ic.h * 0.6 && l.y <= ic.titleBottom + ic.h), body = pl.filter(l => l.y > ic.titleBottom + ic.h && l.y <= ic.cardBottom + ic.h);
    const pts = tl.map(l => l.text.match(POINTS)).find(Boolean);
    let text = tl.map(l => clean(l.text)).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}¿¡"“(]+/u, '').trim();
    const num = text.match(/^(\d{1,3})\s*[.)]\s*/), n = num ? Number(num[1]) : k + 1;
    if (num) text = text.slice(num[0].length);
    const ci = body.findIndex(l => /^respuestas? correctas?/i.test(l.text)), stop = i => /^(comentarios?|feedback|retroalimentaci)/i.test(body[i]?.text || '');
    let correct = []; if (ci >= 0) for (let i = ci + 1; i < body.length && !stop(i) && correct.length < 3; i++) correct.push(body[i].text);
    const yours = body.slice(0, ci >= 0 ? ci : body.length).filter(l => redOn(l) > 3 && !POINTS.test(l.text)).map(l => l.text);
    const reasons = [];
    if (ic.color === 'red') reasons.push('ícono rojo');
    if (pts && parseFloat(pts[1].replace(',', '.')) < parseFloat(pts[2].replace(',', '.'))) reasons.push(`puntaje ${pts[1]}/${pts[2]}`);
    if (ci >= 0) reasons.push('muestra la respuesta correcta');
    return {n, prompt: (text || `Pregunta ${n} de «${title}»`).slice(0, 600), textless: !text, correctText: correct.join(' · ').slice(0, 400), yourText: yours.slice(0, 2).join(' · ').slice(0, 300), wrong: reasons.length > 0, reasons, pick: reasons.length > 0, front: ic.front, back: ic.back};
  });
  return {title, topicId: quizTopicId(title), mode: 'íconos', blocks};
}
async function importFormsPdf(file) {
  pdfBusy = true; render();
  try {
    const scan = await pdfScanForms(file);
    pdfImport = {file: file.name, session: defaultFormsSession(), textless: !scan.lines.length, ...(scan.icons.length ? parseFormsVisual(scan) : parseFormsLines(scan.lines, scan.title))};
    if (!pdfImport.blocks.length) toast(scan.lines.length ? 'No encontré preguntas en este PDF. Envíaselo a Claude para ajustar el lector.' : 'Este PDF no tiene texto ni íconos de calificación reconocibles. Imprime con «Gráficos de fondo» activado.');
  } catch (err) { toast('No se pudo leer el PDF: ' + err.message); pdfImport = null; }
  pdfBusy = false; render();
}
/* Huella del resultado: el mismo quiz con las mismas preguntas falladas no se importa dos veces. */
const formsPrint = imp => [imp.title, imp.blocks.length, imp.blocks.filter(b => b.pick).map(b => b.n).join(',')].join('|');
function formsSessions() { return [...(D.sessions || [])].filter(s => s.date <= today()).sort((a, b) => b.date.localeCompare(a.date)); }
function defaultFormsSession() { const free = formsSessions().find(s => s.date >= BASELINE_START && !state.tasksDone?.['forms-s' + s.id]); return pdfImportSession ?? free?.id ?? null; }
function saveFormsImport() {
  const imp = pdfImport; if (!imp) return;
  ensureResults();
  const sid = imp.session ? Number(imp.session) : null, fp = formsPrint(imp);
  const dup = state.results.find(r => r.kind === 'import' && r.fp === fp);
  if (dup) { if (sid && !dup.session) { dup.session = sid; markTask('forms-s' + sid, true); } pdfImport = null; pdfImportSession = null; save(); render(); toast(`Este resultado ya estaba importado${dup.session ? ' (clase ' + dup.session + ')' : ''}: no se duplicó el historial ni los fallos.`); return; }
  const t = imp.topicId ? topicBy(imp.topicId) : null, module = imp.topicId ? imp.topicId.split('-')[0] : null;
  const next = workDay(plusDays(today(), 1), true); let n = 0;
  imp.blocks.filter(b => b.pick).forEach(b => {
    const prev = state.errors.find(e => !e.resolved && e.source === 'pdf' && e.prompt === b.prompt);
    const img = b.front || b.back ? {front: b.front || '', back: b.back || ''} : null;
    if (prev) { prev.misses = (prev.misses || 1) + 1; prev.due = next; prev.updated = stamp(); if (img) { prev.img = true; pdfImgPut(prev.id, img); } n++; return; }
    const id = uid();
    state.errors.unshift({id, questionId: null, topicId: imp.topicId, module, prompt: b.prompt, correctText: b.correctText, yourText: b.yourText, quiz: imp.title, n: b.n, img: !!img, category: 'Conceptual', lesson: b.correctText ? 'Respuesta correcta: ' + b.correctText : img ? 'Mira la respuesta correcta en la imagen de la pregunta y anota la regla.' : 'Revisa la respuesta correcta en el quiz.', action: 'Vuelve como tarjeta en Flashcards y refuerza su tema en tus cuestionarios.', date: today(), due: next, resolved: false, source: 'pdf', hits: 0, misses: 1, updated: stamp()});
    if (img) pdfImgPut(id, img);
    n++;
  });
  const total = imp.blocks.length, wrong = imp.blocks.filter(b => b.pick).length;
  recordResult({kind: 'import', label: imp.title, taskId: sid ? 'forms-s' + sid : null, session: sid, fp, total, correct: total - wrong, dom: module ? {[module]: {total, correct: total - wrong}} : {}, wrong: [], source: imp.file});
  if (sid) markTask('forms-s' + sid, true);
  pdfImport = null; pdfImportSession = null; save(); render();
  toast(`${n} ${n === 1 ? 'fallo guardado' : 'fallos guardados'}: volverán como tarjetas${t ? ' y reforzarán la tarea ' + t.code : ''}.`);
}
function renderPdfImport() {
  const imp = pdfImport;
  if (imp) {
    const topics = `<select id="pdf-topic"><option value="">Sin tarea del ECO (solo tarjetas)</option>${D.modules.map(m => `<optgroup label="${esc(m.name)}">${m.topics.map(t => `<option value="${t.id}" ${imp.topicId === t.id ? 'selected' : ''}>${esc(t.code + ' · ' + t.title)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    return `<section class="card pdf-import"><div class="card-header"><div><h2>Revisa lo detectado</h2><p>${esc(imp.file)} · ${esc(imp.title)}</p></div></div>
    <p class="hint">Marqué como fallo ${imp.blocks.filter(b => b.wrong).length} de ${imp.blocks.length} preguntas (ícono o texto en rojo, puntaje menor o «Respuesta correcta»). Corrige lo que haga falta antes de guardar.</p>
    ${imp.textless ? `<p class="hint pdf-note">Este PDF no trae texto (lo hizo «Microsoft Print to PDF», que dibuja las letras como imagen). Guardaré la imagen de cada pregunta en este dispositivo para tus tarjetas. Para que el texto llegue también a tus otros dispositivos, imprime con el destino «Guardar como PDF».</p>` : ''}
    <label class="field pdf-topic"><span>Clase a la que corresponde este quiz</span><select id="pdf-session"><option value="">Ninguna (quiz suelto)</option>${formsSessions().map(s => `<option value="${s.id}" ${Number(imp.session) === s.id ? 'selected' : ''}>Clase ${s.id} · ${date(s.date, {weekday: 'short', day: 'numeric', month: 'short'})}${state.tasksDone?.['forms-s' + s.id] ? ' · ya tiene quiz' : ''}</option>`).join('')}</select></label>
    <label class="field pdf-topic"><span>Tarea del ECO que se reforzará con estos fallos</span>${topics}</label>
    <div class="pdf-blocks">${imp.blocks.map((b, i) => `<label class="pdf-block ${b.pick ? 'wrong' : ''}"><input type="checkbox" data-pdf-pick="${i}" ${b.pick ? 'checked' : ''}><span><strong>${b.n}.</strong> ${b.textless && b.front ? `<span class="quiz-img-wrap"><img class="quiz-img" src="${b.front}" alt="Enunciado de la pregunta ${b.n}"></span>` : esc(b.prompt || '(sin texto)')}${b.correctText ? `<br><small>Correcta: ${esc(b.correctText)}</small>` : ''}${b.reasons.length ? `<br><small class="pdf-why">${esc(b.reasons.join(' · '))}</small>` : ''}</span></label>`).join('')}</div>
    <div class="actions">${button(`Guardar ${imp.blocks.filter(b => b.pick).length} fallos`, 'pdf-save', '')}${button('Descartar', 'pdf-cancel', 'white')}</div></section>`;
  }
  return `<section class="card pdf-import"><div class="card-header"><div><h2>Importar un quiz de Google Forms</h2><p>${pdfImportSession ? `Quiz de la clase ${pdfImportSession} · ` : ''}PDF del «printable» de tus cuestionarios Q1–Q28</p></div>${icon('download')}</div>
    <p class="hint">En el formulario, abre «Ver puntuación», imprime y elige «Guardar como PDF» con «Gráficos de fondo» activado (también sirve «Microsoft Print to PDF», pero entonces solo guardo la imagen de cada pregunta). Las preguntas en rojo se guardan como fallos, vuelven como tarjetas y refuerzan su tarea del ECO en tus cuestionarios. El PDF se lee en tu dispositivo; no se sube a ningún lado.</p>
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
  ${g ? `${officialUncovered().length ? `<label class="checkline"><input type="checkbox" id="gloss-all-cards" ${state.settings.glossaryAllCards ? 'checked' : ''}> Crear también tarjetas con los ${officialUncovered().length} términos oficiales que no tienen versión simplificada</label>` : '<span class="hint">Todos los términos oficiales tienen su versión simplificada.</span>'}${button('Quitar de este dispositivo', 'gloss-official-remove', 'ghost small')}` : ''}</div></section>`;
}
/* Tarjetas extra con los términos oficiales sin versión simplificada (opcional). */
function officialUncovered() {
  const g = officialGlossary(); if (!g) return [];
  const mine = new Set((D.glossary || []).flatMap(x => [normTerm(x.term), x.official ? normTerm(x.official) : '', ...(x.aka || []).map(normTerm)]));
  return g.terms.filter(t => !mine.has(normTerm(t.term)));
}
function officialOnlyCards() {
  if (!officialGlossary() || !state.settings?.glossaryAllCards) return [];
  return officialUncovered().map(t => ({id: 'go-' + normTerm(t.term).replace(/ /g, '-').slice(0, 48), front: t.term, back: t.def, gloss: true, official: true, lesson: 9, concept: 'Glosario oficial'}));
}

/* ---------- imágenes de las preguntas importadas (IndexedDB, solo en este dispositivo; no se sincronizan) ---------- */
const PDF_IMG_DB = 'pmp-quiz-img', pdfImgs = new Map();
function pdfImgDb() { return pdfImgDb.p || (pdfImgDb.p = new Promise((ok, fail) => { const r = indexedDB.open(PDF_IMG_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); })); }
async function pdfImgPut(id, v) {
  pdfImgs.set(id, v);
  try { const db = await pdfImgDb(); await new Promise((ok, fail) => { const t = db.transaction('img', 'readwrite'); t.objectStore('img').put(v, id); t.oncomplete = ok; t.onerror = () => fail(t.error); }); }
  catch (e) { toast('No se pudo guardar la imagen de la pregunta en este navegador.'); }
}
async function pdfImgLoad() {
  try {
    const db = await pdfImgDb();
    await new Promise(ok => { const req = db.transaction('img').objectStore('img').openCursor(); req.onsuccess = () => { const c = req.result; if (c) { pdfImgs.set(c.key, c.value); c.continue(); } else ok(); }; req.onerror = () => ok(); });
    if (pdfImgs.size && typeof render === 'function' && /^#(flashcards|errores|simulacros)/.test(location.hash)) render();
  } catch (e) { /* sin IndexedDB: los fallos conservan su texto */ }
}
const quizImg = (id, part, cls = 'quiz-img') => { const v = pdfImgs.get(id)?.[part]; return v && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) ? `<div class="quiz-img-wrap" title="Toca para ampliar"><img class="${cls}" src="${v}" alt="${part === 'front' ? 'Enunciado de la pregunta en tu quiz' : 'Pregunta completa en tu quiz, con la respuesta correcta'}"></div>` : ''; };
pdfImgLoad();
// Tocar la imagen de una pregunta la amplía (con desplazamiento lateral en el celular); en la revisión, tocarla marca la casilla.
document.addEventListener('click', ev => { const w = ev.target.closest?.('.quiz-img-wrap'); if (w && !w.closest('label')) w.classList.toggle('zoom'); });

const PDF_ACTIONS = {
  'pdf-save': () => saveFormsImport(),
  'pdf-cancel': () => { pdfImport = null; render(); },
  'gloss-official-remove': () => { localStorage.removeItem(OFFICIAL_KEY); officialGlossary.cache = null; allCards.cache = null; render(); toast('Se quitaron las definiciones oficiales de este dispositivo.'); }
};
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'forms-pdf' && el.files[0]) importFormsPdf(el.files[0]);
  else if (el.id === 'gloss-pdf' && el.files[0]) importOfficialGlossary(el.files[0]);
  else if (el.id === 'pdf-topic' && pdfImport) pdfImport.topicId = el.value || null;
  else if (el.id === 'pdf-session' && pdfImport) pdfImport.session = el.value ? Number(el.value) : null;
  else if (el.dataset.pdfPick !== undefined && pdfImport) { pdfImport.blocks[Number(el.dataset.pdfPick)].pick = el.checked; render(); }
  else if (el.id === 'gloss-all-cards') { state.settings.glossaryAllCards = el.checked; allCards.cache = null; save(); render(); }
});

Object.assign(STUDY_ACTIONS, PDF_ACTIONS);
