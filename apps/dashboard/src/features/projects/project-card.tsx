import { CopyField } from './copy-field';
import { RotateKeyForm } from './rotate-key-form';
import type { ProjectSummary } from './service';

interface ProjectCardProps {
  project: ProjectSummary;
  canRotate: boolean;
}

export function ProjectCard({ project, canRotate }: ProjectCardProps) {
  const created = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(project.createdAt);

  return (
    <article
      id={`project-${project.id}`}
      className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{project.name}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {project.slug} · created {created}
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {project.sdkEnabled ? 'SDK enabled' : 'SDK disabled'}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {project.ingestKey ? (
          <CopyField
            label="Public ingest key"
            value={project.ingestKey}
            note="Safe to ship in the app: it can only send telemetry."
          />
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">No active ingest key.</p>
        )}

        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            The secret upload token is stored hashed and shown only when created or rotated. Use it
            in CI with <code className="font-mono">mobs sourcemaps upload</code>.
          </p>
          {canRotate ? (
            <RotateKeyForm
              projectId={project.id}
              kind="upload"
              label="Upload token"
              description="For CI source-map uploads."
            />
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Only organization owners can rotate keys.
            </p>
          )}
        </div>

        {canRotate && (
          <RotateKeyForm
            projectId={project.id}
            kind="ingest"
            label="Ingest key"
            description="Rotate if the public key was abused."
          />
        )}
      </div>
    </article>
  );
}
