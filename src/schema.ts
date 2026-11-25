// Esquema del registro diario. Claude rellena este JSON a partir de la transcripción del audio.
// Cada campo que no se mencione en el audio queda en null (nunca se inventa).

const nullable = <T extends object>(t: T) => ({ anyOf: [t, { type: "null" }] }) as const;
const num = nullable({ type: "number" });
const int = nullable({ type: "integer" });
const str = nullable({ type: "string" });
const bool = nullable({ type: "boolean" });
const oneOf = (values: string[], description?: string) =>
  ({ ...nullable({ type: "string", enum: values }), ...(description ? { description } : {}) });
const strList = { type: "array", items: { type: "string" } } as const;

export const SINTOMAS = [
  "nauseas", "vomitos", "fotofobia", "fonofobia", "osmofobia", "aura_visual", "aura_sensitiva",
  "mareo", "dolor_cuello", "fatiga", "niebla_mental", "otro",
] as const;

export const PRODROMO = [
  "bostezos", "antojos", "rigidez_cuello", "cansancio", "irritabilidad", "sensibilidad_luz_ruido",
  "orinar_mas", "dificultad_concentracion", "otro",
] as const;

export const ENTORNO = [
  "luz_intensa", "ruido", "olores_fuertes", "viaje", "calor", "frio", "altitud", "humo", "otro",
] as const;

export const LOG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "dolor", "sintomas", "prodromo", "medicacion_aguda", "preventivo_tomado", "sueno", "comidas",
    "agua_vasos", "cafeina_tazas", "alcohol", "alimentos_sospechosos", "estres_0_10", "animo_0_10",
    "bajada_tras_estres", "regla_hoy", "ejercicio_min", "pantallas_horas", "entorno", "impacto",
    "otros", "resumen", "faltan",
  ],
  properties: {
    dolor: {
      type: "object",
      additionalProperties: false,
      required: ["hubo", "intensidad_max", "inicio", "fin", "en_curso", "localizacion", "tipo"],
      properties: {
        hubo: bool,
        intensidad_max: { ...int, description: "0-10" },
        inicio: { ...str, description: "Hora aproximada HH:MM o descripción ('al despertar')" },
        fin: str,
        en_curso: bool,
        localizacion: { ...str, description: "p.ej. 'lado derecho', 'frente', 'toda la cabeza'" },
        tipo: { ...str, description: "p.ej. 'pulsátil', 'opresivo', 'punzante'" },
      },
    },
    sintomas: { type: "array", items: { type: "string", enum: [...SINTOMAS] } },
    prodromo: {
      type: "array",
      items: { type: "string", enum: [...PRODROMO] },
      description: "Señales en las horas previas al dolor",
    },
    medicacion_aguda: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "hora", "dosis", "alivio"],
        properties: {
          nombre: { type: "string" },
          hora: str,
          dosis: str,
          alivio: oneOf(["total", "parcial", "nada"]),
        },
      },
    },
    preventivo_tomado: bool,
    sueno: {
      type: "object",
      additionalProperties: false,
      required: ["horas", "hora_acostarse", "hora_levantarse", "calidad", "siesta"],
      properties: {
        horas: num,
        hora_acostarse: str,
        hora_levantarse: str,
        calidad: oneOf(["buena", "regular", "mala"]),
        siesta: bool,
      },
    },
    comidas: {
      type: "object",
      additionalProperties: false,
      required: ["saltada", "horas_ayuno_max", "notas"],
      properties: { saltada: bool, horas_ayuno_max: num, notas: str },
    },
    agua_vasos: num,
    cafeina_tazas: num,
    alcohol: {
      type: "object",
      additionalProperties: false,
      required: ["bebidas", "tipo"],
      properties: { bebidas: num, tipo: str },
    },
    alimentos_sospechosos: { ...strList, description: "queso curado, chocolate, embutido, vino tinto…" },
    estres_0_10: int,
    animo_0_10: int,
    bajada_tras_estres: { ...bool, description: "Fin de un periodo de estrés (examen, entrega, fin de semana)" },
    regla_hoy: { ...bool, description: "¿Tiene sangrado menstrual hoy?" },
    ejercicio_min: num,
    pantallas_horas: num,
    entorno: { type: "array", items: { type: "string", enum: [...ENTORNO] } },
    impacto: oneOf(
      ["ninguno", "reducido", "incapacitante"],
      "ninguno = vida normal; reducido = rindió menos; incapacitante = tuvo que parar/acostarse",
    ),
    otros: str,
    resumen: { type: "string", description: "Resumen del día en 1-2 frases, en español" },
    faltan: {
      type: "array",
      items: {
        type: "string",
        enum: ["dolor", "medicacion", "sueno", "comidas", "agua_cafeina_alcohol", "estres", "regla", "impacto"],
      },
      description: "Bloques clave que no se han mencionado y conviene completar",
    },
  },
} as const;

export type DayLog = {
  dolor: {
    hubo: boolean | null; intensidad_max: number | null; inicio: string | null; fin: string | null;
    en_curso: boolean | null; localizacion: string | null; tipo: string | null;
  };
  sintomas: string[];
  prodromo: string[];
  medicacion_aguda: { nombre: string; hora: string | null; dosis: string | null; alivio: string | null }[];
  preventivo_tomado: boolean | null;
  sueno: {
    horas: number | null; hora_acostarse: string | null; hora_levantarse: string | null;
    calidad: string | null; siesta: boolean | null;
  };
  comidas: { saltada: boolean | null; horas_ayuno_max: number | null; notas: string | null };
  agua_vasos: number | null;
  cafeina_tazas: number | null;
  alcohol: { bebidas: number | null; tipo: string | null };
  alimentos_sospechosos: string[];
  estres_0_10: number | null;
  animo_0_10: number | null;
  bajada_tras_estres: boolean | null;
  regla_hoy: boolean | null;
  ejercicio_min: number | null;
  pantallas_horas: number | null;
  entorno: string[];
  impacto: string | null;
  otros: string | null;
  resumen: string;
  faltan: string[];
};
