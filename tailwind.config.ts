import type { Config } from "tailwindcss";

/**
 * Tailwind CONSUME los tokens de Flock, no los define.
 *
 * Cada color de acá apunta a una CSS variable declarada en app/globals.css. Eso es lo
 * que hace que el tema oscuro funcione sin variantes `dark:` en cada clase: cambian los
 * tokens en `html.dark` y Tailwind sigue apuntando al mismo nombre.
 *
 * No agregar un color, radio o tamaño que no exista como token (constitución, principio IV).
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./contexts/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand)",
          dark: "var(--brand-dark)",
          bright: "var(--brand-2)",
          soft: "var(--brand-soft)",
          softer: "var(--brand-softer)",
        },
        accent: "var(--accent)",
        surface: "var(--surface)",
        panel: "var(--panel)",
        canvas: "var(--bg)",
        text: {
          DEFAULT: "var(--text)",
          soft: "var(--text-soft)",
          faint: "var(--text-faint)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        state: {
          "pending-bg": "var(--state-pending-bg)",
          "pending-fg": "var(--state-pending-fg)",
          "progress-bg": "var(--state-progress-bg)",
          "progress-fg": "var(--state-progress-fg)",
          "blocked-bg": "var(--state-blocked-bg)",
          "blocked-fg": "var(--state-blocked-fg)",
          "done-bg": "var(--state-done-bg)",
          "done-fg": "var(--state-done-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      // Escala de radios del design system §3
      borderRadius: {
        input: "8px",
        button: "9px",
        card: "12px",
        modal: "16px",
        feature: "18px",
        pill: "20px",
      },
      boxShadow: {
        base: "var(--shadow)",
        overlay: "var(--shadow-lg)",
      },
      backgroundImage: {
        "brand-gradient": "var(--brand-gradient)",
        "nav-gradient": "var(--nav-gradient)",
        "stat-gradient": "var(--stat-gradient)",
      },
      // Espaciado base-4. Los gaps más usados de la interfaz (design system §3).
      spacing: {
        "1.5": "6px",
        "3.5": "14px",
        "4.5": "18px",
        "5.5": "22px",
        "6.5": "26px",
      },
    },
  },
  plugins: [],
};

export default config;
