import { HealthBadge } from '@/components/ui';
import { CopyField } from './copy-field';
import { DeleteProjectForm } from './delete-project-form';
import { appEnv, MOBS_ENV } from './env-snippet';
import { RotateKeyForm } from './rotate-key-form';
import type { ProjectSummary } from './service';

interface ProjectCardProps {
  project: ProjectSummary;
  canRotate: boolean;
  /** This dashboard's URL, which the SDK and the CLI send to. */
  origin: string;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** One project row of the Settings list: identity, keys, owner actions. */
export function ProjectCard({ project, canRotate, origin }: ProjectCardProps) {
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
        {canRotate && (
          <div className="mt-2">
            <DeleteProjectForm projectId={project.id} projectName={project.name} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <dl className="grid gap-x-4 gap-y-2 text-2xs sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
          <dt className="font-medium text-ink-3">Ingest key</dt>
          <dd
            className="min-w-0 truncate font-mono text-ink"
            title={project.ingestKey ?? undefined}
          >
            {project.ingestKey ?? 'None active'}
          </dd>
          <dd className="text-ink-3">
            {project.ingestKeyCreatedAt
              ? `public, created ${dateFormat.format(project.ingestKeyCreatedAt)}`
              : '—'}
          </dd>
          <dt className="font-medium text-ink-3">Upload token</dt>
          <dd className="min-w-0 truncate font-mono text-ink">
            {project.uploadToken ? `${project.uploadToken.prefix}…` : 'None active'}
          </dd>
          <dd className="text-ink-3">
            {project.uploadToken
              ? `secret, created ${dateFormat.format(project.uploadToken.createdAt)}`
              : '—'}
          </dd>
        </dl>

        {project.ingestKey ? (
          <CopyField
            label="App .env"
            value={appEnv(origin, project.ingestKey)}
            multiline
            note={`Pass both to Observe.configure. Safe to ship inside the app: the key can only send telemetry, and the CLI reads ${MOBS_ENV.endpoint} too.`}
          />
        ) : (
          <p className="text-xs text-ink-3">No active ingest key. Rotate to issue a new one.</p>
        )}

        <div className="flex flex-col gap-4 rounded-md border border-line bg-night/40 p-4">
          <p className="text-2xs text-ink-3">
            The secret upload token is stored hashed and only shown when it is created. Put it in{' '}
            <code className="font-mono text-ink-2">{MOBS_ENV.uploadToken}</code> (a CI secret or a
            git-ignored <code className="font-mono text-ink-2">.env.local</code>) for{' '}
            <code className="font-mono text-ink-2">mobs sourcemaps upload</code>; never prefix it
            with <code className="font-mono text-ink-2">EXPO_PUBLIC_</code>.
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
