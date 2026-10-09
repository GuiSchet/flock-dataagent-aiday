import type { Metadata } from "next";
import { safeNext } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Entrar · Flock DataAgent",
};

/**
 * La única pantalla que se ve sin sesión. `proxy.ts` manda acá cualquier otra página, con la
 * ruta original en `next` para volver después de entrar.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="panel flex w-full max-w-[470px] flex-col gap-6 p-7">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/flock-mark.svg" alt="" className="h-9 w-auto" />
          <div>
            <h1 className="type-section">Flock DataAgent</h1>
            <p className="type-secondary">Una nómina sintética que se explora hablando</p>
          </div>
        </div>
        <p className="type-body" style={{ color: "var(--text-soft)" }}>
          Ingresá la clave que te pasaron para entrar.
        </p>
        <LoginForm next={safeNext(next)} />
      </div>
    </main>
  );
}
