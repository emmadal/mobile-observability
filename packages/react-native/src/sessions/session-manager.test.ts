import { describe, expect, it } from 'vitest';
import { SessionManager, type SessionUpdate } from './session-manager';

function setup(timeoutMs = 30_000) {
  const clock = { now: 0 };
  const updates: SessionUpdate[] = [];
  const manager = new SessionManager({
    timeoutMs,
    now: () => clock.now,
    onUpdate: (u) => updates.push(u),
  });
  return { clock, updates, manager };
}

describe('SessionManager (AC-8)', () => {
  it('starts a session on cold start with init=true', () => {
    const { manager, updates } = setup();
    manager.start();
    expect(updates[0]).toMatchObject({ status: 'ok', init: true, errorCount: 0 });
  });

  it('keeps the session after a short background', () => {
    const { manager, updates, clock } = setup();
    manager.start();
    const first = manager.sessionId;
    manager.onBackground();
    clock.now += 29_999;
    manager.onForeground();
    expect(manager.sessionId).toBe(first);
    expect(updates.every((u) => u.endedAt === undefined)).toBe(true);
  });

  it('ends the session and starts a new one after >= 30 s in background', () => {
    const { manager, updates, clock } = setup();
    manager.start();
    const first = manager.sessionId;
    clock.now = 1_000;
    manager.onBackground();
    clock.now = 31_000;
    manager.onForeground();
    expect(manager.sessionId).not.toBe(first);
    const ended = updates.find((u) => u.sessionId === first && u.endedAt !== undefined);
    expect(ended?.endedAt).toBe(1_000);
    expect(updates.at(-1)).toMatchObject({ init: true, status: 'ok' });
  });

  it('marks errored on errors and crashed on fatal', () => {
    const { manager } = setup();
    manager.start();
    manager.recordError(false);
    expect(manager.status).toBe('errored');
    manager.recordError(true);
    expect(manager.status).toBe('crashed');
    expect(manager.snapshot()?.errorCount).toBe(2);
  });
});
