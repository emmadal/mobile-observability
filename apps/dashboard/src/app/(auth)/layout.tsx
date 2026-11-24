import type { ReactNode } from 'react';
import { MarkIcon } from '@/components/icons';

/**
 * A session trace: steady frames, a few breadcrumbs, then the crash the
 * dashboard exists to catch. Decorative; it draws once on load.
 */
function SessionTrace() {
  return (
    <svg
      viewBox="0 0 560 160"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="w-full max-w-[560px]"
    >
      {[40, 80, 120].map((y) => (
        <line key={y} x1="0" x2="560" y1={y} y2={y} className="stroke-line" strokeWidth="1" />
      ))}
      {[70, 150, 228, 300, 352].map((x) => (
        <circle key={x} cx={x} cy="120" r="3" className="fill-ink-3" />
      ))}
      <path
        pathLength="1"
        className="motion-safe:animate-trace stroke-series"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M0 96 H60 L72 88 L84 98 H140 L152 84 L164 100 H220 L232 90 L244 98 H292 L304 86 L316 98 H372 L388 60 L404 118 L420 30 L436 104 L448 96 H476"
      />
      <g className="motion-safe:animate-marker">
        <circle cx="476" cy="96" r="9" className="fill-critical/20" />
        <circle cx="476" cy="96" r="4.5" className="fill-critical" />
      </g>
    </svg>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line px-12 py-12 lg:flex">
        <div className="flex items-center gap-3">
          <MarkIcon className="text-ink" />
          <span className="font-wide text-sm font-semibold tracking-tight">
            Mobile Observability
          </span>
        </div>
        <div className="flex flex-col gap-10">
          <div className="max-w-[30rem]">
            <h2 className="font-wide text-[2.5rem] leading-[1.05] font-semibold tracking-tight text-ink">
              Every crash, traced back to the session that caused it.
            </h2>
            <p className="mt-4 max-w-[26rem] text-base text-ink-2">
              Errors, crashes, launch times and network requests from your React Native and Expo
              apps, on a dashboard you host yourself.
            </p>
          </div>
          <SessionTrace />
        </div>
        <p className="text-2xs text-ink-3">Self-hosted. Your telemetry stays in your database.</p>
      </section>

      <section className="flex flex-col justify-center bg-panel px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <MarkIcon className="text-ink" />
            <span className="font-wide text-sm font-semibold tracking-tight">
              Mobile Observability
            </span>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
