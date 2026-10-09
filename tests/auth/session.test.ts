import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  checkPassword,
  createSessionToken,
  requireSession,
  safeNext,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifySessionToken,
} from "@/lib/auth/session";

const SECRET = "un-secreto-de-prueba-que-no-se-usa-en-ningun-lado";
const PASSWORD = "clave compartida";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("APP_PASSWORD", PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("token de sesión", () => {
  it("un token recién firmado vale", async () => {
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });

  it("vence a los siete días", async () => {
    const now = Date.now();
    const token = await createSessionToken(now);
    expect(await verifySessionToken(token, now + (SESSION_MAX_AGE - 60) * 1000)).toBe(true);
    expect(await verifySessionToken(token, now + (SESSION_MAX_AGE + 1) * 1000)).toBe(false);
  });

  it("no acepta un token adulterado", async () => {
    const token = await createSessionToken();
    const [version, expires, signature] = token.split(".");
    // Estirar el vencimiento invalida la firma.
    expect(await verifySessionToken(`${version}.${Number(expires) + 86_400}.${signature}`)).toBe(false);
    expect(await verifySessionToken(`${token}x`)).toBe(false);
    expect(await verifySessionToken(`${token}.extra`)).toBe(false);
    expect(await verifySessionToken("v1.abc.def")).toBe(false);
    expect(await verifySessionToken("")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });

  it("cambiar el secreto o la clave cierra las sesiones abiertas", async () => {
    const token = await createSessionToken();

    vi.stubEnv("AUTH_SECRET", `${SECRET}-rotado`);
    expect(await verifySessionToken(token)).toBe(false);

    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("APP_PASSWORD", "otra clave");
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("sin configuración no hay token que valga ni que se pueda crear", async () => {
    const token = await createSessionToken();
    vi.stubEnv("AUTH_SECRET", "");
    expect(await verifySessionToken(token)).toBe(false);
    await expect(createSessionToken()).rejects.toThrow(/APP_PASSWORD/);
  });
});

describe("clave", () => {
  it("acepta sólo la clave exacta", async () => {
    expect(await checkPassword(PASSWORD)).toBe(true);
    expect(await checkPassword(`${PASSWORD} `)).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });

  it("sin APP_PASSWORD no entra nadie, ni con la clave vacía", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(await checkPassword("")).toBe(false);
  });
});

describe("a dónde volver después de entrar", () => {
  it("sólo rutas propias", () => {
    expect(safeNext("/preview?x=1")).toBe("/preview?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(["/a", "/b"])).toBe("/");
  });
});

describe("route handlers", () => {
  it("devuelven 401 sin cookie y dejan pasar con una válida", async () => {
    const denied = await requireSession(new Request("http://localhost/api/query", { method: "POST" }));
    expect(denied?.status).toBe(401);

    const token = await createSessionToken();
    const allowed = await requireSession(
      new Request("http://localhost/api/query", {
        method: "POST",
        headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(allowed).toBeNull();
  });
});

describe("proxy", () => {
  const request = (path: string, token?: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
    });

  it("sin sesión, una página va al login y recuerda a dónde iba", async () => {
    const home = await proxy(request("/"));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("http://localhost:3000/login");

    const preview = await proxy(request("/preview?tema=oscuro"));
    expect(new URL(preview.headers.get("location")!).searchParams.get("next")).toBe("/preview?tema=oscuro");
  });

  it("sin sesión, una API contesta 401 y no gasta nada", async () => {
    for (const path of ["/api/query", "/api/compose", "/api/conversation-token", "/api/catalog"]) {
      expect((await proxy(request(path))).status, path).toBe(401);
    }
  });

  it("el login siempre se puede ver; con sesión, manda a la portada", async () => {
    expect((await proxy(request("/login"))).headers.get("x-middleware-next")).toBe("1");

    const token = await createSessionToken();
    const signedIn = await proxy(request("/login", token));
    expect(signedIn.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("con sesión, todo pasa", async () => {
    const token = await createSessionToken();
    for (const path of ["/", "/api/query", "/api/conversation-token"]) {
      expect((await proxy(request(path, token))).headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("sin APP_PASSWORD o AUTH_SECRET, nada queda abierto: 503", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    for (const path of ["/", "/login", "/api/query"]) {
      expect((await proxy(request(path))).status, path).toBe(503);
    }
  });
});
