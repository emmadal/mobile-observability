import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { getOrgContext } from '@/features/projects/access';
import { CreateProjectForm } from '@/features/projects/create-project-form';
import { ProjectCard } from '@/features/projects/project-card';
import { listProjects } from '@/features/projects/service';
import { TeamPanel } from '@/features/team/team-panel';
import { getRequestOrigin } from '@/lib/request-origin';

export const metadata = { title: 'Settings' };

interface SettingsPageProps {
  searchParams: Promise<{ cursor?: string | string[] }>;
}

export default function SettingsPage({ searchParams }: SettingsPageProps) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Projects, SDK keys and the people who can see this workspace."
        aside={
          <nav aria-label="Settings sections" className="flex gap-4 text-xs">
            <a href="#projects" className="rounded text-ink-2 hover:text-ink">
              Projects
            </a>
            <a href="#team" className="rounded text-ink-2 hover:text-ink">
              People
            </a>
          </nav>
        }
      />
      <Suspense
        fallback={
          <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
            <div className="h-72 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
            <div className="h-56 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
          </div>
        }
      >
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SettingsContent({ searchParams }: SettingsPageProps) {
  const [{ cursor }, context, origin] = await Promise.all([
    searchParams,
    getOrgContext(),
    getRequestOrigin(),
  ]);
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const page = await listProjects(
    context.organizationId,
    typeof cursor === 'string' ? cursor : null,
  );
  const isOwner = context.role === 'owner';

  return (
    <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <Panel
        id="projects"
        title="Projects"
        description="Each app has its own project, keys, issues and metrics."
        className="scroll-mt-6"
      >
        <div className="mt-4 border-t border-line">
          {isOwner && <CreateProjectForm />}

          {page.projects.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-2">
              {isOwner
                ? 'No projects yet. Name your first app above to get its keys.'
                : 'No projects yet. The workspace owner creates them.'}
            </p>
          ) : (
            page.projects.map((project) => (
              <ProjectCard key={project.id} project={project} canRotate={isOwner} />
            ))
          )}

          {(cursor || page.hasMore) && (
            <nav
              aria-label="Project pages"
              className="flex items-center justify-between border-t border-line px-5 py-3 text-xs"
            >
              {cursor ? (
                <Link href="/settings" className="rounded font-medium text-ink-2 hover:text-ink">
                  Newer projects
                </Link>
              ) : (
                <span />
              )}
              {page.hasMore && page.cursor ? (
                <Link
                  href={`/settings?cursor=${encodeURIComponent(page.cursor)}`}
                  className="rounded font-medium text-ink-2 hover:text-ink"
                >
                  Older projects
                </Link>
              ) : null}
            </nav>
          )}
        </div>
      </Panel>

      <TeamPanel context={context} origin={origin} />
    </div>
  );
}
