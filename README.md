# PMP Prep App

Centro personal de preparación para la certificación **PMP** (meta: enero 2027): ruta de estudio, calendario INGENIUM, módulos por dominio, banco de preguntas situacionales, registro de errores, simulacros e indicadores de preparación.

**App:** https://fssgdev.github.io/pmp-prep-app/

## Cómo se trabaja
- **ChatGPT** supervisa y guía → abre issues con la etiqueta `para-claude` (ver [AGENTS.md](AGENTS.md)).
- **Claude** programa y publica → sigue [CLAUDE.md](CLAUDE.md) y responde en cada issue.
- **Fabrizio** aprueba cada ciclo.

## Progreso en la nube
El progreso se guarda en el navegador y, una vez configurado Supabase (`js/config.js` + `supabase/schema.sql`), se sincroniza entre dispositivos con inicio de sesión por correo.

## Estructura
```
index.html            esqueleto de la app
assets/styles.css     estilos
data/*.json           módulos, calendario y banco de preguntas
js/main.js            carga de datos
js/app.js             vistas y lógica
js/sync.js            sincronización con Supabase
supabase/schema.sql   tabla y políticas de seguridad
```

Herramienta personal de estudio, sin afiliación a PMI ni a INGENIUM. Preguntas originales.
