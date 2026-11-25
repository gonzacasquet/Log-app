// Genera el par de claves VAPID para las notificaciones push.
// Uso: node scripts/gen-vapid.mjs
const { subtle } = globalThis.crypto;
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await subtle.exportKey("raw", kp.publicKey);
const jwk = await subtle.exportKey("jwk", kp.privateKey);

console.log("VAPID_PUBLIC_KEY=" + b64url(pub));
console.log("VAPID_PRIVATE_KEY=" + jwk.d);
