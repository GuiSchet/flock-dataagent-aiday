"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPassword,
  createSessionToken,
  isAuthConfigured,
  safeNext,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";

export interface LoginState {
  error: string | null;
}

/** Una clave equivocada tarda un poco en contestar: probar claves de a miles deja de rendir. */
const FAILED_LOGIN_DELAY_MS = 500;

/**
 * La cookie va `Secure` siempre que la página llegó por HTTPS. No alcanza con mirar
 * `NODE_ENV`: un `npm start` en la red local es producción por http, y ahí el navegador
 * descartaría la cookie y el login no terminaría nunca.
 */
async function isHttps(): Promise<boolean> {
  const h = await headers();
  if (h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  return h.get("origin")?.startsWith("https://") ?? false;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return { error: "El login no está configurado en el servidor." };
  }

  const password = formData.get("password");
  if (typeof password !== "string" || !(await checkPassword(password))) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return { error: "La clave no es correcta." };
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  // `redirect` corta con una excepción: va fuera de cualquier try.
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
