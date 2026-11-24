'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface PulsePoint {
  /** ISO start of the hour (UTC). */
  hour: string;
  errors: number;
  crashes: number;
}

const HEIGHT = 168;
const PAD = { top: 12, right: 4, bottom: 26, left: 36 };
const BAR_MAX = 24;
const GAP = 2;

const hourLabel = (iso: string) => `${iso.slice(11, 13)}:00`;

/** 1, 2, 5 x 10^n at or above the value, so ticks stay round. */
function niceCeil(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

const formatCount = new Intl.NumberFormat('en', { notation: 'compact' });

/** Column with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * Error events per hour over the last 24 hours. Single series, so no legend:
 * the panel title names it. Hover a column for its hour; the table view
 * carries every value for keyboard and screen-reader users.
 */
export function PulseChart({ points }: { points: PulsePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const max = niceCeil(Math.max(0, ...points.map((point) => point.errors)));
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(2, Math.min(BAR_MAX, slot - GAP));
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, max / 2, max];
  const total = points.reduce((sum, point) => sum + point.errors, 0);
  const peak = points.reduce((best, point) => (point.errors > best.errors ? point : best), {
    hour: '',
    errors: 0,
    crashes: 0,
  });

  const activePoint = active === null ? null : points[active];
  const tooltipX =
    active === null
      ? 0
      : Math.min(Math.max(PAD.left + active * slot + slot / 2 - 66, 0), width - 132);

  return (
    <div>
      <div ref={containerRef} className="relative w-full">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          className="block max-w-full overflow-visible"
        >
          <title id={titleId}>
            {total === 0
              ? 'No error events in the last 24 hours.'
              : `${total} error events in the last 24 hours, peaking at ${peak.errors} around ${hourLabel(peak.hour)} UTC.`}
          </title>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'}
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-3 text-[11px] tabular"
              >
                {formatCount.format(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const x = PAD.left + index * slot + (slot - barWidth) / 2;
            const isNow = index === points.length - 1;
            return (
              <g key={point.hour}>
                {point.errors > 0 && (
                  <path
                    d={columnPath(x, y(point.errors), barWidth, y(0) - y(point.errors))}
                    className={
                      active === null || active === index ? 'fill-series' : 'fill-series opacity-45'
                    }
                  />
                )}
                {(index % 6 === 0 || isNow) && (
                  <text
                    x={PAD.left + index * slot + slot / 2}
                    y={HEIGHT - 8}
                    textAnchor={isNow ? 'end' : 'middle'}
                    className="fill-ink-3 text-[11px] tabular"
                  >
                    {isNow ? 'Now' : hourLabel(point.hour)}
                  </text>
                )}
                {/* Hit target: the whole column, larger than the mark. */}
                <rect
                  x={PAD.left + index * slot}
                  y={PAD.top}
                  width={slot}
                  height={plotHeight}
                  className="fill-transparent"
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}

          {activePoint && (
            <g transform={`translate(${tooltipX}, ${PAD.top})`} className="pointer-events-none">
              <rect width="132" height="58" rx="6" className="fill-raised stroke-line-strong" />
              <text x="10" y="18" className="fill-ink-3 text-[11px] tabular">
                {hourLabel(activePoint.hour)} to{' '}
                {String((Number(activePoint.hour.slice(11, 13)) + 1) % 24).padStart(2, '0')}:00 UTC
              </text>
              <text x="10" y="35" className="fill-ink text-[12px] font-semibold tabular">
                {activePoint.errors.toLocaleString('en')} error events
              </text>
              <text x="10" y="50" className="fill-ink-2 text-[11px] tabular">
                {activePoint.crashes.toLocaleString('en')} crashes
              </text>
            </g>
          )}
        </svg>
      </div>

      <details className="group mt-1 text-2xs text-ink-3">
        <summary className="w-fit cursor-pointer rounded hover:text-ink-2">View as table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-md border border-line">
          <table className="w-full text-left text-2xs tabular">
            <thead className="sticky top-0 bg-raised text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Hour (UTC)
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Error events
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Crashes
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.hour} className="border-t border-line text-ink-2">
                  <td className="px-3 py-1">{hourLabel(point.hour)}</td>
                  <td className="px-3 py-1 text-right">{point.errors.toLocaleString('en')}</td>
                  <td className="px-3 py-1 text-right">{point.crashes.toLocaleString('en')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
