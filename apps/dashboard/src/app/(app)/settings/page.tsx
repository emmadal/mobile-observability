import Link from 'next/link';
import { Suspense } from 'react';
import { getOrgContext } from '@/features/projects/access';
import { CreateProjectForm } from '@/features/projects/create-project-form';
import { ProjectCard } from '@/features/projects/project-card';
import { listProjects } from '@/features/projects/service';

interface SettingsPageProps {
  searchParams: Promise<{ cursor?: string | string[] }>;
}

export default function SettingsPage({ searchParams }: SettingsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Projects, keys and SDK configuration.
        </p>
      </div>
      <Suspense fallback={<div className="h-48 rounded-2xl bg-zinc-100 dark:bg-zinc-900" />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SettingsContent({ searchParams }: SettingsPageProps) {
  const [{ cursor }, context] = await Promise.all([searchParams, getOrgContext()]);
  if (!context) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No organization is linked to this account.
      </p>
    );
  }

  const page = await listProjects(
    context.organizationId,
    typeof cursor === 'string' ? cursor : null,
  );
  const canRotate = context.role === 'owner';

  return (
    <>
      <CreateProjectForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Projects</h2>
        {page.projects.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No projects yet. Create one above to get an ingest key.
          </p>
        ) : (
          page.projects.map((project) => (
            <ProjectCard key={project.id} project={project} canRotate={canRotate} />
          ))
        )}

        {(cursor || page.hasMore) && (
          <nav className="flex items-center justify-between text-sm">
            {cursor ? (
              <Link
                href="/settings"
                className="font-medium text-zinc-900 underline dark:text-white"
              >
                ← Newer projects
              </Link>
            ) : (
              <span />
            )}
            {page.hasMore && page.cursor ? (
              <Link
                href={`/settings?cursor=${encodeURIComponent(page.cursor)}`}
                className="font-medium text-zinc-900 underline dark:text-white"
              >
                Older projects →
              </Link>
            ) : null}
          </nav>
        )}
      </section>
    </>
  );
}
