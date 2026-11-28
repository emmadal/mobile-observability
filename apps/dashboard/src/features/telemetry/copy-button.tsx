'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from '@/components/icons';

/** Small "Copy" button for a value shown next to it (URL, response body, trace id). */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 text-2xs font-medium text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
    >
      {status === 'copied' ? (
        <CheckIcon className="size-3 text-good" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      <span aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
      </span>
    </button>
  );
}
