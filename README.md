# Diario de migraña 🎙️

App para el iPhone que lleva un diario de migraña **por voz**: avisa 2-3 veces al día, tu amiga graba un audio de 1-2 minutos contando su día y la app lo transcribe, lo convierte en un registro ordenado y **deja de avisar ese día**. Con las semanas muestra qué cosas coinciden con más dolor.

- Las preguntas y la evidencia que hay detrás están en [`docs/investigacion.md`](docs/investigacion.md).
- La app web se instala en el iPhone desde Safari (no hace falta App Store ni Mac).

## Cómo funciona

```
iPhone (app web instalada)  ──audio──▶  Cloudflare Worker
                                         ├─ Whisper (Workers AI): audio → texto
                                         ├─ Claude: texto → registro estructurado (+ lo que falta por contar)
                                         ├─ Open-Meteo: presión, temperatura y humedad del día
                                         └─ D1: base de datos
Cloudflare Cron (cada 5 min) ──▶ si toca recordatorio y hoy no hay registro ──▶ notificación push
```

- **Recordatorios**: horas configurables en la app (por defecto 10:00, 16:00 y 21:30). Si ya ha grabado ese día, no se envían más. Lo que se graba antes de las 4:00 cuenta para el día anterior.
- **Varios audios al día**: si se le olvida algo, puede grabar otro audio y se combina con el anterior. La app le dice qué le ha faltado contar.
- **Patrones**: días con dolor, días con medicación (aviso al llegar a 10 de 30), calendario y una comparación de cada factor (sueño, ayuno, cafés, regla, presión, etc.) con la intensidad del dolor.
- **Exportar** a CSV/Excel para la neuróloga.
- Tema oscuro y suave (con migraña la luz molesta).

## Puesta en marcha (unos 15 minutos, una sola vez)

Hace falta un ordenador con [Node.js](https://nodejs.org) 20 o posterior.

1. **Cuenta de Cloudflare** (gratis): https://dash.cloudflare.com/sign-up
2. **Clave de la API de Claude**: https://console.anthropic.com → *API Keys*. Cada registro cuesta unos céntimos (≈1 € al mes con un audio al día).
3. En la carpeta del proyecto:

   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create diario-migrana
   ```

   Copia el `database_id` que aparece y pégalo en `wrangler.jsonc` en lugar de `REEMPLAZAR_CON_EL_ID_DE_D1`.

4. Crea las tablas:

   ```bash
   npm run db:migrate
   ```

5. Genera las claves de las notificaciones y guarda los secretos (te los pedirá uno a uno):

   ```bash
   npm run vapid                              # muestra VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put APP_TOKEN          # el código de acceso que le darás a tu amiga
   ```

   Para `APP_TOKEN` elige algo largo y difícil de adivinar (p. ej. tres palabras y un número). Protege sus datos de salud.

6. Publica:

   ```bash
   npm run deploy
   ```

   Te dará una dirección del tipo `https://diario-migrana.TU-USUARIO.workers.dev`.

## En el iPhone de tu amiga (iOS 16.4 o posterior)

1. Abrir la dirección en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
2. Abrir la app desde el icono nuevo y escribir el código de acceso.
3. **Ajustes** → **Activar notificaciones** (aceptar el permiso) → **Probar**.
4. **Ajustes** → **Usar mi ubicación** (para el tiempo; se guarda redondeada a ≈1 km).
5. Ajustar las horas de los recordatorios si quiere.

Las notificaciones de iPhone para apps web solo funcionan si se abre desde el icono de la pantalla de inicio, no desde Safari.

## Desarrollo

```bash
npm test          # cifrado de notificaciones, fechas y cálculo de patrones
npm run typecheck
npm run dev       # servidor local (Workers AI necesita estar conectado a tu cuenta de Cloudflare)
```

Estructura:

- `src/worker.ts`: API, recordatorios (cron) y tiempo atmosférico
- `src/extract.ts`: instrucciones y llamada a Claude
- `src/schema.ts`: campos del registro diario
- `src/push.ts`: notificaciones Web Push sin dependencias
- `public/`: la app (HTML/CSS/JS sin compilación) y `patterns.js` con el análisis

## Privacidad

Los datos se guardan en la base de datos D1 de **tu** cuenta de Cloudflare. El audio no se guarda: solo se transcribe y se queda el texto. La transcripción se envía a Claude para ordenarla. Cualquiera que tenga el código de acceso puede ver los datos, así que no lo compartas.

> Esta app ayuda a llevar un registro; no diagnostica ni sustituye a la neuróloga.
