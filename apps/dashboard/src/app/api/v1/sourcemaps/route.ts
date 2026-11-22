import { getDb } from '@/db/client';
import { handleSourceMapUpload } from '@/server/symbolication/handle-upload';

export async function POST(request: Request): Promise<Response> {
  return handleSourceMapUpload(request, getDb());
}
