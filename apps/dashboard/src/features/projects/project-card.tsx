import { HealthBadge } from '@/components/ui';
import { CopyField } from './copy-field';
import { RotateKeyForm } from './rotate-key-form';
import type { ProjectSummary } from './service';

interface ProjectCardProps {
  project: ProjectSummary;
  canRotate: boolean;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** One project row of the Settings list: identity, keys, owner actions. */
export function ProjectCard({ project, canRotate }: ProjectCardProps) {
  return (
    <article
      id={`project-${project.id}`}
      className="grid gap-5 border-b border-line px-5 py-5 last:border-b-0 lg:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="font-wide text-sm font-semibold text-ink">{project.name}</h3>
        <p className="text-2xs text-ink-3">
          <span className="font-mono">{project.slug}</span>, created{' '}
          {dateFormat.format(project.createdAt)}
        </p>
        <div>
          {project.sdkEnabled ? (
            <HealthBadge health="good" label="SDK enabled" />
          ) : (
            <HealthBadge health="warning" label="SDK paused" />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {project.ingestKey ? (
          <CopyField
            label="Public ingest key"
            value={project.ingestKey}
            note="Safe to ship inside the app: it can only send telemetry."
          />
        ) : (
          <p className="text-xs text-ink-3">No active ingest key. Rotate to issue a new one.</p>
        )}

        <div className="flex flex-col gap-4 rounded-md border border-line bg-night/40 p-4">
          <p className="text-2xs text-ink-3">
            The secret upload token is stored hashed and only shown when it is created. CI uses it
            with <code className="font-mono text-ink-2">mobs sourcemaps upload</code>.
          </p>
          {canRotate ? (
            <>
              <RotateKeyForm
                projectId={project.id}
                kind="upload"
                label="Upload token"
                description="For source map uploads from CI."
              />
              <hr className="border-line" />
              <RotateKeyForm
                projectId={project.id}
                kind="ingest"
                label="Ingest key"
                description="Rotate if the public key is being abused."
              />
            </>
          ) : (
            <p className="text-2xs text-ink-3">Only the workspace owner can rotate keys.</p>
          )}
        </div>
      </div>
    </article>
  );
}
