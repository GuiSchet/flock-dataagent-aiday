import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Nada se ve sin entrar.
 *
 * En Next 16 esto es `proxy.ts` (antes `middleware.ts`) y corre en Node antes de cada pedido,
 * también antes de la portada, que es estática. Sin una sesión válida, una página redirige a
 * `/login` y una API devuelve 401: los datos no se ven y los créditos de OpenAI y ElevenLabs
 * no se gastan. Sin `APP_PASSWORD` o `AUTH_SECRET`, todo responde 503.
 */
export async function proxy(request: NextRequest) {
  if (!isAuthConfigured()) {
    return new NextResponse("El login no está configurado: faltan APP_PASSWORD y AUTH_SECRET.", {
      status: 503,
    });
  }

  const { pathname, search } = request.nextUrl;
  const signedIn = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthorized", message: "Iniciá sesión para usar la app." },
      { status: 401 },
    );
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Todo menos los assets de Next y las imágenes de public/, que la pantalla de login necesita.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$).*)"],
};
