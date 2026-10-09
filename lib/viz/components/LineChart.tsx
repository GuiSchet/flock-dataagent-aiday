"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "../palette";
import {
  ANIMATION_MS,
  ChartFrame,
  axisLabelStyle,
  axisProps,
  gridProps,
  legendProps,
  makeTooltipContent,
  tickFormatter,
  topMargin,
  bottomMargin,
  xAxisHeight,
  usePrefersReducedMotion,
  SERIES_STAGGER_MS,
} from "./ChartFrame";
import { useHighlight } from "./highlight";
import { rowsOf, type ChartBaseProps } from "./types";

interface LineChartProps extends Omit<ChartBaseProps, "data"> {
  data: unknown;
  curve: "linear" | "monotone";
  showPoints: boolean;
}

export function LineChart(props: LineChartProps) {
  const rows = rowsOf(props.data);
  const highlight = useHighlight();
  const reduced = usePrefersReducedMotion();
  const format = props.series[0]?.format ?? "integer";

  return (
    <ChartFrame
      title={props.title}
      subtitle={props.subtitle}
      isEmpty={rows.length === 0}
      emptyMessage={props.emptyMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows} margin={{ top: topMargin(props.legend), right: 20, bottom: bottomMargin(props.xLabel), left: 12 }}>
          {props.grid ? <CartesianGrid {...gridProps} /> : null}

          <XAxis
            dataKey={props.xKey}
            {...axisProps}
            interval="preserveStartEnd"
            minTickGap={16}
            angle={rows.length > 8 ? -35 : 0}
            textAnchor={rows.length > 8 ? "end" : "middle"}
            height={rows.length > 8 ? 70 : xAxisHeight(props.xLabel)}
            label={{ value: props.xLabel, position: "insideBottom", offset: -4, style: axisLabelStyle }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={tickFormatter(format)}
            label={{ value: props.yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }}
          />

          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={makeTooltipContent(format)}
          />
          {props.legend ? <Legend {...legendProps} /> : null}

          {/* T061: la categoría que el agente está nombrando, marcada en el eje. */}
          {highlight?.category ? (
            <ReferenceLine x={highlight.category} stroke="var(--brand)" strokeDasharray="4 4" strokeWidth={1.5} />
          ) : null}
          {props.series.map((serie, index) => (
            <Line
              key={serie.key}
              type={props.curve}
              dataKey={serie.key}
              name={serie.label}
              stroke={seriesColor(index)}
              strokeWidth={2.2}
              // Con pocos puntos los marcadores ayudan; con muchos, ensucian.
              dot={props.showPoints ? { r: 3, strokeWidth: 0, fill: seriesColor(index) } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--panel)" }}
              // La línea no se corta si un mes no tiene dato.
              connectNulls
              strokeOpacity={highlight?.series && highlight.series !== serie.key ? 0.25 : 1}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
              animationBegin={index * SERIES_STAGGER_MS}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
