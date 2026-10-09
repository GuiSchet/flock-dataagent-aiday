"use client";

import * as React from "react";
import { useConversationClientTool } from "@elevenlabs/react";
import { useSession } from "@/contexts/SessionContext";
import { createToolHandlers } from "@/lib/conversation/tools";

/**
 * Registra los cinco client tools en la sesión de voz. No renderiza nada.
 *
 * Los nombres tienen que coincidir exactamente con los de `elevenlabs/tools.ts`: si el
 * agente llama a uno que acá no existe, `onUnhandledClientToolCall` lo deja en consola.
 */
export function VoiceTools() {
  const { tools } = useSession();
  const handlers = React.useMemo(() => createToolHandlers(tools), [tools]);

  useConversationClientTool("getDataCatalog", handlers.getDataCatalog);
  useConversationClientTool("proposeVisualization", handlers.proposeVisualization);
  useConversationClientTool("refineVisualization", handlers.refineVisualization);
  useConversationClientTool("undoVisualization", handlers.undoVisualization);
  useConversationClientTool("queryCurrentChart", handlers.queryCurrentChart);

  return null;
}
