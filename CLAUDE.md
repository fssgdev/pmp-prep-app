# Reglas para Claude (programador y ejecutor)

Proyecto: **PMP Prep App**, preparación de Fabrizio para la certificación PMP (meta: enero 2027).
Roles: **ChatGPT** supervisa y guía (issues con etiqueta `para-claude`); **Claude** programa, publica y responde en el issue.

## Ciclo de trabajo
1. Leer los issues abiertos con etiqueta `para-claude`, del más antiguo al más reciente.
2. Implementar cada uno en un commit claro que cierre el issue (`Cierra #N`).
3. Comentar en el issue qué se hizo, qué quedó pendiente y cómo probarlo.
4. Si un pedido es ambiguo o contradice el ECO vigente, preguntar en el issue y no adivinar.

## Arquitectura (sitio estático en GitHub Pages)
- `index.html` — esqueleto. `assets/styles.css` — estilos.
- `data/modules.json` — dominios y temas. `data/calendar.json` — sesiones INGENIUM y etapas. `data/questions.json` — banco de preguntas.
- `js/main.js` carga los JSON y arranca `js/app.js` (lógica y vistas, enrutado por `#hash`).
- `js/sync.js` + `js/config.js` — sincronización del progreso en Supabase (tabla `progress`, ver `supabase/schema.sql`). Sin credenciales, todo queda en localStorage.

## Reglas de contenido
- Las preguntas son **originales**. No copiar texto del PMBOK, libros ni material del curso: el repositorio es público.
- Cada pregunta: `id` único, `module`, `topicId` existente, `approach` (Predictivo/Ágil/Híbrido), `type` (single/multi), 4 `options`, `correct` (índices), `rationale` que explique por qué las otras fallan, `category` (Conceptual/Mentalidad/Lectura/Cálculo).
- Referencia de dominios: ECO PMP julio 2026 (People 33 %, Process 41 %, Business Environment 26 %). Los `code` de los temas (1.1–3.8) son los números de tarea del ECO.
- Estructura de estudio: curso PMI v4.1 (9 lecciones) en `data/lessons.json`. "4.1" es la versión del curso, no del ECO.

## Reglas técnicas
- Sin frameworks ni paso de build: HTML/CSS/JS plano.
- Validar los JSON (`node -e "JSON.parse(require('fs').readFileSync('data/questions.json'))"`) antes de cada commit.
- No romper el formato del estado guardado (`version:1`); si cambia, migrar.
- Nunca subir claves privadas. La anon key de Supabase es pública; la service_role jamás.
