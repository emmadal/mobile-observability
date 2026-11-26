'use client';

import { useActionState, useState } from 'react';
import { type DeleteProjectState, deleteProjectAction } from '@/app/actions/projects';
import { dangerButtonClass, inputClass, labelClass } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const initialState: DeleteProjectState = {};

interface DeleteProjectFormProps {
  projectId: string;
  projectName: string;
}

/** Owner-only. Deleting needs the project's exact name, checked again on the server. */
export function DeleteProjectForm({ projectId, projectName }: DeleteProjectFormProps) {
  const [state, action, pending] = useActionState(deleteProjectAction, initialState);
  const [typed, setTyped] = useState('');
  const inputId = `delete-${projectId}`;

  return (
    <AlertDialog onOpenChange={(open) => !open && setTyped('')}>
      <AlertDialogTrigger className={dangerButtonClass}>Delete project</AlertDialogTrigger>
      <AlertDialogContent>
        <form action={action} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {projectName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project, its keys and all of its data: sessions, errors
              and issues, events, network requests, metrics, source maps and alerts. Apps still
              using its key stop sending data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input type="hidden" name="projectId" value={projectId} />
          <label htmlFor={inputId} className={labelClass}>
            Type <span className="font-mono text-ink">{projectName}</span> to confirm
          </label>
          <input
            id={inputId}
            name="confirmName"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} mt-0`}
          />
          {state.error && (
            <p role="alert" className="text-xs text-critical">
              {state.error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || typed.trim() !== projectName}
            >
              {pending ? 'Deleting…' : 'Delete project'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
