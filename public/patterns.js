// Cálculo de patrones a partir de los días registrados. Funciones puras (se prueban en test/).

export function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Intensidad del día (0-10) o null si no se sabe. */
export function intensity(rec) {
  if (!rec) return null;
  const d = rec.data?.dolor;
  if (d?.intensidad_max != null) return d.intensidad_max;
  if (d?.hubo === false) return 0;
  if (d?.hubo === true) return 5; // dolor sin intensidad: valor medio
  return null;
}

export function isStrong(rec) {
  const i = intensity(rec);
  return (i != null && i >= 6) || rec?.data?.impacto === "incapacitante";
}

export function tookAcute(rec) {
  return (rec?.data?.medicacion_aguda?.length ?? 0) > 0;
}

/** Días del intervalo −2…+3 alrededor de cada inicio de regla (no existe el día 0). */
export function perimenstrualDays(byDay) {
  const out = new Set();
  for (const [day, rec] of byDay) {
    if (rec.data?.regla_hoy !== true) continue;
    const prev = byDay.get(shiftDay(day, -1));
    if (prev?.data?.regla_hoy === true) continue; // no es el primer día
    for (let k = -2; k <= 2; k++) out.add(shiftDay(day, k)); // −2, −1, día 1, 2, 3
  }
  return out;
}

export const FACTORS = [
  { id: "sueno_corto", label: "Dormiste menos de 6 h", test: (r) => r.data.sueno?.horas != null ? r.data.sueno.horas < 6 : null },
  { id: "sueno_largo", label: "Dormiste más de 9 h", test: (r) => r.data.sueno?.horas != null ? r.data.sueno.horas > 9 : null },
  { id: "sueno_malo", label: "Dormiste mal", test: (r) => r.data.sueno?.calidad ? r.data.sueno.calidad === "mala" : null },
  {
    id: "ayuno", label: "Saltaste una comida / ayuno ≥ 5 h",
    test: (r) => {
      const c = r.data.comidas ?? {};
      if (c.saltada == null && c.horas_ayuno_max == null) return null;
      return c.saltada === true || (c.horas_ayuno_max ?? 0) >= 5;
    },
  },
  { id: "cafeina", label: "3 o más cafés / bebidas con cafeína", test: (r) => r.data.cafeina_tazas != null ? r.data.cafeina_tazas >= 3 : null },
  { id: "alcohol", label: "Alcohol", test: (r) => r.data.alcohol?.bebidas != null ? r.data.alcohol.bebidas > 0 : null },
  { id: "agua", label: "Menos de 5 vasos de agua", test: (r) => r.data.agua_vasos != null ? r.data.agua_vasos < 5 : null },
  { id: "estres", label: "Estrés alto (7 o más)", test: (r) => r.data.estres_0_10 != null ? r.data.estres_0_10 >= 7 : null },
  { id: "bajada", label: "Bajón tras un periodo de estrés", test: (r) => r.data.bajada_tras_estres },
  { id: "regla", label: "Días −2 a +3 de la regla", special: "perimenstrual" },
  { id: "pantallas", label: "8 h o más de pantallas", test: (r) => r.data.pantallas_horas != null ? r.data.pantallas_horas >= 8 : null },
  { id: "ejercicio", label: "Hiciste ejercicio", test: (r) => r.data.ejercicio_min != null ? r.data.ejercicio_min > 0 : null },
  { id: "alimentos", label: "Alimentos sospechosos", test: (r) => (r.data.alimentos_sospechosos?.length ?? 0) > 0 },
  { id: "entorno", label: "Luz intensa, ruido u olores", test: (r) => (r.data.entorno ?? []).some((e) => ["luz_intensa", "ruido", "olores_fuertes", "humo"].includes(e)) },
  { id: "presion", label: "Bajada de presión (≥ 3 hPa vs. ayer)", test: (r) => r.weather?.cambio_presion_vs_ayer != null ? r.weather.cambio_presion_vs_ayer <= -3 : null },
  { id: "humedad", label: "Humedad alta (≥ 80 %)", test: (r) => r.weather?.humedad_media != null ? r.weather.humedad_media >= 80 : null },
];

const MIN_N = 3;

/**
 * Para cada factor compara la intensidad media de ese día y el siguiente (lo que ocurre
 * normalmente tras un desencadenante) en los días con el factor frente a los días sin él.
 */
export function analyze(records, rangeDays, today) {
  const byDay = new Map(records.map((r) => [r.day, r]));
  const from = shiftDay(today, -(rangeDays - 1));
  const inRange = records.filter((r) => r.day >= from && r.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const peri = perimenstrualDays(byDay);

  const intens = inRange.map(intensity).filter((v) => v != null);
  const last30From = shiftDay(today, -29);
  const last30 = records.filter((r) => r.day >= last30From && r.day <= today);

  const stats = {
    registrados: inRange.length,
    conDolor: inRange.filter((r) => (intensity(r) ?? 0) > 0).length,
    fuertes: inRange.filter(isStrong).length,
    medicacion: inRange.filter(tookAcute).length,
    media: intens.length ? Math.round((intens.reduce((s, v) => s + v, 0) / intens.length) * 10) / 10 : null,
    medicacion30: last30.filter(tookAcute).length,
    registrados30: last30.length,
  };

  const outcome = (rec) => {
    const vals = [intensity(rec), intensity(byDay.get(shiftDay(rec.day, 1)))].filter((v) => v != null);
    return vals.length ? Math.max(...vals) : null;
  };

  const factors = FACTORS.map((f) => {
    const yes = [];
    const no = [];
    for (const r of inRange) {
      let present;
      if (f.special === "perimenstrual") {
        // Solo tiene sentido si alguna vez se ha registrado la regla
        present = peri.size ? peri.has(r.day) : null;
      } else {
        present = f.test(r);
      }
      const o = outcome(r);
      if (present == null || o == null) continue;
      (present ? yes : no).push(o);
    }
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const ay = avg(yes);
    const an = avg(no);
    const enough = yes.length >= MIN_N && no.length >= MIN_N;
    return {
      id: f.id,
      label: f.label,
      nYes: yes.length,
      nNo: no.length,
      avgYes: ay == null ? null : Math.round(ay * 10) / 10,
      avgNo: an == null ? null : Math.round(an * 10) / 10,
      diff: enough ? Math.round((ay - an) * 10) / 10 : null,
      enough,
    };
  }).sort((a, b) => {
    if (a.enough !== b.enough) return a.enough ? -1 : 1;
    return (b.diff ?? 0) - (a.diff ?? 0);
  });

  return { stats, factors, inRange };
}

export function painColor(i) {
  if (i == null) return null;
  if (i === 0) return "var(--pain-0)";
  if (i <= 3) return "var(--pain-1)";
  if (i <= 5) return "var(--pain-2)";
  if (i <= 7) return "var(--pain-3)";
  return "var(--pain-4)";
}
