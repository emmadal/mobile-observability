import { getDb } from '@/db/client';
import { handleEnvelope } from '@/server/ingest/handle-envelope';

export async function POST(request: Request): Promise<Response> {
  return handleEnvelope(request, getDb());
}
