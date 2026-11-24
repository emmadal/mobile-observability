'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavLinkProps {
  href: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  /** Compact horizontal variant for the small-screen header. */
  compact?: boolean;
}

export function NavLink({ href, label, icon, soon, compact }: NavLinkProps) {
  const pathname = usePathname();
  const current = href === '/' ? pathname === '/' : pathname.startsWith(href);

  const base = compact
    ? 'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs'
    : 'relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm';

  if (soon) {
    return (
      <span className={`${base} cursor-default text-ink-3`} title={`${label} is not available yet`}>
        <span className="opacity-60">{icon}</span>
        <span className="flex-1">{label}</span>
        {!compact && <span className="text-2xs text-ink-3/80">Soon</span>}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? `${base} bg-raised font-medium text-ink ${compact ? '' : 'before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:rounded-full before:bg-ink'}`
          : `${base} text-ink-2 hover:bg-raised/60 hover:text-ink`
      }
    >
      <span className={current ? 'text-ink' : 'text-ink-3'}>{icon}</span>
      <span className="flex-1">{label}</span>
    </Link>
  );
}
