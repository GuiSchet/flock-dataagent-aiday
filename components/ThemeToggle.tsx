"use client";

import * as React from "react";

/**
 * El tema vive en la clase de `<html>`, no en React: lo fija un script inline del layout
 * antes de hidratar, para que no haya destello. Por eso se lee con
 * `useSyncExternalStore` sobre un MutationObserver, en vez de sincronizarlo con un
 * efecto (que además dispararía un render en cascada en cada montaje).
 */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/**
 * El botón de tema. `onBrand` es la variante blanca, para ir sobre la franja de marca
 * (`--brand-gradient`) de la vista inicial y de la barra de conversación.
 */
export function ThemeToggle({ tone = "default" }: { tone?: "default" | "onBrand" }) {
  const dark = React.useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("flock-theme", next ? "dark" : "light");
    } catch {
      // Modo privado o almacenamiento bloqueado: el tema vale para esta sesión nomás.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] transition-colors"
      style={{ color: tone === "onBrand" ? "var(--text-on-brand)" : "var(--text-faint)" }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
