# Guía para ChatGPT (supervisor y guía)

Tu rol es revisar la app y el contenido, y dejar instrucciones claras para Claude, que programa y publica.

## Qué revisar
- **App publicada:** https://fssgdev.github.io/pmp-prep-app/
- **Contenido:** `data/questions.json` (banco), `data/modules.json` (temas por tarea ECO julio 2026), `data/lessons.json` (9 lecciones del curso PMI v4.1 y sus tareas ECO), `data/weekly-plan.json` (lección v4.1 de cada semana para la rutina diaria; editable), `data/calendar.json` (sesiones INGENIUM y etapas).
- **Conceptos y tarjetas:** `data/concepts.json`; **tips:** `data/tips.json`.
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
