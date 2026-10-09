import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createSessionToken, isAuthConfigured, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Un Chrome headless con el WAV de la conversación como micrófono, manejado por DevTools
 * Protocol. Sin dependencias: Node trae `WebSocket` y `fetch`.
 */

export interface ConsoleLine {
  /** Segundos desde que arrancó el navegador. */
  t: number;
  text: string;
}

export interface Browser {
  logs: ConsoleLine[];
  now(): number;
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(file: string): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function launch(options: {
  /** El audio que Chrome usa como micrófono. Sin esto, no hay micrófono falso. */
  wav?: string;
  profileDir: string;
  port: number;
  colorScheme?: "light" | "dark";
  /** Ancho y alto de la ventana. Por defecto, 1280×900. */
  size?: [number, number];
}): Promise<Browser> {
  fs.rmSync(options.profileDir, { recursive: true, force: true });
  const chrome: ChildProcess = spawn(
    process.env.CHROME_BIN ?? "google-chrome",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${options.profileDir}`,
      `--remote-debugging-port=${options.port}`,
      `--window-size=${(options.size ?? [1280, 900]).join(",")}`,
      ...(options.wav
        ? [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${options.wav}%noloop`,
          ]
        : []),
      "--autoplay-policy=no-user-gesture-required",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${options.port}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      target = list.find((t) => t.type === "page");
    } catch {
      // Chrome todavía no abrió el puerto.
    }
  }
  if (!target) {
    chrome.kill("SIGKILL");
    throw new Error("Chrome no abrió el puerto de depuración. ¿Está instalado? (CHROME_BIN)");
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const logs: ConsoleLine[] = [];
  const pending = new Map<number, (value: unknown) => void>();
  let id = 0;

  ws.addEventListener("message", (event) => {
    const m = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
      method?: string;
      params?: {
        args?: Array<{ value?: unknown; description?: string }>;
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };
    };
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m.result ?? m.error);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = (m.params?.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ");
      logs.push({ t: now(), text });
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params?.exceptionDetails;
      logs.push({ t: now(), text: `[exception] ${d?.exception?.description ?? d?.text ?? ""}` });
    }
  });

  const send = <T,>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve) => {
      const i = ++id;
      pending.set(i, resolve as (value: unknown) => void);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  if (options.colorScheme) {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: options.colorScheme }],
    });
  }

  return {
    logs,
    now,
    send,
    async evaluate<T>(expression: string) {
      const r = await send<{ result?: { value?: T } }>("Runtime.evaluate", { expression, returnByValue: true });
      return r.result?.value as T;
    },
    async screenshot(file: string) {
      const r = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async close() {
      // Salir de la página cierra la sesión WebRTC con prolijidad. Matar Chrome directo la
      // deja abierta del lado de ElevenLabs hasta que vence, y la próxima puede no conectar.
      try {
        await send("Page.navigate", { url: "about:blank" });
        await sleep(1500);
      } catch {
        // Ya estaba cerrado.
      }
      ws.close();
      chrome.kill("SIGKILL");
    },
  };
}

/**
 * La app está detrás del login (`proxy.ts`): un token de sesión válido, firmado con
 * `AUTH_SECRET` y `APP_PASSWORD` del entorno. Es el mismo que dejaría escribir la clave en
 * `/login`.
 */
async function sessionToken(): Promise<string> {
  if (!isAuthConfigured()) {
    throw new Error("Faltan APP_PASSWORD y AUTH_SECRET en .env.local: sin ellas la app no deja entrar.");
  }
  return createSessionToken();
}

/** El header `cookie` para pedidos hechos desde Node, como el chequeo de que la app responde. */
export async function sessionCookieHeader(): Promise<string> {
  return `${SESSION_COOKIE}=${await sessionToken()}`;
}

/** Antes de navegar, el navegador recibe la cookie de sesión. */
export async function signIn(browser: Browser, appUrl: string): Promise<void> {
  await browser.send("Network.setCookie", {
    name: SESSION_COOKIE,
    value: await sessionToken(),
    url: new URL("/", appUrl).toString(),
    httpOnly: true,
    sameSite: "Lax",
  });
}
