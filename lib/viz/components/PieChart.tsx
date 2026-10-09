"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { seriesColor, OTHERS_COLOR } from "../palette";
import { formatNumber } from "@/lib/data/format";
import { OTHERS_LABEL } from "@/lib/data/grouping";
import {
  ANIMATION_MS,
  ChartFrame,
  legendProps,
  makeTooltipContent,
  toNumber,
  usePrefersReducedMotion,
} from "./ChartFrame";
import { highlightOpacity, useHighlight } from "./highlight";
import { rowsOf } from "./types";
import type { NumberFormat } from "@/lib/data/types";

interface PieChartProps {
  data: unknown;
  title: string;
  subtitle: string | null;
  labelKey: string;
  valueKey: string;
  format: NumberFormat;
  donut: boolean;
  showPercent: boolean;
  emptyMessage: string;
}

export function PieChart(props: PieChartProps) {
  const rows = rowsOf(props.data);
  const highlight = useHighlight();
  const reduced = usePrefersReducedMotion();

  const total = rows.reduce((acc, r) => acc + (toNumber(r[props.valueKey]) ?? 0), 0);

  return (
    <ChartFrame
      title={props.title}
      subtitle={props.subtitle}
      isEmpty={rows.length === 0}
      emptyMessage={props.emptyMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RPieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={rows}
            dataKey={props.valueKey}
            nameKey={props.labelKey}
            cx="50%"
            cy="50%"
            innerRadius={props.donut ? "52%" : 0}
            outerRadius="78%"
            paddingAngle={props.donut ? 2 : 0}
            stroke="var(--panel)"
            strokeWidth={2}
            isAnimationActive={!reduced}
            animationDuration={ANIMATION_MS}
            label={
              props.showPercent
                ? (entry: { value?: number }) =>
                    total === 0
                      ? ""
                      : `${(((entry.value ?? 0) / total) * 100).toFixed(0)} %`
                : false
            }
            labelLine={false}
          >
            {rows.map((row, index) => (
              <Cell
                key={index}
                // "Otros" va en gris: es un residuo, no una categoría que compite.
                fill={row[props.labelKey] === OTHERS_LABEL ? OTHERS_COLOR : seriesColor(index)}
                fillOpacity={highlightOpacity(highlight, row[props.labelKey])}
                style={{ transition: "fill-opacity .25s ease" }}
              />
            ))}
          </Pie>

          <Tooltip content={makeTooltipContent(props.format)} />
          <Legend {...legendProps} />
        </RPieChart>
      </ResponsiveContainer>

      {props.donut && total > 0 ? (
        // El centro de la dona es espacio muerto: ahí va el total. La leyenda de arriba le
        // quita su alto al área de la torta, así que el centro baja lo mismo.
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          style={{ paddingTop: legendProps.height }}
        >
          <span className="type-label">Total</span>
          <span data-value={total} className="text-mono text-[22px] font-bold" style={{ color: "var(--text)" }}>
            {formatNumber(total, props.format)}
          </span>
        </div>
      ) : null}
    </ChartFrame>
  );
}
