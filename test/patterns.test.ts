import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore módulo JS del frontend
import { analyze, perimenstrualDays, intensity } from "../public/patterns.js";

const rec = (day: string, data: Record<string, unknown>) => ({ day, data: { dolor: {}, ...data }, weather: null });

test("ventana perimenstrual −2…+3 alrededor del primer día de regla", () => {
  const days = [
    rec("2026-11-10", { regla_hoy: true }),
    rec("2026-11-11", { regla_hoy: true }),
  ];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const w = [...perimenstrualDays(byDay)].sort();
  assert.deepEqual(w, ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
});

test("intensidad: 'sin dolor' cuenta como 0 y falta de datos como null", () => {
  assert.equal(intensity(rec("2026-11-01", { dolor: { hubo: false, intensidad_max: null } })), 0);
  assert.equal(intensity(rec("2026-11-01", { dolor: { hubo: null, intensidad_max: null } })), null);
});

test("factores: el sueño corto aparece asociado a más dolor", () => {
  const days = [];
  for (let k = 0; k < 20; k++) {
    const d = new Date(Date.UTC(2026, 10, 1 + k)).toISOString().slice(0, 10);
    const short = k < 10;
    days.push(rec(d, { sueno: { horas: short ? 5 : 8 }, dolor: { hubo: true, intensidad_max: short ? 8 : 2 }, medicacion_aguda: [] }));
  }
  const { factors, stats } = analyze(days, 30, "2026-11-20");
  const f = factors.find((x: { id: string }) => x.id === "sueno_corto");
  assert.ok(f.enough);
  assert.ok(f.diff > 0);
  assert.equal(stats.registrados, 20);
});
