'use client';

import { useActionState } from 'react';
import { type RotateKeyState, rotateKeyAction } from '@/app/actions/projects';
import { secondaryButtonClass } from '@/components/ui';
import { CopyField } from './copy-field';
import { envLine } from './env-snippet';

const initialState: RotateKeyState = {};

interface RotateKeyFormProps {
  projectId: string;
  kind: 'ingest' | 'upload';
  label: string;
  description: string;
}

/** Owner-only rotation. The new key is rendered once, from the action state. */
export function RotateKeyForm({ projectId, kind, label, description }: RotateKeyFormProps) {
  const [state, action, pending] = useActionState(rotateKeyAction, initialState);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink">{label}</p>
          <p className="text-2xs text-ink-3">{description}</p>
        </div>
        <form action={action}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="kind" value={kind} />
          <button type="submit" disabled={pending} className={secondaryButtonClass}>
            {pending ? 'Rotating…' : kind === 'ingest' ? 'Rotate key' : 'New token'}
          </button>
        </form>
      </div>

      {state.error && (
        <p role="alert" className="text-2xs text-critical">
          {state.error}
        </p>
      )}

      {state.key && (
        <CopyField
          label={`New ${kind === 'ingest' ? 'public ingest key' : 'secret upload token'}`}
          value={envLine(kind === 'ingest' ? 'ingestKey' : 'uploadToken', state.key)}
          note="Shown once. The previous key stopped working."
        />
      )}
    </div>
  );
}
