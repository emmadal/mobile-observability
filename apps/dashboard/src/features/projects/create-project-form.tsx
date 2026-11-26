'use client';

import { useActionState } from 'react';
import { type CreateProjectState, createProjectAction } from '@/app/actions/projects';
import { FieldError, FormError, inputClass, labelClass, primaryButtonClass } from '@/components/ui';
import { CopyField } from './copy-field';
import { appEnv, envLine } from './env-snippet';

const initialState: CreateProjectState = {};

export function CreateProjectForm({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState(createProjectAction, initialState);

  return (
    <div className="border-b border-line px-5 py-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={`${labelClass} flex-1`}>
          New project name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="Shop app"
            aria-describedby={state.fieldErrors?.name ? 'project-name-error' : undefined}
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Creating…' : 'Create project'}
        </button>
      </form>
      <FieldError id="project-name-error" message={state.fieldErrors?.name} />
      {state.error && (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      )}

      {state.created && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-good/40 bg-good/5 p-4">
          <p className="text-xs font-medium text-ink">
            {state.created.name} is ready. Add these variables to the app.
          </p>
          <CopyField
            label="App .env"
            value={appEnv(origin, state.created.ingestKey)}
            multiline
            note="Pass both to Observe.configure. Safe to ship inside the app."
          />
          <CopyField
            label="Secret upload token (.env.local or CI secret)"
            value={envLine('uploadToken', state.created.uploadToken)}
            note="Shown once. Used only by the mobs CLI for source map uploads; never EXPO_PUBLIC_."
          />
        </div>
      )}
    </div>
  );
}
