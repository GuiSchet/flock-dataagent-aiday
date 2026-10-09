# Contrato — Sesión de voz

Ciclo de vida de la conversación con ElevenLabs. Escrito contra `@elevenlabs/react@1.15.2`,
que rompe con la API 0.5.x que usa vistaenergy (research.md D10).

## Transporte

WebRTC. El servidor pide un token efímero y el cliente abre la sesión con él.

```
GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=<ELEVENLABS_AGENT_ID>
headers: { "xi-api-key": <ELEVENLABS_API_KEY> }
→ { token: string }
```

Se expone como `GET /api/conversation-token`, que devuelve `{ token }`. El handler MUST
declarar `export const dynamic = "force-dynamic"` y responder con `Cache-Control: no-store`:
un token cacheado es un token quemado, y cada pedido cuesta.

La clave nunca sale del servidor (FR-024).

## Montaje

```tsx
<ConversationProvider
  connectionType="webrtc"
  isMuted={isMuted}
  onMutedChange={setIsMuted}
  onConnect={({ conversationId }) => …}
  onDisconnect={(details) => …}
  onError={(message, context) => …}
  onModeChange={({ mode }) => …}     // "speaking" | "listening"
  onMessage={({ message, role }) => …}  // sólo para log
  onInterruption={() => …}           // barge-in
>
  <VoiceTools />   {/* registra los client tools; no renderiza nada */}
  <Totem />
</ConversationProvider>
```

Reglas que impone la versión 1.15.2:

- `<ConversationProvider>` es **obligatorio**. `useConversation` fuera de él lanza.
- `startSession()` devuelve **`void`**, no una promesa. El `conversationId` llega por
  `onConnect`. Todo código con `await startSession(...)` está roto.
- Llamar `startSession()` con una sesión ya abierta es un no-op silencioso.
- Los callbacks del provider, del hook y de `startSession` **se componen**, no se pisan.
- El paquete es ESM puro y todo lo que lo toca necesita `"use client"`.

## Estado que consume la interfaz

Se leen con los hooks granulares, no con `useConversation`, que re-renderiza ante cualquier
cambio de la sesión:

| Dato | Hook |
|------|------|
| `status`, `message` | `useConversationStatus()` |
| `mode`, `isSpeaking`, `isListening` | `useConversationMode()` |
| `isMuted`, `setMuted` | `useConversationInput()` |
| `startSession`, `endSession`, `sendContextualUpdate` | `useConversationControls()` |

`status` es `"disconnected" | "connecting" | "connected" | "error"`. El valor `"error"` y el
campo `message` son nuevos en 1.x.

## Arranque

1. Pedir permiso de micrófono con `getUserMedia({ audio: true })` **antes** de pedir el
   token: si el usuario deniega, no se quema un token.
2. Cerrar ese stream de prueba con `track.stop()` en todos los tracks. vistaenergy lo deja
   abierto y queda el indicador de micrófono prendido con un stream huérfano.
3. `GET /api/conversation-token`.
4. `startSession({ conversationToken })`.

Si el permiso se deniega, la pantalla MUST mostrar un estado explícito con el motivo y cómo
resolverlo. Nada de `alert()`.

## Desconexión y errores

| Situación | Qué hace la app |
|-----------|-----------------|
| `status === "error"` | Muestra `message` y un botón para reintentar. **No navega a otro lado.** |
| `onDisconnect` con `reason: "error"` | Igual que arriba, conservando el gráfico en pantalla. |
| `onDisconnect` con `reason: "user"` | Vuelve al reposo. |
| Fallo del token | Estado de error con reintento; no deja la pantalla en blanco. |

Regla explícita: una caída de conexión **nunca** saca al usuario de la pantalla ni borra el
gráfico. vistaenergy redirige a `/` apenas `status` vuelve a `disconnected` habiendo estado
conectado, así que cualquier corte de red expulsa al usuario. Eso no se porta.

## Barge-in

`onInterruption` se dispara cuando el usuario habla encima del agente. **Una interrupción sola
no cancela la composición en curso**; la cancela un pedido nuevo (decisión del 2026-09-23,
research.md D15).

El motivo: en un tótem, la gente dice "ajá" u "ok" mientras el agente narra. Si cada
barge-in abortara la composición, un murmullo mataría el gráfico que la persona está
esperando. El edge case de la spec ("el usuario habla mientras se genera: se cancela y se
atiende la nueva intención") se cumple igual: si lo que dijo es un pedido, el agente llama a un
tool, el handler dispara `send()` otra vez y `useUIStream` aborta el envío anterior. Si no es
un pedido, no hay nada que cancelar.

## Mute

Se controla con las props `isMuted` / `onMutedChange` del provider —no `micMuted`, que no
existe en 1.15— y se lee con `isMuted` / `setMuted` de `useConversationInput()`. No se tocan
los `MediaStreamTrack` a mano.

## Transcripción

`onMessage` entrega `{ message, role: "user" | "agent" }`. **No se muestra en pantalla**: la
decisión de producto es que el tótem exhiba lo que el agente *entendió* (el `IntentRibbon`
derivado del `VizIntent`), no lo que se dijo. `onMessage` se usa sólo para logs de
diagnóstico.

No existe transcripción parcial del usuario en esta API; `useScribe` la ofrece pero requiere
una segunda captura de audio y su propio token, y no hace falta para esto.

## `sendContextualUpdate`

Inyecta contexto sin provocar una respuesta del agente. Sirve para cosas que el agente
tiene que saber pero no tiene por qué decir. **No sirve para avisar un fallo** que la persona
tiene que escuchar: para eso, ver `sendUserMessage` más abajo.

El texto MUST terminar con una nota de que no hace falta acusar recibo.

## `sendUserMessage`

**Se usa en un solo caso: cuando la composición falla del todo.**

El tool ya devolvió "dibujado" (retorno temprano, D13), así que el agente pudo haber dicho
"listo". Un `sendContextualUpdate` no lo hace hablar: se verificó en vivo, y la persona se
quedaba con un "listo" falso frente al gráfico anterior. El mensaje sí lo hace hablar, y si
está hablando lo interrumpe y lo corrige.

El mensaje empieza con `[aviso de la app, no lo dijo la persona]`, y el prompt del agente
tiene una regla para tratarlo como aviso y no como algo que dijo la persona. La transcripción
no se muestra en el tótem, así que no ensucia nada visible.

Para todo lo demás sigue la regla: **no se inyectan turnos falsos del usuario.** vistaenergy
lo hace para forzar que el agente narre un gráfico que él no eligió; acá el agente genera el
gráfico, así que ya sabe qué es.
