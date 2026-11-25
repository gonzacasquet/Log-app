import { analyze, intensity, painColor, shiftDay, tookAcute } from "./patterns.js";

// ---------- estado y almacenamiento ----------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const state = {
  token: store.get("token"),
  config: null,
  days: [],
  dayChoice: "today",
  range: 30,
  lastPayload: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", authorization: `Bearer ${state.token}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    logout();
    throw new Error("Código de acceso incorrecto");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const fmtDay = (day, opts = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("es-ES", { ...opts, timeZone: "UTC" });
const today = () => state.config?.today;
const selectedDay = () => (state.dayChoice === "yesterday" ? shiftDay(today(), -1) : today());

// ---------- arranque ----------

async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (!state.token) return showLogin();
  try {
    state.config = await api("/api/config");
  } catch (e) {
    if (!state.token) return; // ya se ha mostrado el login
    showFatal(e.message);
    return;
  }
  $("#login").hidden = true;
  $("#app").hidden = false;
  bindUI();
  await refreshDays();
  renderToday();
  renderSettings();
  if (location.hash === "#ajustes") switchTab("ajustes");
}

function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
}

function showFatal(msg) {
  $("#app").hidden = false;
  $("#tab-hoy").innerHTML = `<div class="card error-card"><p>No se puede conectar: ${esc(msg)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
}

function logout() {
  store.del("token");
  state.token = null;
  showLogin();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  state.token = $("#login-token").value.trim();
  try {
    state.config = await api("/api/config");
    store.set("token", state.token);
    location.reload();
  } catch (err) {
    $("#login-error").textContent = err.message;
    $("#login-error").hidden = false;
  }
});

let bound = false;
function bindUI() {
  if (bound) return;
  bound = true;

  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $$("#tab-hoy .seg").forEach((b) =>
    b.addEventListener("click", () => {
      state.dayChoice = b.dataset.day;
      $$("#tab-hoy .seg").forEach((x) => x.classList.toggle("active", x === b));
      renderToday();
    }),
  );
  $$("#tab-patrones .seg").forEach((b) =>
    b.addEventListener("click", () => {
      state.range = Number(b.dataset.range);
      $$("#tab-patrones .seg").forEach((x) => x.classList.toggle("active", x === b));
      renderPatterns();
    }),
  );

  $("#rec-btn").addEventListener("click", toggleRecording);
  $("#text-send").addEventListener("click", () => {
    const text = $("#text-input").value.trim();
    if (text) submit({ text, day: selectedDay() });
  });
  $("#retry-btn").addEventListener("click", () => state.lastPayload && submit(state.lastPayload));

  $("#add-time").addEventListener("click", () => addTimeRow(""));
  $("#save-times").addEventListener("click", saveTimes);
  $("#enable-push").addEventListener("click", enablePush);
  $("#test-push").addEventListener("click", testPush);
  $("#set-location").addEventListener("click", setLocation);
  $("#export-csv").addEventListener("click", exportCSV);
  $("#export-json").addEventListener("click", () =>
    download(`diario-migrana-${today()}.json`, JSON.stringify(state.days, null, 2), "application/json"),
  );
  $("#logout").addEventListener("click", logout);

  // Al volver a la app (p.ej. desde una notificación) refresca el estado
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && !recorder) {
      try {
        state.config = await api("/api/config");
        await refreshDays();
        renderToday();
      } catch {}
    }
  });
}

function switchTab(name) {
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "historial") renderHistory();
  if (name === "patrones") renderPatterns();
  if (name === "ajustes") renderSettings();
  window.scrollTo(0, 0);
}

async function refreshDays() {
  state.days = await api("/api/days");
}

const recordFor = (day) => state.days.find((d) => d.day === day);

// ---------- HOY ----------

function renderToday() {
  const day = selectedDay();
  const rec = recordFor(day);
  $("#today-label").textContent = fmtDay(day);
  const pill = $("#status-pill");
  pill.textContent = rec ? "Registrado ✓" : "Pendiente";
  pill.classList.toggle("ok", !!rec);
  $("#questions").open = !rec;
  $("#rec-label").textContent = rec ? "Grabar algo más de este día" : "Pulsa para grabar";
  if (rec) {
    $("#result").innerHTML = renderRecord(rec, { showMissing: true });
    $("#result").hidden = false;
  } else {
    $("#result").hidden = true;
  }
}

const LABELS_FALTAN = {
  dolor: "el dolor",
  medicacion: "la medicación",
  sueno: "cómo dormiste",
  comidas: "las comidas",
  agua_cafeina_alcohol: "agua, café o alcohol",
  estres: "el estrés",
  regla: "si tienes la regla",
  impacto: "si pudiste hacer vida normal",
};

const NICE = {
  nauseas: "náuseas", vomitos: "vómitos", fotofobia: "luz", fonofobia: "ruido", osmofobia: "olores",
  aura_visual: "aura visual", aura_sensitiva: "aura sensitiva", mareo: "mareo", dolor_cuello: "cuello",
  fatiga: "fatiga", niebla_mental: "niebla mental", otro: "otro", bostezos: "bostezos", antojos: "antojos",
  rigidez_cuello: "cuello rígido", cansancio: "cansancio", irritabilidad: "irritabilidad",
  sensibilidad_luz_ruido: "sensibilidad luz/ruido", orinar_mas: "orinar más", dificultad_concentracion: "concentración",
  luz_intensa: "luz intensa", ruido: "ruido", olores_fuertes: "olores", viaje: "viaje", calor: "calor", frio: "frío",
  altitud: "altitud", humo: "humo",
};
const nice = (arr) => (arr || []).map((x) => NICE[x] || x).join(", ");

function renderRecord(rec, { showMissing = false, showTranscript = false } = {}) {
  const d = rec.data;
  const i = intensity(rec);
  const chips = [];
  if (i != null) chips.push(`<span class="chip pain" style="background:${painColor(i)}">Dolor ${i}/10</span>`);
  if (d.impacto) chips.push(`<span class="chip">${esc(d.impacto)}</span>`);
  if (d.medicacion_aguda?.length) chips.push(`<span class="chip">💊 ${d.medicacion_aguda.map((m) => esc(m.nombre)).join(", ")}</span>`);
  if (d.sueno?.horas != null) chips.push(`<span class="chip">😴 ${d.sueno.horas} h</span>`);
  if (d.estres_0_10 != null) chips.push(`<span class="chip">🧠 estrés ${d.estres_0_10}</span>`);
  if (d.cafeina_tazas != null) chips.push(`<span class="chip">☕ ${d.cafeina_tazas}</span>`);
  if (d.agua_vasos != null) chips.push(`<span class="chip">💧 ${d.agua_vasos}</span>`);
  if (d.regla_hoy) chips.push(`<span class="chip">🩸 regla</span>`);

  const rows = [];
  const add = (k, v) => v != null && v !== "" && rows.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`);
  if (d.dolor?.hubo) {
    add("Horario", [d.dolor.inicio, d.dolor.fin].filter(Boolean).join(" – ") + (d.dolor.en_curso ? " (sigue)" : ""));
    add("Dónde", d.dolor.localizacion);
    add("Cómo", d.dolor.tipo);
  }
  add("Síntomas", nice(d.sintomas));
  add("Antes del dolor", nice(d.prodromo));
  for (const m of d.medicacion_aguda || []) {
    add("Medicación", [m.nombre, m.dosis, m.hora && `a las ${m.hora}`, m.alivio && `alivio ${m.alivio}`].filter(Boolean).join(" · "));
  }
  if (d.preventivo_tomado != null) add("Preventivo", d.preventivo_tomado ? "sí" : "no");
  if (d.sueno) add("Sueño", [d.sueno.hora_acostarse && `${d.sueno.hora_acostarse}–${d.sueno.hora_levantarse ?? "?"}`, d.sueno.calidad, d.sueno.siesta ? "siesta" : null].filter(Boolean).join(" · "));
  if (d.comidas) add("Comidas", [d.comidas.saltada ? "saltó una comida" : null, d.comidas.horas_ayuno_max != null ? `ayuno máx. ${d.comidas.horas_ayuno_max} h` : null, d.comidas.notas].filter(Boolean).join(" · "));
  if (d.alcohol?.bebidas) add("Alcohol", `${d.alcohol.bebidas}${d.alcohol.tipo ? ` (${d.alcohol.tipo})` : ""}`);
  add("Alimentos", (d.alimentos_sospechosos || []).join(", "));
  if (d.animo_0_10 != null) add("Ánimo", `${d.animo_0_10}/10`);
  if (d.ejercicio_min != null) add("Ejercicio", `${d.ejercicio_min} min`);
  if (d.pantallas_horas != null) add("Pantallas", `${d.pantallas_horas} h`);
  add("Entorno", nice(d.entorno));
  add("Otros", d.otros);
  if (rec.weather) {
    const w = rec.weather;
    add("Tiempo", `${w.presion_media} hPa${w.cambio_presion_vs_ayer != null ? ` (${w.cambio_presion_vs_ayer > 0 ? "+" : ""}${w.cambio_presion_vs_ayer})` : ""} · ${w.temp_max} °C · ${w.humedad_media} %`);
  }

  let html = `<div class="card"><p class="summary">${esc(d.resumen)}</p><div class="chips">${chips.join("")}</div>`;
  if (rows.length) html += `<dl class="kv">${rows.join("")}</dl>`;
  if (showMissing && d.faltan?.length) {
    html += `<div class="missing"><p>Te ha faltado contar ${d.faltan.map((f) => LABELS_FALTAN[f] || f).join(", ")}.</p><button class="btn" onclick="window.scrollTo({top:0,behavior:'smooth'})">Grabar lo que falta</button></div>`;
  }
  if (showTranscript && rec.transcripts?.length) {
    html += `<div class="transcript">${rec.transcripts.map((t) => esc(t.text)).join("\n\n")}</div>`;
  }
  return html + `</div>`;
}

// ---------- grabación ----------

let recorder = null;
let chunks = [];
let timerInt = null;
const MAX_SECONDS = 300;

function pickMime() {
  const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

async function toggleRecording() {
  if (recorder) return recorder.stop();
  hideError();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return showError("No hay permiso para usar el micrófono. Actívalo en Ajustes del iPhone o escribe el registro.");
  }
  const mimeType = pickMime();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(timerInt);
    $("#rec-btn").classList.remove("recording");
    $("#rec-timer").hidden = true;
    $("#rec-label").textContent = "Pulsa para grabar";
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" });
    recorder = null;
    if (blob.size < 2000) return showError("La grabación es demasiado corta.");
    const audio = await blobToBase64(blob);
    submit({ audio, mime: blob.type, day: selectedDay() });
  };
  recorder.start(1000);
  $("#rec-btn").classList.add("recording");
  $("#rec-label").textContent = "Grabando… pulsa para terminar";
  $("#rec-timer").hidden = false;
  const start = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    $("#rec-timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s >= MAX_SECONDS && recorder) recorder.stop();
  };
  tick();
  timerInt = setInterval(tick, 500);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function submit(payload) {
  state.lastPayload = payload;
  hideError();
  $("#processing").hidden = false;
  $("#processing-label").textContent = payload.audio ? "Transcribiendo y analizando el audio…" : "Analizando…";
  $("#rec-btn").disabled = true;
  $("#text-send").disabled = true;
  try {
    await api("/api/log", { method: "POST", body: JSON.stringify(payload) });
    state.lastPayload = null;
    $("#text-input").value = "";
    $("#text-entry").open = false;
    await refreshDays();
    renderToday();
    clearReminders();
  } catch (e) {
    showError(e.message || "No se ha podido guardar. Revisa la conexión.");
    $("#retry-btn").hidden = false;
  } finally {
    $("#processing").hidden = true;
    $("#rec-btn").disabled = false;
    $("#text-send").disabled = false;
  }
}

async function clearReminders() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    (await reg?.getNotifications?.())?.forEach((n) => n.close());
    navigator.clearAppBadge?.();
  } catch {}
}

function showError(msg) {
  $("#error-text").textContent = msg;
  $("#retry-btn").hidden = !state.lastPayload;
  $("#error-box").hidden = false;
}
function hideError() {
  $("#error-box").hidden = true;
}

// ---------- HISTORIAL ----------

function renderHistory() {
  const list = $("#history-list");
  if (!state.days.length) {
    list.innerHTML = `<div class="card muted">Aún no hay días registrados.</div>`;
    return;
  }
  list.innerHTML = state.days
    .map((rec) => {
      const i = intensity(rec);
      return `<details class="card day" data-day="${rec.day}">
        <summary class="day-item">
          <div class="day-badge" style="background:${painColor(i) ?? "var(--surface-2)"}">${i ?? "–"}</div>
          <div><h3>${esc(fmtDay(rec.day))}</h3><p>${esc(rec.data.resumen)}</p></div>
        </summary>
        ${renderRecord(rec, { showTranscript: true })}
        <button class="btn ghost small" data-delete="${rec.day}">Borrar este día</button>
      </details>`;
    })
    .join("");
  list.querySelectorAll("[data-delete]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("¿Borrar el registro de este día?")) return;
      await api(`/api/days/${b.dataset.delete}`, { method: "DELETE" });
      await refreshDays();
      renderHistory();
      renderToday();
    }),
  );
}

// ---------- PATRONES ----------

function renderPatterns() {
  const { stats, factors, inRange } = analyze(state.days, state.range, today());
  const box = $("#patterns");
  if (!inRange.length) {
    box.innerHTML = `<div class="card muted">Cuando lleves unos días registrados verás aquí tus patrones.</div>`;
    return;
  }

  let html = "";
  if (stats.medicacion30 >= 10) {
    html += `<div class="alert">Has tomado medicación para el dolor ${stats.medicacion30} de los últimos 30 días. Tomarla 10 días o más al mes puede empeorar las migrañas (cefalea por abuso de medicación): coméntalo con tu neuróloga.</div>`;
  }

  html += `<div class="tiles">
    <div class="tile"><div class="v">${stats.conDolor}<span class="muted small"> / ${stats.registrados}</span></div><div class="l">días con dolor</div></div>
    <div class="tile"><div class="v">${stats.fuertes}</div><div class="l">días fuertes (≥6 o incapacitantes)</div></div>
    <div class="tile"><div class="v">${stats.medicacion}</div><div class="l">días con medicación para el dolor</div></div>
    <div class="tile"><div class="v">${stats.media ?? "–"}</div><div class="l">intensidad media (0–10)</div></div>
  </div>`;

  // Calendario de las últimas 5 semanas
  const end = today();
  const startDay = shiftDay(end, -34);
  const firstDow = (new Date(`${startDay}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  let cal = "";
  for (let k = 0; k < firstDow; k++) cal += `<div style="visibility:hidden"></div>`;
  for (let k = 0; k < 35; k++) {
    const day = shiftDay(startDay, k);
    const rec = state.days.find((d) => d.day === day);
    const i = intensity(rec);
    const label = Number(day.slice(8));
    cal += rec
      ? `<div class="${tookAcute(rec) ? "med" : ""}" style="background:${painColor(i) ?? "var(--surface-2)"}" title="${day}">${label}</div>`
      : `<div class="empty" title="${day}">${label}</div>`;
  }
  html += `<div class="card"><h2>Últimas 5 semanas</h2>
    <div class="cal">${["L", "M", "X", "J", "V", "S", "D"].map((d) => `<div class="muted" style="aspect-ratio:auto">${d}</div>`).join("")}${cal}</div>
    <div class="legend">
      <span><i style="background:var(--pain-0)"></i>0</span><span><i style="background:var(--pain-1)"></i>1–3</span>
      <span><i style="background:var(--pain-2)"></i>4–5</span><span><i style="background:var(--pain-3)"></i>6–7</span>
      <span><i style="background:var(--pain-4)"></i>8–10</span><span><i style="background:var(--warn)"></i>medicación</span>
    </div></div>`;

  // Factores
  const maxDiff = Math.max(1, ...factors.filter((f) => f.enough).map((f) => Math.abs(f.diff)));
  html += `<div class="card"><h2>Qué va con más dolor</h2>
    <p class="muted small">Intensidad media de ese día y el siguiente cuando ocurre cada cosa, frente a cuando no. Hacen falta al menos ${3} días de cada para comparar.</p>`;
  for (const f of factors) {
    if (!f.enough) continue;
    const w = (Math.abs(f.diff) / maxDiff) * 50;
    const color = f.diff > 0 ? "var(--pain-4)" : "var(--ok)";
    const left = f.diff > 0 ? 50 : 50 - w;
    html += `<div class="factor">
      <div class="factor-head"><span>${esc(f.label)}</span><b style="color:${color}">${f.diff > 0 ? "+" : ""}${f.diff}</b></div>
      <div class="factor-sub">${f.avgYes} con (${f.nYes} días) · ${f.avgNo} sin (${f.nNo} días)</div>
      <div class="bar"><span style="left:${left}%;width:${w}%;background:${color}"></span><span style="left:50%;width:1px;background:var(--muted)"></span></div>
    </div>`;
  }
  const pending = factors.filter((f) => !f.enough);
  if (pending.length) {
    html += `<p class="muted small" style="margin-top:12px">Aún sin datos suficientes: ${pending.map((f) => esc(f.label.toLowerCase())).join(", ")}.</p>`;
  }
  html += `<p class="muted small" style="margin-top:12px">Ojo: que dos cosas coincidan no significa que una cause la otra. Algunas “causas” son en realidad los primeros síntomas de la crisis (p. ej. antojos de dulce o sensibilidad a la luz). Con más semanas de datos, las diferencias son más fiables.</p></div>`;

  box.innerHTML = html;
}

// ---------- AJUSTES ----------

function renderSettings() {
  const s = state.config.settings;
  const list = $("#times-list");
  list.innerHTML = "";
  s.times.forEach((t) => addTimeRow(t));
  $("#tz-label").textContent = `Zona horaria: ${s.tz}`;
  $("#loc-state").textContent = s.lat != null ? `Ubicación guardada (${s.lat}, ${s.lon}).` : "Sin ubicación.";
  updatePushState();
  // Ajusta la zona horaria automáticamente si ha cambiado
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && tz !== s.tz) {
    api("/api/settings", { method: "PUT", body: JSON.stringify({ tz }) })
      .then((n) => { state.config.settings = n; $("#tz-label").textContent = `Zona horaria: ${n.tz}`; })
      .catch(() => {});
  }
}

function addTimeRow(value) {
  if ($$("#times-list .time-row").length >= 6) return;
  const row = document.createElement("div");
  row.className = "time-row";
  row.innerHTML = `<input type="time" value="${esc(value)}"><button class="btn ghost" aria-label="Quitar">✕</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("#times-list").appendChild(row);
}

async function saveTimes() {
  const times = $$("#times-list input").map((i) => i.value).filter(Boolean);
  try {
    state.config.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ times }) });
    renderSettings();
    toast("Horas guardadas");
  } catch (e) {
    alert(e.message);
  }
}

async function updatePushState() {
  const el = $("#push-state");
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  $("#install-help").hidden = isStandalone();
  if (!supported) {
    el.textContent = isStandalone()
      ? "Este dispositivo no admite notificaciones web (hace falta iOS 16.4 o posterior)."
      : "Las notificaciones solo funcionan desde la app añadida a la pantalla de inicio.";
    $("#enable-push").disabled = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  el.textContent = sub ? "Notificaciones activadas en este móvil ✓" : "Notificaciones desactivadas.";
  $("#enable-push").textContent = sub ? "Volver a activar" : "Activar notificaciones";
}

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return alert("No has dado permiso para notificaciones. Puedes activarlo en Ajustes del iPhone → Notificaciones.");
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(state.config.vapidPublicKey),
    });
    await api("/api/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
    updatePushState();
    toast("Recordatorios activados");
  } catch (e) {
    alert(`No se han podido activar: ${e.message}`);
  }
}

async function testPush() {
  try {
    const r = await api("/api/test-push", { method: "POST" });
    toast(r.sent ? "Notificación enviada" : "No hay ningún móvil suscrito");
  } catch (e) {
    alert(e.message);
  }
}

function setLocation() {
  if (!navigator.geolocation) return alert("Este dispositivo no permite ubicación.");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.config.settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      });
      renderSettings();
      toast("Ubicación guardada");
    },
    () => alert("No se ha podido obtener la ubicación."),
    { maximumAge: 3600000, timeout: 15000 },
  );
}

// ---------- exportar ----------

function exportCSV() {
  const cols = [
    ["dia", (r) => r.day],
    ["dolor", (r) => r.data.dolor?.hubo],
    ["intensidad_max", (r) => r.data.dolor?.intensidad_max],
    ["inicio", (r) => r.data.dolor?.inicio],
    ["fin", (r) => r.data.dolor?.fin],
    ["localizacion", (r) => r.data.dolor?.localizacion],
    ["tipo", (r) => r.data.dolor?.tipo],
    ["sintomas", (r) => (r.data.sintomas || []).join(" ")],
    ["prodromo", (r) => (r.data.prodromo || []).join(" ")],
    ["medicacion", (r) => (r.data.medicacion_aguda || []).map((m) => [m.nombre, m.dosis, m.hora, m.alivio].filter(Boolean).join(" ")).join(" | ")],
    ["preventivo", (r) => r.data.preventivo_tomado],
    ["sueno_horas", (r) => r.data.sueno?.horas],
    ["sueno_calidad", (r) => r.data.sueno?.calidad],
    ["comida_saltada", (r) => r.data.comidas?.saltada],
    ["agua_vasos", (r) => r.data.agua_vasos],
    ["cafeina", (r) => r.data.cafeina_tazas],
    ["alcohol", (r) => r.data.alcohol?.bebidas],
    ["estres", (r) => r.data.estres_0_10],
    ["animo", (r) => r.data.animo_0_10],
    ["regla", (r) => r.data.regla_hoy],
    ["ejercicio_min", (r) => r.data.ejercicio_min],
    ["pantallas_h", (r) => r.data.pantallas_horas],
    ["impacto", (r) => r.data.impacto],
    ["presion_hPa", (r) => r.weather?.presion_media],
    ["cambio_presion", (r) => r.weather?.cambio_presion_vs_ayer],
    ["temp_max", (r) => r.weather?.temp_max],
    ["humedad", (r) => r.weather?.humedad_media],
    ["resumen", (r) => r.data.resumen],
  ];
  const cell = (v) => {
    if (v == null) return "";
    const s = typeof v === "boolean" ? (v ? "sí" : "no") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...state.days].sort((a, b) => a.day.localeCompare(b.day));
  const csv = [cols.map((c) => c[0]).join(";"), ...rows.map((r) => cols.map((c) => cell(c[1](r))).join(";"))].join("\n");
  download(`diario-migrana-${today()}.csv`, "﻿" + csv, "text/csv");
}

function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--surface-2);color:var(--text);padding:10px 16px;border-radius:12px;z-index:9;font-size:15px";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

boot();
