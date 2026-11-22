import { getDb } from '@/db/client';
import { handleConfig } from '@/server/ingest/handle-config';

export async function GET(request: Request): Promise<Response> {
  return handleConfig(request, getDb());
}
