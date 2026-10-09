import fs from "node:fs";
import path from "node:path";

/**
 * Auditoría de SC-007: cero colores, radios, sombras o tamaños tipográficos fuera del design
 * system de Flock (principio IV).
 *
 *     npm run audit:tokens
 *
 * - **Colores y sombras**: ningún literal (`#fff`, `rgba(…)`, `box-shadow: 0 1px…`) fuera de
 *   `app/globals.css`, que es donde viven los tokens. En el código, sólo `var(--…)`.
 * - **Tamaños tipográficos y radios** arbitrarios (`text-[13px]`, `rounded-[6px]`,
 *   `fontSize: 11`): sólo valores que el design system nombra. La lista sale del propio
 *   `docs/design-system/design-system.md`, así que no hay una segunda fuente que mantener.
 * - **`rem`**: en ningún lado. El design system está en px.
 *
 * Sale con código 1 si encuentra algo, para poder usarlo en CI.
 */

const ROOT = process.cwd();
const SCAN = ["app", "components", "contexts", "lib"];
const TOKENS_FILE = path.join("app", "globals.css");
const DESIGN_SYSTEM = fs.readFileSync(path.join(ROOT, "docs", "design-system", "design-system.md"), "utf8");

/** Los px que el design system menciona en algún lugar: escalas de tipografía, radios, etc. */
const DS_PX = new Set([...DESIGN_SYSTEM.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])));

interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(rel));
    else if (/\.(tsx?|css)$/.test(entry.name) && rel !== TOKENS_FILE) out.push(rel);
  }
  return out;
}

/** Saca comentarios: un "#fff" dentro de un comentario no pinta nada. */
function stripComments(line: string, state: { block: boolean }): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf("*/", i);
      if (end < 0) return out;
      state.block = false;
      i = end + 2;
    } else if (line.startsWith("/*", i)) {
      state.block = true;
      i += 2;
    } else if (line.startsWith("//", i) && line[i - 1] !== ":") {
      return out;
    } else {
      out += line[i];
      i++;
    }
  }
  return out;
}

const RULES: Array<{ rule: string; pattern: RegExp; allowed?: (m: RegExpMatchArray) => boolean }> = [
  { rule: "color literal", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { rule: "color literal", pattern: /\b(?:rgba?|hsla?)\(/g },
  { rule: "unidad rem", pattern: /\b\d+(?:\.\d+)?rem\b/g },
  { rule: "sombra literal", pattern: /(?:boxShadow|box-shadow)\s*:\s*(?!\s*["'`]?var\()/g },
  { rule: "sombra literal", pattern: /\bshadow-\[/g },
  {
    rule: "tamaño tipográfico fuera del design system",
    pattern: /\btext-\[(\d+(?:\.\d+)?)px\]/g,
    allowed: (m) => DS_PX.has(Number(m[1])),
  },
  {
    rule: "tamaño tipográfico fuera del design system",
    pattern: /\bfontSize:\s*(\d+(?:\.\d+)?)\b/g,
    allowed: (m) => DS_PX.has(Number(m[1])),
  },
  {
    rule: "radio fuera del design system",
    pattern: /\brounded-\[(\d+(?:\.\d+)?)(px|%)\]/g,
    // 50 % es un círculo, no un radio de la escala.
    allowed: (m) => (m[2] === "%" ? m[1] === "50" : DS_PX.has(Number(m[1]))),
  },
];

const findings: Finding[] = [];
for (const file of SCAN.flatMap(files)) {
  const state = { block: false };
  fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").forEach((raw, index) => {
    const line = stripComments(raw, state);
    for (const { rule, pattern, allowed } of RULES) {
      for (const m of line.matchAll(pattern)) {
        if (allowed?.(m)) continue;
        findings.push({ file, line: index + 1, rule, text: m[0] });
      }
    }
  });
}

if (findings.length === 0) {
  console.log("Tokens: cero valores fuera del design system (SC-007).");
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}: ${f.text}`);
  console.log(`\n${findings.length} valor(es) fuera del design system.`);
  process.exitCode = 1;
}
