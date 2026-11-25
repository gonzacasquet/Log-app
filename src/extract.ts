import Anthropic from "@anthropic-ai/sdk";
import { LOG_SCHEMA, type DayLog } from "./schema";

const SYSTEM = `Eres el asistente de un diario de migraña. Recibes la transcripción de un audio en español en el que una persona con migraña crónica cuenta cómo ha ido su día, y devuelves el registro estructurado.

Reglas:
- Usa solo lo que la persona dice. Si algo no se menciona, pon null (o una lista vacía). No supongas ni rellenes por defecto.
- "No he tenido dolor" => dolor.hubo = false. Si describe dolor, dolor.hubo = true.
- Las cantidades habladas pásalas a número ("un par de cafés" => 2, "unos seis vasos de agua" => 6, "dormí de 12 a 7" => 7 horas).
- Un café, un té o un refresco de cola cuentan como una taza de cafeína.
- Medicación aguda: cualquier analgésico, antiinflamatorio, triptán, gepante o antiemético tomado para el dolor. El tratamiento preventivo diario va en preventivo_tomado.
- prodromo: señales que nota antes de que empiece el dolor (bostezos, antojos, cuello rígido, cansancio…).
- La transcripción automática puede tener errores con nombres de fármacos; corrígelos si es evidente (p.ej. "suma tritán" => sumatriptán).
- En "faltan" pon los bloques clave que no se han mencionado en absoluto, para pedírselos después. Si se ha dicho algo sobre un bloque, aunque sea breve, no lo pongas.
- El resumen, en una o dos frases y en segunda persona ("Has tenido…").`;

export async function extractDayLog(
  apiKey: string,
  transcript: string,
  previous: DayLog | null,
  dayLabel: string,
): Promise<DayLog> {
  const client = new Anthropic({ apiKey });

  const content = previous
    ? `Día: ${dayLabel}\n\nYa había un registro de este día:\n${JSON.stringify(previous)}\n\nNuevo audio del mismo día (complementa o corrige lo anterior; si algo contradice lo anterior, manda lo nuevo; las cantidades del día se suman solo si se refiere claramente a algo distinto):\n"""${transcript}"""\n\nDevuelve el registro completo del día ya combinado.`
    : `Día: ${dayLabel}\n\nTranscripción del audio:\n"""${transcript}"""`;

  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: LOG_SCHEMA as unknown as Record<string, unknown> },
    },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("El modelo no ha podido procesar este audio.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Respuesta incompleta del modelo.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as DayLog;
}
