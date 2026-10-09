"use client";

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor, OTHERS_COLOR } from "../palette";
import { formatNumber } from "@/lib/data/format";
import { OTHERS_LABEL } from "@/lib/data/grouping";
import {
  ANIMATION_MS,
  ChartFrame,
  axisLabelStyle,
  axisProps,
  gridProps,
  legendProps,
  makeTooltipContent,
  tickFormatter,
  toNumber,
  topMargin,
  bottomMargin,
  xAxisHeight,
  usePrefersReducedMotion,
  SERIES_STAGGER_MS,
} from "./ChartFrame";
import { highlightOpacity, useHighlight } from "./highlight";
import { rowsOf, type ChartBaseProps } from "./types";

interface BarChartProps extends Omit<ChartBaseProps, "data"> {
  data: unknown;
  layout: "vertical" | "horizontal";
  stacked: boolean;
  showValues: boolean;
}

export function BarChart(props: BarChartProps) {
  const rows = rowsOf(props.data);
  const reduced = usePrefersReducedMotion();
  const highlight = useHighlight();
  const horizontal = props.layout === "horizontal";
  const format = props.series[0]?.format ?? "integer";
  // En barras horizontales las categorías van a la izquierda: el eje se ensancha hasta la
  // etiqueta más larga (con tope), para que "Desarrollo profesional" no quede cortado.
  const longest = rows.reduce((max, row) => Math.max(max, String(row[props.xKey] ?? "").length), 0);
  const categoryWidth = Math.min(220, Math.max(72, Math.round(longest * 6.8) + 16));

  return (
    <ChartFrame
      title={props.title}
      subtitle={props.subtitle}
      isEmpty={rows.length === 0}
      emptyMessage={props.emptyMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={rows}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{
            top: topMargin(props.legend),
            right: 16,
            bottom: bottomMargin(horizontal ? props.yLabel : props.xLabel),
            left: horizontal ? 8 : 12,
          }}
          barGap={4}
        >
          {props.grid ? <CartesianGrid {...gridProps} vertical={horizontal} horizontal={!horizontal} /> : null}

          {horizontal ? (
            <>
              <XAxis
                type="number"
                {...axisProps}
                tickFormatter={tickFormatter(format)}
                label={{ value: props.yLabel, position: "insideBottom", offset: -16, style: axisLabelStyle }}
              />
              <YAxis
                type="category"
                dataKey={props.xKey}
                width={categoryWidth}
                // interval={0} para que se vean TODAS las categorías: por defecto
                // Recharts saltea etiquetas y el gráfico queda con barras anónimas.
                interval={0}
                {...axisProps}
                label={{ value: props.xLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={props.xKey}
                {...axisProps}
                interval={0}
                angle={rows.length > 6 ? -35 : 0}
                textAnchor={rows.length > 6 ? "end" : "middle"}
                height={rows.length > 6 ? 70 : xAxisHeight(props.xLabel)}
                label={{ value: props.xLabel, position: "insideBottom", offset: -4, style: axisLabelStyle }}
              />
              <YAxis
                {...axisProps}
                tickFormatter={tickFormatter(format)}
                label={{ value: props.yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }}
              />
            </>
          )}

          <Tooltip
            cursor={{ fill: "var(--brand-soft)", opacity: 0.45 }}
            content={makeTooltipContent(format)}
          />
          {props.legend ? <Legend {...legendProps} /> : null}

          {props.series.map((serie, index) => (
            <Bar
              key={serie.key}
              dataKey={serie.key}
              name={serie.label}
              stackId={props.stacked ? "stack" : undefined}
              fill={serie.label === OTHERS_LABEL ? OTHERS_COLOR : seriesColor(index)}
              radius={props.stacked ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
              animationBegin={index * SERIES_STAGGER_MS}
            >
              {/* T061: la categoría que el agente está nombrando queda entera; el resto,
                  atenuado. Con una sola serie, la barra "Otros" va en gris: es un residuo, no
                  una categoría que compite. Sin nada de eso no hay celdas y la barra usa su
                  color de serie. */}
              {highlight || (props.series.length === 1 && rows.some((row) => row[props.xKey] === OTHERS_LABEL))
                ? rows.map((row, i) => (
                    <Cell
                      key={i}
                      fill={
                        serie.label === OTHERS_LABEL ||
                        (props.series.length === 1 && row[props.xKey] === OTHERS_LABEL)
                          ? OTHERS_COLOR
                          : seriesColor(index)
                      }
                      fillOpacity={highlight ? highlightOpacity(highlight, row[props.xKey], serie.key) : 1}
                      style={{ transition: "fill-opacity .25s ease" }}
                    />
                  ))
                : null}
              {props.showValues && props.series.length === 1 ? (
                <LabelList
                  dataKey={serie.key}
                  position={horizontal ? "right" : "top"}
                  formatter={(value: unknown) => formatNumber(toNumber(value), serie.format)}
                  style={{
                    fill: "var(--text-soft)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                  }}
                />
              ) : null}
            </Bar>
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
