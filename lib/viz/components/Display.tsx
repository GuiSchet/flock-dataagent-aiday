"use client";

import * as React from "react";
import { motion } from "motion/react";
import { formatNumber } from "@/lib/data/format";
import { toNumber } from "./ChartFrame";
import { rowsOf } from "./types";
import type { NumberFormat } from "@/lib/data/types";

/**
 * Componentes de display del catálogo: KPI, tabla, aviso y procedencia.
 * Van juntos porque son chicos y comparten el mismo vocabulario de tokens.
 */

// ---------------------------------------------------------------------------
// KpiTile
// ---------------------------------------------------------------------------

interface KpiTileProps {
  data: unknown;
  label: string;
  valueKey: string;
  format: NumberFormat;
  unit: string | null;
  hero: boolean;
  caption: string | null;
}

export function KpiTile(props: KpiTileProps) {
  const rows = rowsOf(props.data);
  // Un KPI mira la primera fila: el motor devuelve una sola cuando no hay agrupamiento.
  const value = toNumber(rows[0]?.[props.valueKey]);

  return (
    <motion.div
      className={
        props.hero
          ? "stat-card-hero flex min-w-[180px] flex-1 flex-col gap-1.5 rounded-card p-5 shadow-base"
          : "panel flex min-w-[160px] flex-1 flex-col gap-1.5 p-5"
      }
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      layout
    >
      <span
        className="type-label"
        style={props.hero ? { color: "var(--text-on-brand)", opacity: 0.78 } : { color: "var(--text-soft)" }}
      >
        {props.label}
      </span>

      <span className="flex items-baseline gap-1.5">
        <motion.span
          key={value ?? "empty"}
          // El valor crudo, para que el banco de pruebas por voz lo compare con el motor sin
          // tener que interpretar el formato es-AR.
          data-value={value ?? undefined}
          className="text-mono text-[28px] font-bold leading-none"
          style={{ color: props.hero ? "var(--text-on-brand)" : "var(--text)" }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {formatNumber(value, props.format)}
        </motion.span>
        {props.unit ? (
          <span
            className="text-[12.5px] font-medium"
            style={props.hero ? { color: "var(--text-on-brand)", opacity: 0.72 } : { color: "var(--text-soft)" }}
          >
            {props.unit}
          </span>
        ) : null}
      </span>

      {props.caption ? (
        <span
          className="text-[12.5px]"
          style={props.hero ? { color: "var(--text-on-brand)", opacity: 0.72 } : { color: "var(--text-soft)" }}
        >
          {props.caption}
        </span>
      ) : null}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

interface TableColumn {
  key: string;
  label: string;
  align: "left" | "right";
  format: NumberFormat | null;
}

interface DataTableProps {
  data: unknown;
  title: string | null;
  columns: TableColumn[];
  maxRows: number;
  emptyMessage: string;
}

export function DataTable(props: DataTableProps) {
  const rows = rowsOf(props.data).slice(0, props.maxRows);

  return (
    <div className="panel flex w-full flex-col gap-3 overflow-hidden p-0">
      {props.title ? (
        <h3 className="type-card px-5 pt-5" style={{ color: "var(--text)" }}>
          {props.title}
        </h3>
      ) : null}

      {rows.length === 0 ? (
        <p className="type-secondary px-5 py-8 text-center" style={{ color: "var(--text-soft)" }}>
          {props.emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ background: "var(--surface)" }}>
                {props.columns.map((col) => (
                  <th
                    key={col.key}
                    className="type-label px-4 py-2.5"
                    style={{
                      textAlign: col.align,
                      borderBottom: "2px solid var(--border-strong)",
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  {props.columns.map((col) => {
                    const raw = row[col.key];
                    const isNumeric = col.format !== null;
                    return (
                      <td
                        key={col.key}
                        // Los números van en mono con tabular-nums para que las columnas
                        // aliñen; el texto, en la pila sans.
                        className={`px-4 py-2.5 ${isNumeric ? "text-mono font-bold" : ""}`}
                        style={{
                          textAlign: col.align,
                          color: "var(--text)",
                        }}
                      >
                        {isNumeric
                          ? formatNumber(toNumber(raw), col.format!)
                          : String(raw ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

export function Callout({ tone, text }: { tone: "info" | "warning"; text: string }) {
  const isWarning = tone === "warning";
  return (
    <motion.div
      role="note"
      className="flex items-start gap-2.5 rounded-input px-4 py-3 text-[12.5px]"
      style={{
        background: isWarning ? "var(--state-blocked-bg)" : "var(--brand-soft)",
        color: isWarning ? "var(--state-blocked-fg)" : "var(--brand)",
      }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px h-4 w-4 shrink-0"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        {isWarning ? (
          <>
            <path d="M12 8v5" />
            <path d="M12 16h.01" />
          </>
        ) : (
          <>
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </>
        )}
      </svg>
      <span>{text}</span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Si la procedencia se dibuja. En una vista hablada, sí: es el pie del gráfico. En el
 * tablero de la portada todas las tarjetas salen de la misma nómina y la fuente se dice una
 * sola vez al pie; cada spec la declara igual (FR-016), sólo que no se repite en pantalla.
 */
export const ProvenanceVisibleContext = React.createContext(true);

export function Provenance({ text }: { text: string }) {
  const visible = React.useContext(ProvenanceVisibleContext);
  if (!visible) return null;
  return (
    <p
      className="type-secondary flex items-center gap-1.5 px-1"
      style={{ color: "var(--text-faint)" }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden
      >
        <path d="M4 6a8 3 0 1 0 16 0A8 3 0 1 0 4 6" />
        <path d="M4 6v12a8 3 0 0 0 16 0V6" />
      </svg>
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Contenedores
// ---------------------------------------------------------------------------

const GAPS = { sm: "gap-2", md: "gap-3.5", lg: "gap-5.5" } as const;

export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string | null;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-4.5">
      <header className="flex flex-col gap-1">
        <h2 className="type-section" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        {subtitle ? (
          <p className="type-secondary" style={{ color: "var(--text-soft)" }}>
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function Row({
  gap,
  children,
}: {
  gap: "sm" | "md" | "lg";
  children?: React.ReactNode;
}) {
  return <div className={`flex w-full flex-wrap items-stretch ${GAPS[gap]}`}>{children}</div>;
}

export function Grid({
  columns,
  children,
}: {
  columns: 2 | 3 | 4;
  children?: React.ReactNode;
}) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" } as const;
  return <div className={`grid w-full grid-cols-1 gap-3.5 ${cols[columns]}`}>{children}</div>;
}
