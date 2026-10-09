"use client";

import { logout } from "@/app/login/actions";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * La barra de marca, fija arriba en los dos modos.
 *
 * En la portada dice hasta cuándo valen los datos y ofrece hablar, para que el micrófono
 * quede a mano aunque se haya bajado hasta el final del tablero, y salir de la sesión. En la
 * conversación, el único control es volver al tablero, que corta la voz y limpia lo que había
 * en pantalla.
 */
interface AppHeaderProps {
  mode: "home" | "conversation";
  /** `dd/mm/aaaa`. */
  cutoff: string;
  onTalk: () => void;
  onBack: () => void;
  /** Mientras se abre la sesión de voz, el botón de hablar no se puede volver a pulsar. */
  starting: boolean;
}

export function AppHeader({ mode, cutoff, onTalk, onBack, starting }: AppHeaderProps) {
  return (
    <header
      className="sticky top-0 z-20 w-full shrink-0 shadow-base"
      style={{ background: "var(--brand-gradient)", color: "var(--text-on-brand)" }}
    >
      <div className="mx-auto flex h-[60px] w-full max-w-7xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-3">
          {/* El isotipo tiene colores propios de marca: sobre el gradiente va la versión blanca. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/flock-mark-white.svg" alt="" className="h-7 w-auto" />
          <span className="type-card">Flock DataAgent</span>
        </div>

        <div className="flex items-center gap-3">
          {mode === "home" ? (
            <>
              <span className="type-body hidden sm:inline" style={{ opacity: 0.78 }}>
                Datos sintéticos al {cutoff}
              </span>
              <OnBrandButton onClick={onTalk} disabled={starting} label={starting ? "Conectando…" : "Hablar con el agente"}>
                <MicIcon />
              </OnBrandButton>
              <OnBrandButton onClick={() => void logout()} label="Salir">
                <LogoutIcon />
              </OnBrandButton>
            </>
          ) : (
            <OnBrandButton onClick={onBack} label="Volver al tablero">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </OnBrandButton>
          )}
          <ThemeToggle tone="onBrand" />
        </div>
      </div>
    </header>
  );
}

/** Botón "Light (sobre marca)" del design system §5. */
function OnBrandButton({
  onClick,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-button bg-[var(--on-brand-light)] px-3.5 py-[7px] text-[13.5px] font-semibold transition-colors hover:bg-[var(--on-brand-light-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      {children}
      {label}
    </button>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
