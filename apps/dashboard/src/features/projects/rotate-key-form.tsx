'use client';

import { useActionState } from 'react';
import { type RotateKeyState, rotateKeyAction } from '@/app/actions/projects';
import { CopyField } from './copy-field';

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">{description}</p>
        </div>
        <form action={action}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="kind" value={kind} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {pending ? 'Rotating…' : 'Rotate'}
          </button>
        </form>
      </div>

      {state.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      {state.key && (
        <CopyField
          label={`New ${kind === 'ingest' ? 'public ingest key' : 'secret upload token'}`}
          value={state.key}
          note="Shown once. The previous key stops working immediately."
        />
      )}
    </div>
  );
}
