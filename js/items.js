'use strict';
/* Tipos de pregunta del ECO PMP (julio 2026) además de única, múltiple y emparejamiento:
   - dropdown («lista desplegable»): items[i] es una frase con «___» y choices[i] sus opciones; correct[i] = índice elegido.
   - hotspot («señale y haga clic»): se responde haciendo clic en una zona de una figura.
       hotspot.kind = 'grid'  → {cols:[...], rows:[{label, cells:[...]}]}; zonas = celdas por filas.
       hotspot.kind = 'chart' → usa q.chart; zonas = las etiquetas del eje X.
     correct = índices de zona (más de uno = varias zonas).
   - table (en la pregunta o el escenario): artefacto del proyecto {title, head:[...], rows:[[...]], note} que siempre se muestra como tabla.
   - why (opcional): una explicación por opción, al estilo de Mastery Builder.
   Se carga después de study.js y antes de mock.js y app.js. */

function slotType(q) { return q.type === 'match' || q.type === 'dropdown'; }
function multiPick(q) { return q.type === 'multi' || (q.type === 'hotspot' && q.correct.length > 1); }
function itemOk(q, sel) {
  if (!sel) return false;
  if (slotType(q)) return q.correct.every((c, i) => sel[i] === c);
  return q.correct.length === sel.length && q.correct.every(i => sel.includes(i));
}
function hotspotZones(q) {
  const h = q.hotspot || {};
  if (h.kind === 'chart') return (q.chart?.labels || []).map(l => l);
  return (h.rows || []).flatMap(r => r.cells.map((c, j) => `${r.label} · ${h.cols?.[j] ?? ''}`.trim()));
}
const LET = i => String.fromCharCode(65 + i);
/* Texto de la respuesta correcta y de la elegida (resultados y revisión). */
function itemKey(q) {
  if (q.type === 'match') return q.items.map((_, i) => `${i + 1} → ${LET(q.correct[i])}`).join(' · ');
  if (q.type === 'dropdown') return q.items.map((_, i) => `${i + 1}: «${q.choices[i][q.correct[i]]}»`).join(' · ');
  if (q.type === 'hotspot') { const z = hotspotZones(q); return q.correct.map(i => z[i]).join(' · '); }
  return q.correct.map(LET).join(', ');
}
function itemYours(q, s) {
  if (!s) return 'Sin responder';
  if (q.type === 'match') return s.map((v, i) => `${i + 1} → ${v >= 0 ? LET(v) : '—'}`).join(' · ');
  if (q.type === 'dropdown') return s.map((v, i) => `${i + 1}: ${v >= 0 ? '«' + q.choices[i][v] + '»' : '—'}`).join(' · ');
  if (q.type === 'hotspot') { const z = hotspotZones(q); return s.map(i => z[i]).join(' · '); }
  return s.map(LET).join(', ');
}
function itemReady(q, sel) { return slotType(q) ? q.items.every((_, i) => (sel[i] ?? -1) >= 0) : sel.length > 0; }

/* Artefacto en tabla (tablero, registro, cronograma, informe). */
function artifactBlock(t) {
  if (!t) return '';
  return `<figure class="artifact"><figcaption><strong>${esc(t.title)}</strong></figcaption><div class="table-wrap"><table><thead><tr>${t.head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, j) => j === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${t.note ? `<p class="hint" style="margin-top:6px">${esc(t.note)}</p>` : ''}</figure>`;
}

/* Cuerpo de respuesta para dropdown y hotspot.
   mode 'quiz' (práctica, con corrección si hay answer) o 'mock' (sin corrección). */
function itemBody(q, sel, answer, mode) {
  const slotAttr = mode === 'mock' ? 'data-mock-match' : 'data-match', pick = mode === 'mock' ? 'mock-choice' : 'quiz-choice', idp = mode === 'mock' ? 'mm' : 'match';
  if (q.type === 'dropdown') {
    const cur = i => answer ? answer.selected[i] : (sel[i] ?? -1);
    return `<p class="hint">Completa cada enunciado eligiendo una opción de la lista desplegable.</p><div class="dropdown-list">${q.items.map((it, i) => {
      const ok = answer && answer.selected[i] === q.correct[i], [a, b = ''] = it.split('___');
      const select = `<select id="${idp}-${i}" ${slotAttr}="${i}" aria-label="Espacio ${i + 1}" ${answer ? 'disabled' : ''}><option value="-1">Elige…</option>${q.choices[i].map((o, j) => `<option value="${j}" ${cur(i) === j ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      return `<div class="dropdown-row ${answer ? (ok ? 'correct' : 'incorrect') : ''}"><span class="option-label">${i + 1}</span><p>${esc(a)}${select}${esc(b)}</p>${answer && !ok ? `<p class="match-fix">Correcto: «${esc(q.choices[i][q.correct[i]])}»</p>` : ''}</div>`;
    }).join('')}</div>`;
  }
  if (q.type === 'hotspot') {
    const h = q.hotspot, multi = multiPick(q), type = multi ? 'checkbox' : 'radio', zones = hotspotZones(q);
    const cls = i => [sel.includes(i) ? 'selected' : '', answer && q.correct.includes(i) ? 'correct' : '', answer && sel.includes(i) && !q.correct.includes(i) ? 'incorrect' : ''].join(' ');
    const input = i => `<input type="${type}" name="${pick}" value="${i}" ${sel.includes(i) ? 'checked' : ''} ${answer ? 'disabled' : ''} aria-label="${esc(zones[i])}">`;
    const hint = `<p class="hint">${multi ? `Haz clic en las ${q.correct.length} zonas correctas de la figura.` : 'Haz clic en la zona correcta de la figura.'}</p>`;
    if (h.kind === 'chart') {
      const W = 640, H = 300, L = 56, R = 30, T = 20, B = 44, n = q.chart.labels.length, bw = (W - L - R) / Math.max(1, n - 1);
      const bands = q.chart.labels.map((_, i) => { const xc = L + i * bw, left = Math.max(0, xc - bw / 2), right = Math.min(W, xc + bw / 2); return `<label class="hs-band ${cls(i)}" style="left:${left / W * 100}%;width:${(right - left) / W * 100}%;top:${T / H * 100}%;height:${(H - B + 26 - T) / H * 100}%">${input(i)}</label>`; }).join('');
      const fig = chartBlock(q.chart).replace('<svg viewBox', '<div class="hs-wrap"><svg viewBox').replace('</svg><div class="chart-legend">', `</svg>${bands}</div><div class="chart-legend">`);
      return hint + fig;
    }
    let k = 0;
    return hint + `<figure class="hs-grid-fig">${h.title ? `<figcaption><strong>${esc(h.title)}</strong></figcaption>` : ''}<div class="table-wrap"><table class="hs-grid"><thead><tr><th></th>${h.cols.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${h.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.cells.map(c => { const i = k++; return `<td><label class="hs-cell ${cls(i)}">${input(i)}<span>${esc(c)}</span></label></td>`; }).join('')}</tr>`).join('')}</tbody></table></div></figure>`;
  }
  return '';
}
/* Explicación por opción (si la pregunta la trae). */
function whyBlock(q) {
  if (!Array.isArray(q.why) || q.type === 'match' || q.type === 'dropdown' || q.type === 'hotspot') return '';
  return `<ul class="why-list">${q.why.map((w, i) => `<li class="${q.correct.includes(i) ? 'ok' : ''}"><strong>${LET(i)} · ${q.correct.includes(i) ? 'correcta' : 'incorrecta'}:</strong> ${esc(w)}</li>`).join('')}</ul>`;
}
