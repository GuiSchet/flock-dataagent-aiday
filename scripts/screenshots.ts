import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./env";
import { launch, signIn } from "./voice-bench/browser";

/**
 * Capturas de la interfaz en los dos temas y en tamaños de pantalla de escritorio (T106,
 * SC-008): el tablero de la portada y el banco de componentes `/preview`.
 *
 *     npm run dev                  # /preview sólo existe en desarrollo
 *     npm run screenshots          # queda todo en .cache/screenshots/<fecha>/
 *
 * Las capturas de la conversación con gráficos las saca el banco de pruebas por voz, turno
 * por turno.
 */

const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1]! : "http://localhost:3000";
const SIZES: Array<[string, [number, number]]> = [
  ["1920x1080", [1920, 1080]],
  ["1440x900", [1440, 900]],
  ["1366x768", [1366, 768]],
  ["1280x800", [1280, 800]],
];
/** Nombre, ruta y si se captura la página entera o sólo lo que entra en la ventana. */
const PAGES = [
  ["tablero", "/", false],
  ["tablero-completo", "/", true],
  ["preview", "/preview", true],
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnvLocal();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const dir = path.join(process.cwd(), ".cache", "screenshots", stamp);
  fs.mkdirSync(dir, { recursive: true });

  let port = 9500;
  for (const theme of ["light", "dark"] as const) {
    for (const [sizeName, size] of SIZES) {
      const browser = await launch({
        profileDir: path.join(process.cwd(), ".cache", "chrome", `shots-${theme}-${sizeName}`),
        port: port++,
        colorScheme: theme,
        size,
      });
      try {
        await signIn(browser, url);
        for (const [name, route, fullPage] of PAGES) {
          await browser.send("Page.navigate", { url: new URL(route, url).toString() });
          // Las animaciones de entrada usan requestAnimationFrame: hay que esperar tiempo real.
          await sleep(2500);
          if (fullPage) {
            // La página entera, no sólo lo que entra en la ventana.
            const height = await browser.evaluate<number>("document.documentElement.scrollHeight");
            await browser.send("Emulation.setDeviceMetricsOverride", { width: size[0], height, deviceScaleFactor: 1, mobile: false });
            await sleep(800);
          }
          const file = path.join(dir, `${name}-${theme}-${sizeName}.png`);
          await browser.screenshot(file);
          await browser.send("Emulation.clearDeviceMetricsOverride");
          console.log(path.relative(process.cwd(), file));
        }
      } finally {
        await browser.close();
      }
    }
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
