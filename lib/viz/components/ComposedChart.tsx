"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart as RComposedChart,
  Legend,
  Line,
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
import { rowsOf, type ChartBaseProps } from "./types";

interface ComposedChartProps extends Omit<ChartBaseProps, "data"> {
  data: unknown;
  barSeries: string[];
  lineSeries: string[];
  rightAxis: boolean;
}

export function ComposedChart(props: ComposedChartProps) {
  const rows = rowsOf(props.data);
  const reduced = usePrefersReducedMotion();

  const bars = props.series.filter((s) => props.barSeries.includes(s.key));
  const lines = props.series.filter((s) => props.lineSeries.includes(s.key));
  const format = bars[0]?.format ?? props.series[0]?.format ?? "integer";
  const rightFormat = lines[0]?.format ?? format;

  return (
    <ChartFrame
      title={props.title}
      subtitle={props.subtitle}
      isEmpty={rows.length === 0}
      emptyMessage={props.emptyMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RComposedChart data={rows} margin={{ top: topMargin(props.legend), right: 20, bottom: bottomMargin(props.xLabel), left: 12 }}>
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
            yAxisId="left"
            {...axisProps}
            tickFormatter={tickFormatter(format)}
            label={{ value: props.yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }}
          />
          {props.rightAxis ? (
            // Eje propio para la línea: sin esto, una tasa de 0 a 100 convive con un
            // volumen de miles y la línea queda pegada al piso.
            <YAxis
              yAxisId="right"
              orientation="right"
              {...axisProps}
              tickFormatter={tickFormatter(rightFormat)}
            />
          ) : null}

          <Tooltip
            cursor={{ fill: "var(--brand-soft)", opacity: 0.4 }}
            content={makeTooltipContent(format)}
          />
          {props.legend ? <Legend {...legendProps} /> : null}

          {bars.map((serie, index) => (
            <Bar
              key={serie.key}
              yAxisId="left"
              dataKey={serie.key}
              name={serie.label}
              fill={seriesColor(index)}
              radius={[6, 6, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
              animationBegin={index * SERIES_STAGGER_MS}
            />
          ))}

          {lines.map((serie, index) => (
            <Line
              key={serie.key}
              yAxisId={props.rightAxis ? "right" : "left"}
              type="monotone"
              dataKey={serie.key}
              name={serie.label}
              stroke={seriesColor(bars.length + index)}
              strokeWidth={2.4}
              dot={{ r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--panel)" }}
              connectNulls
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
              animationBegin={(bars.length + index) * SERIES_STAGGER_MS}
            />
          ))}
        </RComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
