"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

/** Campo y botón del design system §5: input de 13px con foco de marca, botón primario. */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5">
        <span className="type-label">Clave</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={state.error !== null}
          className="rounded-input border border-line-strong bg-panel px-[11px] py-[9px] text-[13px] text-text focus:border-brand focus:outline focus:outline-2 focus:outline-brand-soft"
        />
      </label>

      {state.error && (
        <p className="type-body" role="alert" style={{ color: "var(--state-blocked-fg)" }}>
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-button px-4 py-[9px] text-[13px] font-semibold disabled:opacity-60"
        style={{ background: "var(--brand)", color: "var(--text-on-brand)" }}
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
