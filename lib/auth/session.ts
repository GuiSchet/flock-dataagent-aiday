/**
 * La sesión del login: una contraseña compartida y una cookie firmada.
 *
 * No hay usuarios ni base de datos. Quien sabe `APP_PASSWORD` entra, y lo que queda en el
 * navegador es un token `v1.<vence>.<firma>`: la fecha de vencimiento en segundos y su
 * HMAC-SHA256. La clave del HMAC sale de `AUTH_SECRET` **y** de `APP_PASSWORD`, así que
 * cambiar cualquiera de las dos invalida todas las sesiones abiertas.
 *
 * Usa sólo Web Crypto: corre igual en el proxy, en los route handlers y en los tests. Nada
 * de acá se importa desde el navegador.
 */

export const SESSION_COOKIE = "flock_session";

/** Siete días, en segundos: lo que espera `maxAge` de una cookie. */
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

const VERSION = "v1";
const encoder = new TextEncoder();

interface AuthConfig {
  secret: string;
  password: string;
}

function authConfig(): AuthConfig | null {
  const secret = process.env.AUTH_SECRET?.trim();
  const password = process.env.APP_PASSWORD;
  if (!secret || !password) return null;
  return { secret, password };
}

/** Sin las dos variables la app no abre: nunca queda pública por un error de configuración. */
export function isAuthConfigured(): boolean {
  return authConfig() !== null;
}

function toBase64Url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function hmacKey({ secret, password }: AuthConfig): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${secret}\u0000${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Un token nuevo que vence en `SESSION_MAX_AGE`. Falla si el login no está configurado. */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const config = authConfig();
  if (!config) throw new Error("Faltan APP_PASSWORD y AUTH_SECRET.");
  const payload = `${VERSION}.${Math.floor(now / 1000) + SESSION_MAX_AGE}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(config), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** Si el token es de esta app, con esta clave, y todavía no venció. */
export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  const config = authConfig();
  if (!config || !token) return false;

  const [version, expires, signature, ...rest] = token.split(".");
  if (version !== VERSION || !expires || !signature || rest.length > 0) return false;
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 <= now) return false;

  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  // `verify` compara en tiempo constante.
  return crypto.subtle.verify("HMAC", await hmacKey(config), bytes, encoder.encode(`${version}.${expires}`));
}

/**
 * Compara la clave que escribió la persona con `APP_PASSWORD`. Se comparan los SHA-256 de
 * las dos, byte a byte y sin cortar en la primera diferencia, para que el tiempo de respuesta
 * no diga cuánto se acertó.
 */
export async function checkPassword(input: string): Promise<boolean> {
  const config = authConfig();
  if (!config) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(config.password)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/**
 * A dónde volver después de entrar. Sólo rutas propias: "/algo", nunca "//otro.sitio" ni una
 * URL completa, para que el login no sirva de redirector abierto.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/**
 * Para los route handlers: `null` si hay sesión, o la respuesta 401 para devolver.
 *
 * El proxy ya filtra, pero la guía de auth de Next trata a los route handlers como
 * públicos: un matcher mal escrito no tiene que dejar abierto lo que gasta créditos o
 * devuelve datos.
 */
export async function requireSession(request: Request): Promise<Response | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (await verifySessionToken(token)) return null;
  return Response.json({ error: "unauthorized", message: "Iniciá sesión para usar la app." }, { status: 401 });
}
