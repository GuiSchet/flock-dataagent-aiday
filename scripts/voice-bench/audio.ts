import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * El audio del banco: cada frase se sintetiza una vez con el TTS de OpenAI y queda en caché,
 * y cada conversación se arma como un WAV con silencios entre frases, que Chrome reproduce
 * como si fuera el micrófono.
 */

const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = "alloy";
const TTS_INSTRUCTIONS = "Hablá en español rioplatense, claro y a ritmo normal.";

/** Silencio inicial: el agente saluda antes de escuchar. */
export const LEAD_IN_SECS = 7;

interface Pcm {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
}

/** Lee un WAV PCM. El TTS a veces declara el tamaño del chunk de datos como "hasta el final". */
function readWav(buffer: Buffer): Pcm {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("El TTS no devolvió un WAV.");
  }
  let offset = 12;
  let fmt: Omit<Pcm, "data"> | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV sin chunk fmt antes de los datos.");
      const end = size === 0 || size === 0xffffffff ? buffer.length : Math.min(buffer.length, body + size);
      return { ...fmt, data: buffer.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV sin chunk de datos.");
}

function writeWav(pcm: Pcm): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (pcm.sampleRate * pcm.channels * pcm.bitsPerSample) / 8;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(pcm.channels, 22);
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((pcm.channels * pcm.bitsPerSample) / 8, 32);
  header.writeUInt16LE(pcm.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.data.length, 40);
  return Buffer.concat([header, pcm.data]);
}

/** Sintetiza una frase, o la toma de la caché si ya se dijo alguna vez. */
export async function speech(text: string, cacheDir: string, apiKey: string): Promise<Pcm> {
  const key = crypto.createHash("sha1").update([TTS_MODEL, TTS_VOICE, TTS_INSTRUCTIONS, text].join("|")).digest("hex");
  const file = path.join(cacheDir, `${key}.wav`);
  if (!fs.existsSync(file)) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: "wav",
        instructions: TTS_INSTRUCTIONS,
      }),
    });
    if (!response.ok) throw new Error(`TTS respondió ${response.status}: ${await response.text()}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return readWav(fs.readFileSync(file));
}

export interface Segment {
  pcm: Pcm;
  /** Silencio después de la frase, en segundos. */
  wait: number;
}

/**
 * Arma el WAV de una conversación y devuelve en qué segundo empieza cada frase, contado desde
 * que arranca el audio.
 */
export function composeDialogue(segments: Segment[], file: string): { starts: number[]; total: number } {
  const first = segments[0]?.pcm;
  if (!first) throw new Error("Conversación sin frases.");
  const bytesPerSec = (first.sampleRate * first.channels * first.bitsPerSample) / 8;
  const silence = (secs: number) => Buffer.alloc(Math.round(secs * first.sampleRate) * first.channels * (first.bitsPerSample / 8));

  const parts: Buffer[] = [silence(LEAD_IN_SECS)];
  const starts: number[] = [];
  let t = LEAD_IN_SECS;
  for (const { pcm, wait } of segments) {
    if (pcm.sampleRate !== first.sampleRate || pcm.channels !== first.channels || pcm.bitsPerSample !== first.bitsPerSample) {
      throw new Error("Las frases del TTS vinieron con formatos distintos.");
    }
    starts.push(t);
    parts.push(pcm.data, silence(wait));
    t += pcm.data.length / bytesPerSec + wait;
  }
  fs.writeFileSync(file, writeWav({ ...first, data: Buffer.concat(parts) }));
  return { starts, total: t };
}
