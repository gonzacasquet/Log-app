// Comprueba que el cifrado Web Push y la firma VAPID son correctos descifrando como lo haría el navegador.
// Ejecutar: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptPayload, vapidAuthorization, b64urlEncode } from "../src/push.ts";
import { logicalDay } from "../src/dates.ts";

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number) {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));
}

test("aes128gcm: el navegador puede descifrar el mensaje", async () => {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const uaPublic = ua.getPublicKey();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: "Diario", body: "¿Qué tal el día? ñ 🎙️" });

  const body = Buffer.from(
    await encryptPayload(
      { endpoint: "https://x", p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) },
      new TextEncoder().encode(msg),
    ),
  );

  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const ecdh = ua.computeSecret(asPublic);
  const ikm = hkdf(auth, ecdh, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, plain.length - 1).toString("utf8"), msg);
});

test("VAPID: JWT ES256 válido", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  const d = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;

  const header = await vapidAuthorization("https://web.push.apple.com/abc", pub, d, "https://app.example");
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.equal(m[2], pub);
  const [h, c, s] = m[1].split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://app.example");
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    kp.publicKey,
    Buffer.from(s, "base64url"),
    new TextEncoder().encode(`${h}.${c}`),
  );
  assert.ok(ok);
});

test("día lógico: de madrugada cuenta como el día anterior", () => {
  // 01:30 en Madrid (invierno, UTC+1) del 26 → día 25
  assert.equal(logicalDay(new Date("2026-11-26T00:30:00Z"), "Europe/Madrid"), "2026-11-25");
  // 10:00 en Madrid del 26 → día 26
  assert.equal(logicalDay(new Date("2026-11-26T09:00:00Z"), "Europe/Madrid"), "2026-11-26");
});
