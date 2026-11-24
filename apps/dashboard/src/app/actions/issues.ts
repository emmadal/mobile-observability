'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setIssueStatus } from '@/features/issues/service';
import { getOrgContext } from '@/features/projects/access';

const statusSchema = z.object({
  issueId: z.uuid(),
  status: z.enum(['open', 'resolved', 'ignored']),
});

/** Resolve, ignore or reopen an issue from the issue detail page. */
export async function setIssueStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse({
    issueId: formData.get('issueId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;

  const context = await getOrgContext();
  if (!context) return;

  const updated = await setIssueStatus(
    context.organizationId,
    parsed.data.issueId,
    parsed.data.status,
  );
  if (!updated) return;

  revalidatePath('/');
  revalidatePath('/issues');
  revalidatePath(`/issues/${parsed.data.issueId}`);
}
