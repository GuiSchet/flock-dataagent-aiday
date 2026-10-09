import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flock DataAgent",
  description:
    "Agente de voz que co-diseña visualizaciones de datos con el usuario, sobre el corpus de Flock.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // El tema se fija en `html` porque los tokens viven en `:root` y `html.dark`.
    // El script inline evita el parpadeo blanco antes de hidratar.
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("flock-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;if(t==="dark"||(!t&&d))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
