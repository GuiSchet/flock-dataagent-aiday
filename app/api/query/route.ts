import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { resolveVisualization, type ResolveRequest } from "@/lib/conversation/resolve";

/**
 * Etapa 2 de la tubería: resolver el pedido y ejecutar la consulta.
 *
 * Es el único lugar del que salen números que después se muestran. Recibe los parámetros
 * **tal cual los mandó el agente de voz** —el handler del client tool no los puede validar,
 * porque el catálogo se arma leyendo los CSV con `node:fs`— y devuelve el `VizIntent`
 * resuelto, las filas y todo lo que el agente necesita para narrar.
 *
 * Responde en milisegundos, y eso es parte del diseño: el client tool que lo llama tiene
 * que devolverle algo al agente de voz antes de que la conversación se trabe
 * (research.md D13).
 */

export const dynamic = "force-dynamic";

const MODES = new Set(["propose", "refine", "resolve"]);

export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;

  let body: ResolveRequest;

  try {
    body = (await request.json()) as ResolveRequest;
  } catch {
    return NextResponse.json(
      { ok: false, message: "El cuerpo del pedido no es JSON válido." },
      { status: 400 },
    );
  }

  if (!body || !MODES.has(body.mode)) {
    return NextResponse.json(
      { ok: false, message: "Falta mode: propose, refine o resolve." },
      { status: 400 },
    );
  }

  try {
    const resolution = resolveVisualization(body);
    // Un pedido que no se puede cumplir no es una falla del sistema: trae la alternativa
    // que el agente le va a ofrecer al usuario en voz.
    return NextResponse.json(resolution, { status: resolution.ok ? 200 : 422 });
  } catch (error) {
    console.error("[consulta] Falla inesperada:", error);
    return NextResponse.json(
      { ok: false, message: "No se pudo ejecutar la consulta." },
      { status: 500 },
    );
  }
}
