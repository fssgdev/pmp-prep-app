// Genera calendar.ics (calendario suscribible para Google Calendar y Apple Calendar).
// Uso: node tools/build-ics.mjs          → escribe calendar.ics
//      node tools/build-ics.mjs --check  → falla si calendar.ics no está al día
// Fuente: data/calendar.json (sesiones INGENIUM con su lección v4.1) y data/weekly-plan.json (schedule, semanas).
// Frecuencia (línea base del 25/11, #3): lunes a viernes rutina; miércoles y viernes clase, con la lámina de repaso de la
// clase anterior a las 18:00; sábado cuestionario de 20; domingo descanso; examen completo de 180 al terminar el curso.
// Solo programación común: nada de avance personal, notas ni enlaces privados.
import fs from 'fs';
const root = new URL('../', import.meta.url);
const cal = JSON.parse(fs.readFileSync(new URL('data/calendar.json', root)));
const wp = JSON.parse(fs.readFileSync(new URL('data/weekly-plan.json', root)));
const S = {routineDays: [1, 2, 3, 4, 5], classDays: [3, 5], quizDay: 6, restDays: [0], routineTime: '07:30', quizTime: '10:00', examDate: '2027-01-31', ...(wp.schedule || {})};
const APP = 'https://fssgdev.github.io/pmp-prep-app/';
const plusDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wd = s => new Date(s + 'T12:00:00Z').getUTCDay();
const weekStart = d => plusDays(d, wd(d) === 0 ? -6 : 1 - wd(d));
const z = (d, t) => new Date(d + 'T' + t + ':00-05:00').toISOString().replace(/[-:]/g, '').replace('.000', ''); // Lima = UTC−5, sin horario de verano
const addMin = (t, m) => { const [h, mm] = t.split(':').map(Number), x = h * 60 + mm + m; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
const fold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = ' ' + s.slice(i); } out.push(s); return out.join('\r\n'); };
const STAMP = '20261125T000000Z';
const BASELINE_START = '2026-11-25';
const exam = S.examDate, sessions = [...cal.sessions].sort((a, b) => a.date.localeCompare(b.date));
const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PMP Master Plan 2027//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:PMP Master Plan 2027', 'X-WR-TIMEZONE:America/Lima', 'X-WR-CALDESC:' + esc('Plan de estudio PMP: rutina de lunes a viernes, clases INGENIUM con su lámina de repaso a las 18:00, cuestionario del sábado y examen de fin de curso. Se actualiza solo.'), 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];
const ev = ({uid, d, start, end, summary, desc, alarm = 30, rrule, allDay}) => {
  L.push('BEGIN:VEVENT', 'UID:' + uid + '@pmp-master-plan-2027', 'DTSTAMP:' + STAMP);
  if (allDay) L.push('DTSTART;VALUE=DATE:' + d.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + plusDays(d, 1).replace(/-/g, ''));
  else L.push('DTSTART:' + z(d, start), 'DTEND:' + z(d, end));
  if (rrule) L.push('RRULE:' + rrule);
  L.push('SUMMARY:' + esc(summary), 'DESCRIPTION:' + esc(desc + '\n\n' + APP), 'URL:' + APP);
  if (alarm !== null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(summary), 'TRIGGER:-PT' + alarm + 'M', 'END:VALARM');
  L.push('END:VEVENT');
};
// 1) Clases INGENIUM
for (const s of sessions) {
  const [a, b] = (s.time || '20:00–22:00').split(/[–-]/).map(x => x.trim());
  ev({uid: 'sesion-' + s.id, d: s.date, start: a, end: b, summary: `INGENIUM · Sesión ${s.id} · Lección ${s.lesson41.join(' y ')} (v4.1)`, desc: `${s.title}\nPPT: ${s.ppt}\nLección del curso v4.1: ${s.lesson41.join(' y ')} (${s.mapping === 'confirmada' ? 'confirmada con las notas del instructor' : 'proyección por confirmar'}).${s.progress ? '\n' + s.progress : ''}\nDespués de la clase: registra el avance en la app, resuelve el quiz de Google Forms y carga su PDF.`});
}
// 1b) Lámina de repaso de la clase anterior, a las 18:00 del día de clase (la prepara GPT; se abre desde la app)
sessions.forEach((s, i) => { const prev = sessions[i - 1]; if (prev && prev.date >= BASELINE_START) ev({uid: 'lamina-s' + prev.id, d: s.date, start: '18:00', end: '18:30', alarm: 0, summary: `PMP · Repasar láminas de la sesión ${prev.id}`, desc: `Antes de la clase de hoy: lámina de repaso de la clase ${prev.id} en la app (Inicio o Ruta).`}); });
// 2) Rutina de lunes a viernes
const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], first = (() => { let d = '2026-11-23'; while (!S.routineDays.includes(wd(d))) d = plusDays(d, 1); return d; })();
ev({uid: 'rutina-lun-vie', d: first, start: S.routineTime, end: addMin(S.routineTime, 20), alarm: 0, rrule: `FREQ=WEEKLY;BYDAY=${S.routineDays.map(i => days[i]).join(',')};UNTIL=${z(plusDays(exam, -1), '23:59')}`, summary: 'PMP · Rutina: 4 tarjetas + Bullet Quiz de 5', desc: 'Flashcards 4/4 (primero las vencidas y tus preguntas falladas) y Bullet Quiz de 5 de la lección de la semana. Domingo: descanso.'});
// 3) Sábados: cuestionario de 20 o examen completo
const lastS = sessions[sessions.length - 1].date;
let exam0 = plusDays(lastS, 1); while (wd(exam0) !== S.quizDay) exam0 = plusDays(exam0, 1);
const mocks = {[exam0]: ['0', 'Examen completo de fin de curso (180 preguntas)']};
const covered = d => [...new Set(wp.weeks.filter(w => w.start <= weekStart(d)).map(w => w.lesson))].sort((a, b) => a - b);
let sat = '2026-11-28'; while (wd(sat) !== S.quizDay) sat = plusDays(sat, 1);
for (let d = sat; d < plusDays(exam, -1); d = plusDays(d, 7)) {
  if (mocks[d]) { const [n, t] = mocks[d]; ev({uid: 'examen-completo-' + n, d, start: '09:00', end: '13:00', summary: 'PMP · ' + t, desc: '240 minutos con dos pausas de 10, en condiciones de examen. Al terminar, tus fallos pasan solos al repaso.', alarm: 60}); continue; }
  const ls = covered(d);
  ev({uid: 'sabado-' + d.replace(/-/g, ''), d, start: S.quizTime, end: addMin(S.quizTime, 60), summary: `PMP · Cuestionario de 20 preguntas (lecciones ${ls.length ? ls[0] + '–' + ls[ls.length - 1] : 'mixtas'})`, desc: `Lecciones v4.1 vistas hasta esta semana: ${ls.join(', ')}. Incluye tus preguntas falladas que toca repasar, ~40 % predictivo y todos los formatos del examen.`});
}
// 4) Repaso final antes del examen de fin de curso
const lastSession = sessions[sessions.length - 1], finalReview = (() => { let d = plusDays(exam0, -1); while (S.restDays.includes(wd(d))) d = plusDays(d, -1); return d; })();
if (lastSession.date >= BASELINE_START) ev({uid: 'lamina-s' + lastSession.id, d: finalReview, start: '18:00', end: '18:30', alarm: 0, summary: 'PMP · Repaso final con las láminas del curso', desc: `Lámina de la última clase y repaso general antes del examen de fin de curso del ${exam0}.`});
// Los simulacros completos adicionales son voluntarios: no se programan.
// 5) Examen
ev({uid: 'examen-pmp', d: exam, allDay: true, alarm: null, summary: `Examen PMP${wp.schedule?.examConfirmed ? '' : ' (fecha tentativa)'}`, desc: 'Fecha configurada en data/weekly-plan.json (schedule.examDate). Cámbiala allí cuando la confirmes.'});
L.push('END:VCALENDAR');
const out = L.map(fold).join('\r\n') + '\r\n', file = new URL('calendar.ics', root);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== out) { console.error('calendar.ics no está al día: ejecuta node tools/build-ics.mjs'); process.exit(1); }
  console.log('calendar.ics al día (' + (out.match(/BEGIN:VEVENT/g) || []).length + ' eventos)');
} else { fs.writeFileSync(file, out); console.log('calendar.ics escrito: ' + (out.match(/BEGIN:VEVENT/g) || []).length + ' eventos'); }
