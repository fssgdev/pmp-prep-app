# Reglas para Claude (programador y ejecutor)

Proyecto: **PMP Prep App**, preparación de Fabrizio para la certificación PMP (meta: enero 2027).
Roles: **ChatGPT** supervisa y guía (issues con etiqueta `para-claude`); **Claude** programa, publica y responde en el issue.

## Ciclo de trabajo
1. Leer los issues abiertos con etiqueta `para-claude`, del más antiguo al más reciente.
2. Implementar cada uno en un commit claro que cierre el issue con `Closes #N` (GitHub solo reconoce la palabra clave en inglés).
3. Comentar en el issue qué se hizo, qué quedó pendiente y cómo probarlo, y firmar el comentario con «— Claude». Una tarea programada revisa los issues cada día a las 6:17 (hora de Lima) y omite los que ya tienen un reporte firmado sin respuestas posteriores.
4. Si un pedido es ambiguo o contradice el ECO vigente, preguntar en el issue y no adivinar.

## Arquitectura (sitio estático en GitHub Pages)
- `index.html` — esqueleto. `assets/styles.css` — estilos.
- `data/modules.json` — dominios y temas. `data/calendar.json` — sesiones INGENIUM y etapas. `data/questions.json` — banco de preguntas. `data/scenarios.json` — escenarios compartidos. `data/lessons.json` — lecciones del curso v4.1.
- `data/concepts.json` — conceptos clave (`[[palabra clave]]` se resalta), ejemplo de construcción y sus `cards` (flashcards). `data/tips.json` — tips diarios.
- `js/main.js` carga los JSON, luego `js/study.js` (plan con vencimientos, flashcards con repetición espaciada, conceptos, agenda/.ics/Google, práctica a medida), luego `js/mock.js` (simulacro PMP completo: 180 preguntas, 240 min, pausas que cierran bloques, 10 no puntuadas, revisión y desglose por dominio; intento en `state.mockRun`) y después `js/app.js` (vistas base, cuestionario, ajustes; enrutado por `#hash`).
- Secciones: Inicio, Agenda, Ruta de aprendizaje, Conceptos clave, Flashcards, Simulacros; además Módulos, Banco, Errores, Mi preparación y Notas.
- Plan: cada sesión de `data/calendar.json` lleva `topics`, `ppt`, `lesson41` y `mapping` (`confirmada` / `por confirmar`). El cuestionario vence el día anterior a la siguiente sesión; repasos a +1, +3, +7 y +14 días; tramo final desde el 7 de enero. Las actividades completadas se guardan por id en `state.tasksDone`.
- `js/sync.js` + `js/config.js` — sincronización del progreso en Supabase (tabla `progress`, ver `supabase/schema.sql`). Sin credenciales, todo queda en localStorage. La sincronización fusiona estados (unión por id, lápidas de borrado en `state.deleted`), no sobrescribe.
- `tests/` — pruebas con Playwright contra `python3 -m http.server 8765`: `node tests/simulacro.test.js <carpeta-capturas>` y `node tests/sincronizacion.test.js` (dos dispositivos con un doble de Supabase en memoria).

## Reglas de contenido
- Las preguntas son **originales**. No copiar texto del PMBOK, libros ni material del curso: el repositorio es público.
- Cada pregunta: `id` único, `module`, `topicId` existente, `approach` (Predictivo/Ágil/Híbrido), `type` (single/multi/match), `options`, `correct` (índices), `rationale` que explique por qué las otras fallan, `category` (Conceptual/Mentalidad/Lectura/Cálculo).
  - `single`/`multi`: 4 `options`; `correct` = índices correctos.
  - `match`: `items` (elementos a emparejar) y `options` (puede haber de sobra); `correct[i]` = índice de la opción para `items[i]`.
  - Escenario compartido: `scenarioId` apunta a `data/scenarios.json` (`title`, `context`, `chart` opcional). Sus preguntas se presentan juntas.
  - Gráfico: `chart` (`type: line`, `title`, `labels`, `series[{name, values}]`, `null` = sin dato) en el escenario o en la pregunta. Siempre se muestra también como tabla.
- Distractores: errores plausibles (cocientes invertidos, fórmula equivocada, acción prematura), no opciones absurdas.
- Referencia de dominios: ECO PMP julio 2026 (People 33 %, Process 41 %, Business Environment 26 %). Los `code` de los temas (1.1–3.8) son los números de tarea del ECO.
- Estructura de estudio: curso PMI v4.1 (9 lecciones) en `data/lessons.json`. "4.1" es la versión del curso, no del ECO.

## Reglas técnicas
- Sin frameworks ni paso de build: HTML/CSS/JS plano.
- Validar los JSON (`node -e "JSON.parse(require('fs').readFileSync('data/questions.json'))"`) antes de cada commit.
- No romper el formato del estado guardado (`version:1`); si cambia, migrar.
- Nunca subir claves privadas. La anon key de Supabase es pública; la service_role jamás.
