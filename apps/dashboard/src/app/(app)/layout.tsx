import { Suspense } from 'react';
import { NavLink } from './nav-link';
import { UserMenu } from './user-menu';

const navigation = [
  { href: '/', label: 'Overview' },
  { href: '/issues', label: 'Issues', soon: true },
  { href: '/sessions', label: 'Sessions', soon: true },
  { href: '/performance', label: 'Performance', soon: true },
  { href: '/releases', label: 'Releases', soon: true },
  { href: '/settings', label: 'Settings' },
];

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-svh flex-1">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-6 sm:flex dark:border-zinc-800 dark:bg-zinc-950">
        <p className="px-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Mobile Observability
        </p>
        <nav className="mt-6 flex flex-col gap-1">
          {navigation.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Dashboard</p>
          <Suspense fallback={<span className="text-sm text-zinc-400">…</span>}>
            <UserMenu />
          </Suspense>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
