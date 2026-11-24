import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { withExplicitSslMode } from './connection-url';

const NEON =
  'postgresql://owner:s3cr%40t@ep-x-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

describe('withExplicitSslMode', () => {
  it.each(['prefer', 'require', 'verify-ca'])('pins sslmode=%s to verify-full', (mode) => {
    const url = new URL(withExplicitSslMode(`postgres://u:p@db.example.com/app?sslmode=${mode}`));
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('keeps credentials, host, database and TLS verification of a Neon URL', () => {
    // Constructing a client parses the connection string without connecting.
    const client = new Client({ connectionString: withExplicitSslMode(NEON) });
    expect(client).toMatchObject({
      user: 'owner',
      password: 's3cr@t',
      host: 'ep-x-pooler.us-east-1.aws.neon.tech',
      database: 'neondb',
    });
    expect(client.ssl).toBeTruthy();
    expect(new URL(withExplicitSslMode(NEON)).searchParams.get('channel_binding')).toBe('require');
  });

  it('removes the pg sslmode deprecation warning', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      new Client({ connectionString: withExplicitSslMode(NEON) });
      expect(emitWarning).not.toHaveBeenCalled();
      // Control: the raw provider URL does warn (pg warns once per process).
      new Client({ connectionString: NEON });
      expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING'));
    } finally {
      emitWarning.mockRestore();
    }
  });

  it.each([
    'postgres://mobs:mobs@localhost:5433/mobs',
    'postgres://u:p@db.example.com/app?sslmode=disable',
    'postgres://u:p@db.example.com/app?sslmode=verify-full',
    'postgres://u:p@db.example.com/app?sslmode=no-verify',
    'postgres://u:p@db.example.com/app?uselibpqcompat=true&sslmode=require',
    '/var/run/postgresql app',
    'not a url',
  ])('leaves %s unchanged', (input) => {
    expect(withExplicitSslMode(input)).toBe(input);
  });
});
