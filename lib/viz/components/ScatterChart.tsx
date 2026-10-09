"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { SINGLE_SERIES_COLOR } from "../palette";
import { formatNumber } from "@/lib/data/format";
import {
  ANIMATION_MS,
  ChartFrame,
  axisLabelStyle,
  axisProps,
  gridProps,
  tickFormatter,
  toNumber,
  usePrefersReducedMotion,
} from "./ChartFrame";
import { rowsOf } from "./types";
import type { NumberFormat } from "@/lib/data/types";

interface ScatterChartProps {
  data: unknown;
  title: string;
  subtitle: string | null;
  xKey: string;
  xLabel: string;
  yKey: string;
  yLabel: string;
  labelKey: string | null;
  format: NumberFormat;
  grid: boolean;
  emptyMessage: string;
}

export function ScatterChart(props: ScatterChartProps) {
  const rows = rowsOf(props.data);
  const reduced = usePrefersReducedMotion();

  return (
    <ChartFrame
      title={props.title}
      subtitle={props.subtitle}
      isEmpty={rows.length === 0}
      emptyMessage={props.emptyMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 12 }}>
          {props.grid ? <CartesianGrid {...gridProps} vertical /> : null}

          <XAxis
            type="number"
            dataKey={props.xKey}
            {...axisProps}
            tickFormatter={tickFormatter(props.format)}
            label={{ value: props.xLabel, position: "insideBottom", offset: -4, style: axisLabelStyle }}
          />
          <YAxis
            type="number"
            dataKey={props.yKey}
            {...axisProps}
            tickFormatter={tickFormatter(props.format)}
            label={{ value: props.yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }}
          />
          <ZAxis range={[70, 70]} />

          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ScatterTooltip {...props} />} />

          <Scatter
            data={rows}
            fill={SINGLE_SERIES_COLOR}
            fillOpacity={0.75}
            isAnimationActive={!reduced}
            animationDuration={ANIMATION_MS}
          />
        </RScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Tooltip propio: en una dispersión importa saber QUÉ punto es, no solo sus coordenadas. */
function ScatterTooltip({
  active,
  payload,
  xKey,
  xLabel,
  yKey,
  yLabel,
  labelKey,
  format,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
} & Pick<ScatterChartProps, "xKey" | "xLabel" | "yKey" | "yLabel" | "labelKey" | "format">) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div
      className="rounded-input px-3 py-2 shadow-overlay"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      }}
    >
      {labelKey && row[labelKey] ? (
        <p className="type-label mb-1.5" style={{ color: "var(--text-faint)" }}>
          {String(row[labelKey])}
        </p>
      ) : null}
      <p className="text-[12.5px]" style={{ color: "var(--text-soft)" }}>
        {xLabel}:{" "}
        <span className="text-mono font-bold" style={{ color: "var(--text)" }}>
          {formatNumber(toNumber(row[xKey]), format)}
        </span>
      </p>
      <p className="text-[12.5px]" style={{ color: "var(--text-soft)" }}>
        {yLabel}:{" "}
        <span className="text-mono font-bold" style={{ color: "var(--text)" }}>
          {formatNumber(toNumber(row[yKey]), format)}
        </span>
      </p>
    </div>
  );
}
