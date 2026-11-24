'use client';

import { CalendarRangeIcon, CheckIcon, ChevronDownIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useIsClient } from '@/hooks/use-is-client';
import { cn } from '@/lib/utils';
import {
  DEFAULT_RANGE,
  formatDay,
  hasDimensionFilters,
  MAX_CUSTOM_RANGE_DAYS,
  PLATFORMS,
  type PlatformKey,
  parseDay,
  QUICK_RANGES,
  type QuickRangeKey,
  type RangeSelection,
  REFRESH_INTERVALS,
  type RefreshKey,
  rangeLabel,
} from './filters';
import { useOverviewNavigation } from './overview-frame';
import type { FilterOptions } from './service';

const DAY_MS = 86_400_000;

const timeLabel = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/**
 * The filter row above the Overview: time range first, then the dimension
 * filters, then the refresh controls. Everything below re-renders against the
 * same selection.
 */
export function OverviewToolbar({ options, asOf }: { options: FilterOptions; asOf: string }) {
  const { filters, update } = useOverviewNavigation();
  const isDefault =
    !hasDimensionFilters(filters) &&
    filters.range.kind === 'quick' &&
    filters.range.key === DEFAULT_RANGE;

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-8"
    >
      <TimeRangePicker />
      <Separator orientation="vertical" className="mx-1 h-5 max-sm:hidden" />
      <FilterSelect
        label="Project"
        value={filters.project}
        allLabel="All projects"
        items={options.projects.map((project) => ({ value: project.id, label: project.name }))}
        onChange={(project) => update({ project })}
      />
      <FilterSelect
        label="Platform"
        value={filters.platform}
        allLabel="All platforms"
        items={PLATFORMS.map((platform) => ({ value: platform.key, label: platform.label }))}
        onChange={(platform) => update({ platform: platform as PlatformKey | null })}
      />
      <FilterSelect
        label="Environment"
        value={filters.environment}
        allLabel="All environments"
        items={withCurrent(options.environments, filters.environment)}
        onChange={(environment) => update({ environment })}
      />
      <FilterSelect
        label="App version"
        value={filters.version}
        allLabel="All versions"
        items={withCurrent(options.versions, filters.version)}
        onChange={(version) => update({ version })}
      />
      {!isDefault && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update({
              range: { kind: 'quick', key: DEFAULT_RANGE },
              project: null,
              platform: null,
              environment: null,
              version: null,
            })
          }
        >
          <XIcon data-icon="inline-start" />
          Reset
        </Button>
      )}

      <div className="flex items-center gap-2 sm:ml-auto">
        <p className="text-2xs text-ink-3 tabular">
          Updated <time dateTime={asOf}>{timeLabel.format(new Date(asOf))}</time> UTC
        </p>
        <RefreshControl />
      </div>
    </div>
  );
}

/** Keeps a value from the URL selectable even when it fell out of the recent list. */
function withCurrent(values: string[], current: string | null) {
  const all = current && !values.includes(current) ? [current, ...values] : values;
  return all.map((value) => ({ value, label: value }));
}

function FilterSelect({
  label,
  value,
  allLabel,
  items,
  onChange,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  items: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <ToolbarSelect
      label={label}
      value={value}
      items={[{ value: null, label: allLabel }, ...items]}
      onChange={onChange}
      className="min-w-32 max-w-56"
    />
  );
}

/**
 * A Base UI select that only mounts in the browser. Its hidden form input
 * carries an inline style attribute, which the CSP blocks in server HTML; the
 * server renders a look-alike trigger instead, so nothing shifts on hydration.
 */
function ToolbarSelect<Value extends string | null>({
  label,
  value,
  items,
  onChange,
  align = 'start',
  className,
}: {
  label: string;
  value: Value;
  items: { value: Value; label: string }[];
  onChange: (value: Value) => void;
  align?: 'start' | 'end';
  className?: string;
}) {
  const isClient = useIsClient();
  const current = items.find((item) => item.value === value)?.label ?? items[0]?.label;

  if (!isClient) {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={label}
        className={cn('justify-between font-normal', className)}
      >
        <span className="truncate">{current}</span>
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </Button>
    );
  }

  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next as Value)}>
      <SelectTrigger size="sm" aria-label={label} className={cn('text-[0.8rem]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align={align}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value ?? 'all'} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Presets as rows (the common case), a two-month calendar for a custom range
 * of UTC days. Days after today or past the 90-day reach are disabled.
 */
function TimeRangePicker() {
  const { filters, update } = useOverviewNavigation();
  const [open, setOpen] = useState(false);
  const current = filters.range;
  const [draft, setDraft] = useState<DateRange | undefined>(() => toDateRange(current));

  const today = parseDay(formatDay(new Date())) as Date;
  const earliest = new Date(today.getTime() - MAX_CUSTOM_RANGE_DAYS * DAY_MS);

  const choose = (key: QuickRangeKey) => {
    setOpen(false);
    update({ range: { kind: 'quick', key } });
  };

  const apply = () => {
    if (!draft?.from) return;
    const to = draft.to ?? draft.from;
    setOpen(false);
    update({ range: { kind: 'custom', fromDay: formatDay(draft.from), toDay: formatDay(to) } });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(toDateRange(current));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`Time range: ${rangeLabel(current)}`} />
        }
      >
        <CalendarRangeIcon data-icon="inline-start" />
        {rangeLabel(current)}
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0">
        <div className="flex max-md:flex-col">
          <div className="flex flex-col p-1.5 md:w-48 md:border-r md:border-line">
            <p className="px-2 pt-1.5 pb-1 text-2xs font-medium text-ink-3">Quick ranges</p>
            <ul aria-label="Quick ranges" className="grid grid-cols-2 md:grid-cols-1">
              {QUICK_RANGES.map((range) => {
                const selected = current.kind === 'quick' && current.key === range.key;
                return (
                  <li key={range.key}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => choose(range.key)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-accent/60 hover:text-ink',
                        selected && 'font-semibold text-ink',
                      )}
                    >
                      {range.label}
                      {selected && <CheckIcon className="size-4" strokeWidth={3} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col max-md:border-t max-md:border-line">
            <p className="px-3 pt-3 text-2xs font-medium text-ink-3">Custom range (UTC days)</p>
            <Calendar
              mode="range"
              timeZone="UTC"
              numberOfMonths={2}
              defaultMonth={draft?.from ?? new Date(today.getTime() - 31 * DAY_MS)}
              selected={draft}
              onSelect={setDraft}
              disabled={{ before: earliest, after: today }}
              startMonth={earliest}
              endMonth={today}
              className="bg-transparent"
            />
            <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
              <p className="text-2xs text-ink-3 tabular">
                {draft?.from
                  ? rangeLabel({
                      kind: 'custom',
                      fromDay: formatDay(draft.from),
                      toDay: formatDay(draft.to ?? draft.from),
                    })
                  : 'Pick a start and an end day'}
              </p>
              <Button size="sm" disabled={!draft?.from} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toDateRange(range: RangeSelection): DateRange | undefined {
  if (range.kind === 'quick') return undefined;
  return {
    from: parseDay(range.fromDay) ?? undefined,
    to: parseDay(range.toDay) ?? undefined,
  };
}

const refreshItems = REFRESH_INTERVALS.map((interval) => ({
  value: interval.key as RefreshKey,
  label: interval.key === 'off' ? 'Auto-refresh off' : `Every ${interval.label}`,
}));

/** Refresh now, plus the auto-refresh interval (kept in the URL). */
function RefreshControl() {
  const { filters, update, refresh, isPending } = useOverviewNavigation();
  return (
    <div className="flex items-center">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Refresh now"
        onClick={refresh}
        disabled={isPending}
        className="rounded-r-none border-r-0"
      >
        <RefreshCwIcon className={cn(isPending && 'motion-safe:animate-spin')} />
      </Button>
      <ToolbarSelect
        label="Auto-refresh interval"
        value={filters.refresh}
        items={refreshItems}
        onChange={(refresh: RefreshKey) => update({ refresh })}
        align="end"
        className="rounded-l-none"
      />
    </div>
  );
}
