// Antes de esta hora, lo que se registra cuenta para el día anterior.
export const DAY_CUTOFF_HOUR = 4;

export function localParts(date: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Día "lógico" del diario: de madrugada sigue contando como el día anterior. */
export function logicalDay(now: Date, tz: string) {
  const { date, minutes } = localParts(now, tz);
  return minutes < DAY_CUTOFF_HOUR * 60 ? shiftDay(date, -1) : date;
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
