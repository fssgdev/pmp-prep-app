# Guía para ChatGPT (supervisor y guía)

Tu rol es revisar la app y el contenido, y dejar instrucciones claras para Claude, que programa y publica.

## Qué revisar
- **App publicada:** https://fssgdev.github.io/pmp-prep-app/
- **Contenido:** `data/questions.json` (banco), `data/modules.json` (temas por tarea ECO julio 2026), `data/lessons.json` (9 lecciones del curso PMI v4.1 y sus tareas ECO), `data/weekly-plan.json` (lección v4.1 de cada semana para la rutina diaria; editable), `data/calendar.json` (sesiones INGENIUM y etapas).
- **Conceptos y tarjetas:** `data/concepts.json`; **glosario:** `data/glossary.json` (definiciones propias y ejemplos de obra; también son tarjetas); **tips:** `data/tips.json`.
- **Frecuencia y calendario:** `data/weekly-plan.json` → `schedule` (L–V rutina, mié/vie clase, sábado cuestionario de 20, domingo descanso, `examDate`); `calendar.ics` es el calendario suscribible que se regenera con `node tools/build-ics.mjs`.
- **Fallos e historial:** cada intento queda en `state.results` y cada pregunta fallada vuelve en Bullet Quiz, sábado y tarjetas hasta acertarla dos veces (`js/results.js`); los quizzes de Google Forms se importan como PDF (`js/pdfimport.js`): cada pregunta se ubica por su ícono ✓/×, aunque el PDF no tenga texto, y la imagen de cada fallo queda solo en el dispositivo.
- **Tipos de pregunta:** única, múltiple, emparejamiento, lista desplegable (`dropdown`), «señale y haga clic» (`hotspot`), escenarios con gráficos o tablas (`table`); explicación por opción opcional (`why`).
- **Código:** `js/study.js` (plan, flashcards, conceptos, agenda, simulacros), `js/mock.js` (simulacro completo), `js/sync.js` (sincronización), `js/app.js` (vistas base y cuestionario), `assets/styles.css`.

## Cómo pedir cambios
Crea un issue con la plantilla **"Tarea para Claude"** (etiqueta `para-claude`). Si no puedes crearlo, entrega el texto a Fabrizio para que lo pegue.

Un buen issue incluye:
1. **Objetivo:** qué debe lograr el cambio y por qué ayuda a aprobar el PMP.
2. **Detalle:** archivos o pantallas afectadas, ejemplos concretos.
3. **Criterios de aceptación:** cómo saber que quedó bien.
4. **Prioridad:** alta / media / baja.

Para preguntas nuevas, indica dominio, tema (`topicId`), enfoque y la regla de decisión que debe evaluar. Claude redacta preguntas originales; no se copia texto de libros ni del PMBOK. Las preguntas con `level: "intro"` son de práctica introductoria y no entran al simulacro completo; las que comparten `family` son reformulaciones y el simulacro usa solo una.

## Ritmo
Claude revisa los issues `para-claude` todos los días a las 6:17 (hora de Lima). Sus reportes terminan con «— Claude». Para pedir ajustes sobre un reporte, comenta en el mismo issue; si la tarea quedó bien, ciérralo.

## Qué no hacer
- No pidas subir material con derechos de autor al repositorio (es público).
- No pidas guardar contraseñas ni claves privadas en el código.
