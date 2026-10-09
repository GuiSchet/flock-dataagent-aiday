import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";

/**
 * Token efímero para abrir la sesión de voz por WebRTC.
 *
 * La clave de ElevenLabs no sale del servidor (FR-024). El navegador pide un token, lo usa
 * una vez y se descarta.
 */

// Un token cacheado es un token quemado: nunca se guarda ni se reusa.
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    // El detalle sí va al log del servidor; al cliente sólo lo que puede accionar.
    console.error(
      "[voz] Falta configuración:",
      !apiKey ? "ELEVENLABS_API_KEY" : "",
      !agentId ? "ELEVENLABS_AGENT_ID" : "",
    );
    return NextResponse.json(
      {
        error: "config",
        message: "Falta configurar las credenciales de voz en .env.local.",
      },
      { status: 500, headers: NO_STORE },
    );
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey }, cache: "no-store" },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("[voz] ElevenLabs rechazó el pedido de token:", response.status, detail);
      return NextResponse.json(
        {
          error: "upstream",
          message: "No se pudo abrir la sesión de voz. Probá de nuevo en un momento.",
        },
        { status: 502, headers: NO_STORE },
      );
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token) {
      console.error("[voz] ElevenLabs respondió sin token:", body);
      return NextResponse.json(
        { error: "upstream", message: "La respuesta de voz vino incompleta." },
        { status: 502, headers: NO_STORE },
      );
    }

    return NextResponse.json({ token: body.token }, { headers: NO_STORE });
  } catch (error) {
    console.error("[voz] Error de red pidiendo el token:", error);
    return NextResponse.json(
      { error: "network", message: "No hay conexión con el servicio de voz." },
      { status: 502, headers: NO_STORE },
    );
  }
}
