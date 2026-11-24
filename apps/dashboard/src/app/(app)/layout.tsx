import Link from 'next/link';
import { Suspense } from 'react';
import {
  IssuesIcon,
  MarkIcon,
  OverviewIcon,
  PerformanceIcon,
  ReleasesIcon,
  SessionsIcon,
  SettingsIcon,
} from '@/components/icons';
import { NavLink } from './nav-link';
import { UserMenu, WorkspaceName } from './user-menu';

const monitor = [
  { href: '/', label: 'Overview', icon: <OverviewIcon /> },
  { href: '/issues', label: 'Issues', icon: <IssuesIcon />, soon: true },
  { href: '/sessions', label: 'Sessions', icon: <SessionsIcon />, soon: true },
  { href: '/performance', label: 'Performance', icon: <PerformanceIcon />, soon: true },
  { href: '/releases', label: 'Releases', icon: <ReleasesIcon />, soon: true },
];

const manage = [{ href: '/settings', label: 'Settings', icon: <SettingsIcon /> }];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md">
      <MarkIcon className="shrink-0 text-ink" />
      <span className="min-w-0">
        <span className="font-wide block text-sm font-semibold leading-tight tracking-tight">
          Mobile Observability
        </span>
        <Suspense fallback={<span className="block h-4" />}>
          <WorkspaceName />
        </Suspense>
      </span>
    </Link>
  );
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-svh flex-1">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="px-5 pt-5 pb-6">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3">
          {monitor.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
          <hr className="my-3 border-line" />
          {manage.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
        <div className="border-t border-line px-4 py-4">
          <Suspense fallback={<div className="h-8" />}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b border-line bg-panel px-4 pt-4 pb-2 lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Brand />
          </div>
          <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {[...monitor, ...manage].map((item) => (
              <NavLink key={item.href} {...item} compact />
            ))}
          </nav>
        </header>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        <div className="border-t border-line px-4 py-3 lg:hidden">
          <Suspense fallback={<div className="h-8" />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
