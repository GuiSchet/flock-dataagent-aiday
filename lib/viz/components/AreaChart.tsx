"use client";

import {
  Area,
  AreaChart as RAreaChart,
  CartesianGrid,
  Legend,
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

interface AreaChartProps extends Omit<ChartBaseProps, "data"> {
  data: unknown;
  curve: "linear" | "monotone";
  stacked: boolean;
}

export function AreaChart(props: AreaChartProps) {
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
        <RAreaChart data={rows} margin={{ top: topMargin(props.legend), right: 20, bottom: bottomMargin(props.xLabel), left: 12 }}>
          <defs>
            {/* Degradé vertical por serie: el área se desvanece hacia abajo para que la
                grilla siga leyéndose debajo. El color sale del token, la opacidad no es
                un color nuevo. */}
            {props.series.map((serie, index) => (
              <linearGradient key={serie.key} id={`area-${serie.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(index)} stopOpacity={0.38} />
                <stop offset="100%" stopColor={seriesColor(index)} stopOpacity={0.04} />
              </linearGradient>
            ))}
          </defs>

          {props.grid ? <CartesianGrid {...gridProps} /> : null}

          <XAxis
            dataKey={props.xKey}
            {...axisProps}
            interval="preserveStartEnd"
            minTickGap={16}
            height={xAxisHeight(props.xLabel)}
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
            <Area
              key={serie.key}
              type={props.curve}
              dataKey={serie.key}
              name={serie.label}
              stackId={props.stacked ? "stack" : undefined}
              stroke={seriesColor(index)}
              strokeWidth={2}
              fill={`url(#area-${serie.key})`}
              connectNulls
              strokeOpacity={highlight?.series && highlight.series !== serie.key ? 0.25 : 1}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
              animationBegin={index * SERIES_STAGGER_MS}
            />
          ))}
        </RAreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
