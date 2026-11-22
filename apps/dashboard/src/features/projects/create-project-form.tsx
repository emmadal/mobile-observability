'use client';

import { useActionState } from 'react';
import { type CreateProjectState, createProjectAction } from '@/app/actions/projects';
import { CopyField } from './copy-field';

const initialState: CreateProjectState = {};

const inputClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100';

export function CreateProjectForm() {
  const [state, action, pending] = useActionState(createProjectAction, initialState);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New project</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Each project has its own keys, issues and metrics.
      </p>

      <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="My app"
            className={inputClass}
          />
          {state.fieldErrors?.name && (
            <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
              {state.fieldErrors.name}
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? 'Creating…' : 'Create project'}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      {state.created && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
            {state.created.name} is ready. Install the SDK with the public key below.
          </p>
          <CopyField label="Public ingest key" value={state.created.ingestKey} />
          <CopyField
            label="Secret upload token"
            value={state.created.uploadToken}
            note="Shown once. Use it in CI for mobs sourcemaps upload."
          />
        </div>
      )}
    </section>
  );
}
