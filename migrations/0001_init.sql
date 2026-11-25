CREATE TABLE IF NOT EXISTS days (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD (día lógico, corte a las 04:00)
  data TEXT NOT NULL,             -- JSON con el registro estructurado (ver src/schema.ts)
  transcripts TEXT NOT NULL DEFAULT '[]',
  weather TEXT,                   -- JSON con presión/temperatura/humedad del día
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  PRIMARY KEY (day, time)
);
