'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatAxisDuration, formatDuration } from '@/features/overview/format';
import type { HistogramBucket, StartupSeriesPoint } from './service';

const HOUR_MS = 3_600_000;
const integer = new Intl.NumberFormat('en');

interface TimeAxis {
  bucketSeconds: number;
  spanMs: number;
}

const formatters = {
  time: new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }),
  day: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  dayTime: new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }),
};

function tickLabel(iso: string, axis: TimeAxis): string {
  const date = new Date(iso);
  if (axis.bucketSeconds >= 86_400) return formatters.day.format(date);
  if (axis.spanMs <= 36 * HOUR_MS) return formatters.time.format(date);
  return formatters.dayTime.format(date);
}

function bucketLabel(iso: string, axis: TimeAxis): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + axis.bucketSeconds * 1000);
  if (axis.bucketSeconds >= 86_400) return `${formatters.day.format(start)} (UTC)`;
  return `${formatters.dayTime.format(start)} to ${formatters.time.format(end)} UTC`;
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-line text-xs text-ink-3">
      {children}
    </div>
  );
}

function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <details className="mt-2 text-2xs text-ink-3">
      <summary className="w-fit cursor-pointer rounded hover:text-ink-2">View as table</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-md border border-line">
        <table className="w-full text-left text-2xs tabular">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-raised text-ink-2">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`px-3 py-1.5 font-medium ${index > 0 ? 'text-right' : ''}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line text-ink-2">
                {row.cells.map((cell, index) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional columns
                    key={index}
                    className={`px-3 py-1 ${index > 0 ? 'text-right' : ''}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const config = {
  p50: { label: 'p50', color: 'var(--chart-1)' },
  p90: { label: 'p90', color: 'var(--chart-2)' },
  p99: { label: 'p99', color: 'var(--chart-3)' },
} satisfies ChartConfig;

/** P50/P90/P99 for one startup metric over the selected window. */
export function StartupSeriesChart({
  series,
  metricLabel,
  axis,
}: {
  series: StartupSeriesPoint[];
  metricLabel: string;
  axis: TimeAxis;
}) {
  const samples = series.reduce((total, point) => total + point.samples, 0);
  return (
    <div>
      {samples === 0 ? (
        <ChartEmpty>No {metricLabel.toLowerCase()} samples in this range.</ChartEmpty>
      ) : (
        <ChartContainer
          config={config}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label={`${metricLabel} p50, p90 and p99 per time bucket.`}
        >
          <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="start"
              {...axisProps}
              minTickGap={28}
              tickFormatter={(value: string) => tickLabel(value, axis)}
            />
            <YAxis
              {...axisProps}
              width={56}
              tickFormatter={(value: number) => formatAxisDuration(value)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) =>
                    bucketLabel(String(payload[0]?.payload?.start), axis)
                  }
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {formatDuration(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="p50"
              type="monotone"
              stroke="var(--color-p50)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              dataKey="p90"
              type="monotone"
              stroke="var(--color-p90)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              dataKey="p99"
              type="monotone"
              stroke="var(--color-p99)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      <ChartTable
        caption={`${metricLabel} percentiles per time bucket`}
        columns={['Time (UTC)', 'Samples', 'p50', 'p90', 'p99']}
        rows={series
          .filter((point) => point.samples > 0)
          .map((point) => ({
            key: point.start,
            cells: [
              bucketLabel(point.start, axis),
              integer.format(point.samples),
              point.p50 === null ? 'No data' : formatDuration(point.p50),
              point.p90 === null ? 'No data' : formatDuration(point.p90),
              point.p99 === null ? 'No data' : formatDuration(point.p99),
            ],
          }))}
      />
    </div>
  );
}

/** Distribution of one startup metric over ten equal-width buckets. */
export function StartupHistogram({
  histogram,
  metricLabel,
}: {
  histogram: HistogramBucket[];
  metricLabel: string;
}) {
  const total = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
  const data = histogram.map((bucket) => ({
    label: `${bucket.lowerMs}–${bucket.upperMs}`,
    short: formatAxisDuration(bucket.lowerMs),
    count: bucket.count,
  }));
  return (
    <div>
      {total === 0 ? (
        <ChartEmpty>No {metricLabel.toLowerCase()} samples in this range.</ChartEmpty>
      ) : (
        <ChartContainer
          config={{ count: { label: 'Samples', color: 'var(--chart-1)' } }}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label={`Distribution of ${metricLabel} across ${histogram.length} buckets.`}
        >
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="short"
              {...axisProps}
              minTickGap={8}
              tickFormatter={(value: string) => value}
            />
            <YAxis {...axisProps} width={36} allowDecimals={false} />
            <ChartTooltip
              cursor={{ fillOpacity: 0.35 }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) => {
                    const point = payload[0]?.payload as { label?: string } | undefined;
                    return point?.label ? `${point.label} ms` : '';
                  }}
                />
              }
            />
            <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ChartContainer>
      )}
      <ChartTable
        caption={`${metricLabel} distribution`}
        columns={['Range (ms)', 'Samples']}
        rows={histogram.map((bucket) => ({
          key: `${bucket.lowerMs}-${bucket.upperMs}`,
          cells: [
            `${integer.format(bucket.lowerMs)}–${integer.format(bucket.upperMs)}`,
            integer.format(bucket.count),
          ],
        }))}
      />
    </div>
  );
}
