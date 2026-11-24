'use client';

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatAxisDuration, formatDuration } from './format';
import type { TimelineBucket } from './service';

const HOUR_MS = 3_600_000;

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

const integer = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Axis tick: clock time within a day and a half, the day for daily buckets. */
function tickLabel(iso: string, axis: TimeAxis): string {
  const date = new Date(iso);
  if (axis.bucketSeconds >= 86_400) return formatters.day.format(date);
  if (axis.spanMs <= 36 * HOUR_MS) return formatters.time.format(date);
  return formatters.dayTime.format(date);
}

/** Tooltip and table label: the whole bucket, in UTC. */
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

function TimeXAxis({ axis }: { axis: TimeAxis }) {
  return (
    <XAxis
      dataKey="start"
      {...axisProps}
      minTickGap={28}
      tickFormatter={(value: string) => tickLabel(value, axis)}
    />
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-line text-xs text-ink-3">
      {children}
    </div>
  );
}

/**
 * Every value a chart shows stays reachable without hovering: a collapsible
 * table for keyboard and screen-reader users.
 */
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

const errorConfig = {
  nonFatal: { label: 'Non-fatal errors', color: 'var(--chart-1)' },
  crashes: { label: 'Crashes', color: 'var(--chart-2)' },
} satisfies ChartConfig;

/** Error events per bucket, crashes stacked on non-fatal errors. */
export function ErrorsChart({ timeline, axis }: { timeline: TimelineBucket[]; axis: TimeAxis }) {
  const data = timeline.map((bucket) => ({
    start: bucket.start,
    nonFatal: bucket.errors - bucket.crashes,
    crashes: bucket.crashes,
  }));
  const total = timeline.reduce((sum, bucket) => sum + bucket.errors, 0);

  return (
    <div>
      {total === 0 ? (
        <ChartEmpty>No error events in this range.</ChartEmpty>
      ) : (
        <ChartContainer
          config={errorConfig}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label={`${integer.format(total)} error events in the selected range.`}
        >
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <TimeXAxis axis={axis} />
            <YAxis
              {...axisProps}
              width={36}
              allowDecimals={false}
              tickFormatter={(value: number) => compact.format(value)}
            />
            <ChartTooltip
              cursor={{ fillOpacity: 0.35 }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) =>
                    bucketLabel(String(payload[0]?.payload?.start), axis)
                  }
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="nonFatal" stackId="errors" fill="var(--color-nonFatal)" maxBarSize={24} />
            <Bar
              dataKey="crashes"
              stackId="errors"
              fill="var(--color-crashes)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartContainer>
      )}
      <ChartTable
        caption="Error events per time bucket"
        columns={['Time (UTC)', 'Error events', 'Crashes']}
        rows={timeline.map((bucket) => ({
          key: bucket.start,
          cells: [
            bucketLabel(bucket.start, axis),
            integer.format(bucket.errors),
            integer.format(bucket.crashes),
          ],
        }))}
      />
    </div>
  );
}

const sessionConfig = {
  healthy: { label: 'Without a crash', color: 'var(--chart-1)' },
  crashed: { label: 'Crashed', color: 'var(--chart-2)' },
} satisfies ChartConfig;

/** Sessions started per bucket, crashed sessions stacked on the rest. */
export function SessionsChart({ timeline, axis }: { timeline: TimelineBucket[]; axis: TimeAxis }) {
  const data = timeline.map((bucket) => ({
    start: bucket.start,
    healthy: bucket.sessions - bucket.crashedSessions,
    crashed: bucket.crashedSessions,
  }));
  const total = timeline.reduce((sum, bucket) => sum + bucket.sessions, 0);

  return (
    <div>
      {total === 0 ? (
        <ChartEmpty>No sessions started in this range.</ChartEmpty>
      ) : (
        <ChartContainer
          config={sessionConfig}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label={`${integer.format(total)} sessions started in the selected range.`}
        >
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <TimeXAxis axis={axis} />
            <YAxis
              {...axisProps}
              width={36}
              allowDecimals={false}
              tickFormatter={(value: number) => compact.format(value)}
            />
            <ChartTooltip
              cursor={{ fillOpacity: 0.35 }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) =>
                    bucketLabel(String(payload[0]?.payload?.start), axis)
                  }
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="healthy" stackId="sessions" fill="var(--color-healthy)" maxBarSize={24} />
            <Bar
              dataKey="crashed"
              stackId="sessions"
              fill="var(--color-crashed)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartContainer>
      )}
      <ChartTable
        caption="Sessions per time bucket"
        columns={['Time (UTC)', 'Sessions', 'Crashed']}
        rows={timeline.map((bucket) => ({
          key: bucket.start,
          cells: [
            bucketLabel(bucket.start, axis),
            integer.format(bucket.sessions),
            integer.format(bucket.crashedSessions),
          ],
        }))}
      />
    </div>
  );
}

const launchConfig = {
  p75: { label: 'Cold launch p75', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/** p75 cold launch per bucket against the protocol target. Gaps mean no samples. */
export function LaunchChart({
  timeline,
  axis,
  targetMs,
}: {
  timeline: TimelineBucket[];
  axis: TimeAxis;
  targetMs: number;
}) {
  const data = timeline.map((bucket) => ({ start: bucket.start, p75: bucket.coldLaunchP75 }));
  const values = data.flatMap((point) => (point.p75 === null ? [] : [point.p75]));
  // An isolated sample has no neighbour to draw a segment to: give it a dot.
  const isolated = (index: number) =>
    data[index]?.p75 !== null && !data[index - 1]?.p75 && !data[index + 1]?.p75;

  return (
    <div>
      {values.length === 0 ? (
        <ChartEmpty>No cold launch samples in this range.</ChartEmpty>
      ) : (
        <ChartContainer
          config={launchConfig}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label={`Cold launch p75 per time bucket; target ${formatDuration(targetMs)}.`}
        >
          <LineChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <TimeXAxis axis={axis} />
            <YAxis
              {...axisProps}
              width={56}
              domain={[0, Math.ceil(Math.max(targetMs * 1.15, ...values) / 500) * 500]}
              tickFormatter={(value: number) => formatAxisDuration(value)}
            />
            <ReferenceLine
              y={targetMs}
              stroke="var(--color-ink-3)"
              strokeDasharray="4 4"
              label={{
                value: `Target ${formatDuration(targetMs)}`,
                position: 'insideTopRight',
                fill: 'var(--color-ink-3)',
                fontSize: 11,
              }}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) =>
                    bucketLabel(String(payload[0]?.payload?.start), axis)
                  }
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">Cold launch p75</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {formatDuration(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Line
              dataKey="p75"
              type="monotone"
              stroke="var(--color-p75)"
              strokeWidth={2}
              connectNulls={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index !== undefined && isolated(props.index) ? (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill="var(--color-p75)"
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                ) : (
                  <g key={props.index} />
                )
              }
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-panel)' }}
            />
          </LineChart>
        </ChartContainer>
      )}
      <ChartTable
        caption="Cold launch p75 per time bucket"
        columns={['Time (UTC)', 'p75', 'Samples']}
        rows={timeline
          .filter((bucket) => bucket.coldLaunchSamples > 0)
          .map((bucket) => ({
            key: bucket.start,
            cells: [
              bucketLabel(bucket.start, axis),
              bucket.coldLaunchP75 === null ? 'No data' : formatDuration(bucket.coldLaunchP75),
              integer.format(bucket.coldLaunchSamples),
            ],
          }))}
      />
    </div>
  );
}
