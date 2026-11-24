'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { alertRules, projects } from '@/db/schema';
import { getOrgContext } from '@/features/projects/access';

const createSchema = z.object({
  projectId: z.uuid(),
  metric: z.enum(['crash_free_rate', 'api_error_rate', 'startup_p75']),
  window: z.enum(['1h', '6h', '24h']),
  threshold: z.coerce.number(),
});

/** crash_free_rate fires below (0..1); the others fire above (rate 0..1, ms). */
const THRESHOLD_BOUNDS: Record<string, { min: number; max: number }> = {
  crash_free_rate: { min: 0, max: 1 },
  api_error_rate: { min: 0, max: 1 },
  startup_p75: { min: 100, max: 60_000 },
};

/** Adds a threshold alert to a project the visitor's workspace owns. */
export async function createAlertRuleAction(formData: FormData): Promise<void> {
  const parsed = createSchema.safeParse({
    projectId: formData.get('projectId'),
    metric: formData.get('metric'),
    window: formData.get('window'),
    threshold: formData.get('threshold'),
  });
  if (!parsed.success) return;
  const { metric, threshold } = parsed.data;
  const bounds = THRESHOLD_BOUNDS[metric];
  if (!bounds || threshold < bounds.min || threshold > bounds.max) return;

  const context = await getOrgContext();
  if (!context || context.role !== 'owner') return;
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, parsed.data.projectId),
        eq(projects.organizationId, context.organizationId),
      ),
    )
    .limit(1);
  if (!project) return;

  await getDb().insert(alertRules).values({
    projectId: parsed.data.projectId,
    metric,
    window: parsed.data.window,
    threshold,
  });
  revalidatePath('/settings');
  revalidatePath('/');
}

/** Removes one of the workspace's alert rules. */
export async function deleteAlertRuleAction(formData: FormData): Promise<void> {
  const ruleId = z.uuid().safeParse(formData.get('ruleId'));
  if (!ruleId.success) return;
  const context = await getOrgContext();
  if (!context || context.role !== 'owner') return;

  await getDb()
    .delete(alertRules)
    .where(
      inArray(
        alertRules.id,
        getDb()
          .select({ id: alertRules.id })
          .from(alertRules)
          .innerJoin(projects, eq(projects.id, alertRules.projectId))
          .where(
            and(
              eq(alertRules.id, ruleId.data),
              eq(projects.organizationId, context.organizationId),
            ),
          ),
      ),
    );
  revalidatePath('/settings');
  revalidatePath('/');
}
