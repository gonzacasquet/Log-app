import { extractDayLog } from "./extract";
import { sendPush, type PushSubscription } from "./push";
import type { DayLog } from "./schema";
import { localParts, logicalDay, shiftDay, toMinutes } from "./dates";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  APP_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

type Settings = {
  times: string[]; // "HH:MM" en hora local
  tz: string;
  lat: number | null;
  lon: number | null;
  origin: string | null;
};

const DEFAULT_SETTINGS: Settings = {
  times: ["10:00", "16:00", "21:30"],
  tz: "Europe/Madrid",
  lat: null,
  lon: null,
  origin: null,
};

const WHISPER_PROMPT =
  "Diario de migraña. Dolor de cabeza, intensidad, náuseas, aura, fotofobia, ibuprofeno, paracetamol, " +
  "naproxeno, dexketoprofeno, metamizol, sumatriptán, rizatriptán, zolmitriptán, eletriptán, almotriptán, " +
  "frovatriptán, ubrogepant, rimegepant, topiramato, amitriptilina, propranolol, erenumab, galcanezumab, " +
  "fremanezumab, eptinezumab, toxina botulínica, regla, café, siesta.";

// ---------- utilidades ----------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function getSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE id = 1").first<{ value: string }>();
  return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(env: Env, s: Settings) {
  await env.DB.prepare(
    "INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
  )
    .bind(JSON.stringify(s))
    .run();
}

function authorized(req: Request, env: Env) {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!env.APP_TOKEN || token.length !== env.APP_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ env.APP_TOKEN.charCodeAt(i);
  return diff === 0;
}

// ---------- tiempo atmosférico (Open-Meteo, sin clave) ----------

type Weather = {
  presion_media: number;
  presion_min: number;
  cambio_presion_vs_ayer: number | null;
  temp_max: number;
  humedad_media: number;
};

async function fetchWeather(lat: number, lon: number, day: string, today: string): Promise<Weather | null> {
  const daysBack = Math.round((Date.parse(today) - Date.parse(day)) / 86400000) + 1;
  if (daysBack > 90) return null;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=pressure_msl,relative_humidity_2m,temperature_2m&past_days=${Math.max(1, daysBack)}` +
    `&forecast_days=1&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    hourly: { time: string[]; pressure_msl: number[]; relative_humidity_2m: number[]; temperature_2m: number[] };
  };
  const pick = (d: string) => {
    const idx = data.hourly.time.map((t, i) => (t.startsWith(d) ? i : -1)).filter((i) => i >= 0);
    const vals = (arr: number[]) => idx.map((i) => arr[i]).filter((v) => typeof v === "number");
    return { p: vals(data.hourly.pressure_msl), h: vals(data.hourly.relative_humidity_2m), t: vals(data.hourly.temperature_2m) };
  };
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const cur = pick(day);
  const prev = pick(shiftDay(day, -1));
  if (!cur.p.length) return null;
  return {
    presion_media: r1(mean(cur.p)),
    presion_min: r1(Math.min(...cur.p)),
    cambio_presion_vs_ayer: prev.p.length ? r1(mean(cur.p) - mean(prev.p)) : null,
    temp_max: r1(Math.max(...cur.t)),
    humedad_media: Math.round(mean(cur.h)),
  };
}

// ---------- API ----------

async function handleLog(req: Request, env: Env, settings: Settings) {
  const body = (await req.json()) as { audio?: string; text?: string; day?: string };
  const today = logicalDay(new Date(), settings.tz);
  const day = body.day && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : today;

  let transcript = (body.text ?? "").trim();
  if (body.audio) {
    const result = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as never, {
      audio: body.audio,
      language: "es",
      initial_prompt: WHISPER_PROMPT,
      vad_filter: true,
    } as never)) as { text?: string };
    transcript = [transcript, (result.text ?? "").trim()].filter(Boolean).join("\n");
  }
  if (!transcript) return json({ error: "No se ha entendido nada en el audio. Prueba otra vez o escríbelo." }, 400);

  const existing = await env.DB.prepare("SELECT data, transcripts FROM days WHERE day = ?")
    .bind(day)
    .first<{ data: string; transcripts: string }>();
  const previous = existing ? (JSON.parse(existing.data) as DayLog) : null;
  const transcripts: { at: string; text: string }[] = existing ? JSON.parse(existing.transcripts) : [];

  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const data = await extractDayLog(env.ANTHROPIC_API_KEY, transcript, previous, dayLabel);
  transcripts.push({ at: new Date().toISOString(), text: transcript });

  let weather: Weather | null = null;
  if (settings.lat != null && settings.lon != null) {
    weather = await fetchWeather(settings.lat, settings.lon, day, today).catch(() => null);
  }

  await env.DB.prepare(
    `INSERT INTO days (day, data, transcripts, weather, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(day) DO UPDATE SET data = ?2, transcripts = ?3, weather = COALESCE(?4, weather), updated_at = ?5`,
  )
    .bind(day, JSON.stringify(data), JSON.stringify(transcripts), weather ? JSON.stringify(weather) : null, new Date().toISOString())
    .run();

  return json({ day, data, weather, transcript });
}

async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!authorized(req, env)) return json({ error: "No autorizado" }, 401);

  const settings = await getSettings(env);
  if (settings.origin !== url.origin) {
    settings.origin = url.origin;
    await saveSettings(env, settings);
  }

  if (path === "/api/config" && req.method === "GET") {
    return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY, today: logicalDay(new Date(), settings.tz), settings });
  }

  if (path === "/api/settings" && req.method === "PUT") {
    const b = (await req.json()) as Partial<Settings>;
    const next: Settings = { ...settings };
    if (Array.isArray(b.times)) next.times = b.times.filter((t) => /^\d{2}:\d{2}$/.test(t)).sort().slice(0, 6);
    if (typeof b.tz === "string") {
      try {
        new Intl.DateTimeFormat("es", { timeZone: b.tz });
        next.tz = b.tz;
      } catch {
        return json({ error: "Zona horaria no válida" }, 400);
      }
    }
    if (typeof b.lat === "number" && typeof b.lon === "number") {
      next.lat = Math.round(b.lat * 100) / 100; // ~1 km basta para el tiempo
      next.lon = Math.round(b.lon * 100) / 100;
    }
    await saveSettings(env, next);
    return json(next);
  }

  if (path === "/api/subscribe" && req.method === "POST") {
    const b = (await req.json()) as { endpoint: string; keys: { p256dh: string; auth: string } };
    if (!b?.endpoint?.startsWith("https://") || !b.keys?.p256dh || !b.keys?.auth) {
      return json({ error: "Suscripción no válida" }, 400);
    }
    await env.DB.prepare(
      "INSERT OR REPLACE INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(b.endpoint, b.keys.p256dh, b.keys.auth, new Date().toISOString())
      .run();
    return json({ ok: true });
  }

  if (path === "/api/test-push" && req.method === "POST") {
    const n = await notifyAll(env, settings, {
      title: "Diario de migraña",
      body: "¡Las notificaciones funcionan! 🎉",
    });
    return json({ sent: n });
  }

  if (path === "/api/log" && req.method === "POST") {
    try {
      return await handleLog(req, env, settings);
    } catch (e) {
      console.error(e);
      return json({ error: `No se ha podido procesar: ${(e as Error).message}` }, 500);
    }
  }

  if (path === "/api/days" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT day, data, weather, transcripts, updated_at FROM days ORDER BY day DESC LIMIT 400",
    ).all<{ day: string; data: string; weather: string | null; transcripts: string; updated_at: string }>();
    return json(
      results.map((r) => ({
        day: r.day,
        data: JSON.parse(r.data),
        weather: r.weather ? JSON.parse(r.weather) : null,
        transcripts: JSON.parse(r.transcripts),
        updated_at: r.updated_at,
      })),
    );
  }

  const m = path.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (m && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM days WHERE day = ?").bind(m[1]).run();
    return json({ ok: true });
  }

  return json({ error: "No encontrado" }, 404);
}

// ---------- recordatorios ----------

async function notifyAll(env: Env, settings: Settings, message: { title: string; body: string }) {
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs").all<PushSubscription>();
  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: settings.origin ?? "mailto:noreply@example.com",
  };
  let sent = 0;
  for (const sub of results) {
    try {
      const res = await sendPush(sub, { ...message, url: "/" }, vapid);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
      } else if (res.ok) {
        sent++;
      } else {
        console.error("push", res.status, await res.text());
      }
    } catch (e) {
      console.error("push error", e);
    }
  }
  return sent;
}

const REMINDER_TEXTS = [
  "¿Qué tal el día? Graba tu audio del diario (1-2 min) 🎙️",
  "Aún no has grabado el diario de hoy. ¿Un minuto? 🎙️",
  "Último aviso de hoy: cuéntame cómo ha ido el día 🎙️",
];

async function runReminders(env: Env, when: Date) {
  const settings = await getSettings(env);
  const { minutes } = localParts(when, settings.tz);
  const day = logicalDay(when, settings.tz);

  // ¿Toca algún recordatorio en esta ventana de 5 minutos?
  const idx = settings.times.findIndex((t) => {
    const tm = toMinutes(t);
    return minutes >= tm && minutes < tm + 5;
  });
  if (idx < 0) return;

  const logged = await env.DB.prepare("SELECT 1 FROM days WHERE day = ?").bind(day).first();
  if (logged) return; // ya ha grabado hoy: los recordatorios se paran

  const already = await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (day, time) VALUES (?, ?)")
    .bind(day, settings.times[idx])
    .run();
  if (!already.meta.changes) return;

  const isLast = idx === settings.times.length - 1;
  const text = isLast ? REMINDER_TEXTS[2] : REMINDER_TEXTS[Math.min(idx, 1)];
  await notifyAll(env, settings, { title: "Diario de migraña", body: text });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
