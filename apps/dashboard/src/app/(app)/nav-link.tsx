'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
  href: string;
  label: string;
  soon?: boolean;
}

export function NavLink({ href, label, soon }: NavLinkProps) {
  const pathname = usePathname();

  if (soon) {
    return (
      <span className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        {label}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          soon
        </span>
      </span>
    );
  }

  const current = pathname === href;
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? 'rounded-lg bg-zinc-100 px-2 py-1.5 text-sm font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
          : 'rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900'
      }
    >
      {label}
    </Link>
  );
}
