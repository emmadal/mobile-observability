'use client';

import { useActionState } from 'react';
import { type CreateProjectState, createProjectAction } from '@/app/actions/projects';
import { FieldError, FormError, inputClass, labelClass, primaryButtonClass } from '@/components/ui';
import { CopyField } from './copy-field';

const initialState: CreateProjectState = {};

export function CreateProjectForm() {
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
            {state.created.name} is ready. Configure the SDK with its public ingest key.
          </p>
          <CopyField label="Public ingest key" value={state.created.ingestKey} />
          <CopyField
            label="Secret upload token"
            value={state.created.uploadToken}
            note="Shown once. Store it as a CI secret for source map uploads."
          />
        </div>
      )}
    </div>
  );
}
