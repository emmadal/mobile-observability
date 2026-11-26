'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getOrgContext } from '@/features/projects/access';
import {
  createProject,
  deleteProject,
  ProjectNameMismatchError,
  ProjectNotFoundError,
  rotateKey,
} from '@/features/projects/service';
import type { KeyKind } from '@/server/keys/keys';

const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Project name must be at least 2 characters.')
    .max(80, 'Project name must be at most 80 characters.'),
});

const deleteSchema = z.object({
  projectId: z.uuid(),
  confirmName: z.string().max(200),
});

const rotateSchema = z.object({
  projectId: z.uuid(),
  kind: z.enum(['ingest', 'upload']),
});

export interface CreateProjectState {
  error?: string;
  fieldErrors?: { name?: string };
  /** Keys are returned once; the upload token is never stored in clear. */
  created?: {
    name: string;
    ingestKey: string;
    uploadToken: string;
  };
}

export interface DeleteProjectState {
  error?: string;
}

export interface RotateKeyState {
  error?: string;
  projectId?: string;
  kind?: KeyKind;
  /** The new key, shown once. */
  key?: string;
}

export async function createProjectAction(
  _state: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only the workspace owner can create projects.' };

  const parsed = nameSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return { fieldErrors: { name: parsed.error.issues[0]?.message } };
  }

  const project = await createProject({
    organizationId: context.organizationId,
    userId: context.userId,
    name: parsed.data.name,
  });
  revalidatePath('/settings');
  return {
    created: {
      name: project.name,
      ingestKey: project.ingestKey,
      uploadToken: project.uploadToken,
    },
  };
}

export async function rotateKeyAction(
  _state: RotateKeyState,
  formData: FormData,
): Promise<RotateKeyState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only owners can rotate keys.' };

  const parsed = rotateSchema.safeParse({
    projectId: formData.get('projectId'),
    kind: formData.get('kind'),
  });
  if (!parsed.success) return { error: 'Invalid request.' };

  try {
    const key = await rotateKey({
      organizationId: context.organizationId,
      projectId: parsed.data.projectId,
      kind: parsed.data.kind,
      userId: context.userId,
    });
    revalidatePath('/settings');
    return { projectId: parsed.data.projectId, kind: parsed.data.kind, key };
  } catch (error) {
    if (error instanceof ProjectNotFoundError) return { error: 'Project not found.' };
    throw error;
  }
}

/**
 * Owner-only. Deletes the project and, through ON DELETE CASCADE, every row
 * of its data, then returns to Settings with a confirmation notice.
 */
export async function deleteProjectAction(
  _state: DeleteProjectState,
  formData: FormData,
): Promise<DeleteProjectState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only the workspace owner can delete projects.' };

  const parsed = deleteSchema.safeParse({
    projectId: formData.get('projectId'),
    confirmName: formData.get('confirmName'),
  });
  if (!parsed.success) return { error: 'Invalid request.' };

  let name: string;
  try {
    ({ name } = await deleteProject({
      organizationId: context.organizationId,
      projectId: parsed.data.projectId,
      confirmName: parsed.data.confirmName,
    }));
  } catch (error) {
    if (error instanceof ProjectNotFoundError) return { error: 'Project not found.' };
    if (error instanceof ProjectNameMismatchError) {
      return { error: 'Type the project name exactly as shown to confirm.' };
    }
    throw error;
  }

  // Every page lists or filters by project.
  revalidatePath('/', 'layout');
  redirect(`/settings?deleted=${encodeURIComponent(name)}#projects`);
}
