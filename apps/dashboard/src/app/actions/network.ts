'use server';

import { z } from 'zod';
import { parseOverviewFilters, resolveWindow } from '@/features/overview/filters';
import { getFilterOptions } from '@/features/overview/service';
import { getEndpointRequests } from '@/features/performance/service';
import { getOrgContext } from '@/features/projects/access';
import type { NetworkRequest } from '@/features/telemetry/request-trace';

const endpointSchema = z.object({
  method: z.string().min(1).max(16),
  host: z.string().min(1).max(255),
  path: z.string().min(1).max(1024),
  /** The page's filter query (range, project, platform...), as in the URL. */
  query: z.string().max(2048),
  failedOnly: z.boolean(),
});

export type EndpointRequestsResult = { requests: NetworkRequest[] } | { error: string };

/** The latest traces of one endpoint, under the same filters as the page. */
export async function loadEndpointRequestsAction(
  input: z.input<typeof endpointSchema>,
): Promise<EndpointRequestsResult> {
  const parsed = endpointSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid endpoint.' };
  const context = await getOrgContext();
  if (!context) return { error: 'Sign in to see requests.' };

  const now = new Date();
  const params = Object.fromEntries(new URLSearchParams(parsed.data.query));
  const requested = parseOverviewFilters(params, now);
  // Only the organization's own projects are ever queried.
  const options = await getFilterOptions(context.organizationId);
  const filters = options.projects.some((project) => project.id === requested.project)
    ? requested
    : { ...requested, project: null };
  const requests = await getEndpointRequests(
    options,
    filters,
    resolveWindow(filters.range, now),
    { method: parsed.data.method, host: parsed.data.host, path: parsed.data.path },
    parsed.data.failedOnly,
  );
  return { requests };
}
