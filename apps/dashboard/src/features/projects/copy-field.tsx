'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from '@/components/icons';

interface CopyFieldProps {
  label: string;
  value: string;
  note?: string;
}

/** Read-only value with a copy button; no value is kept after unmount. */
export function CopyField({ label, value, note }: CopyFieldProps) {
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-2xs font-medium text-ink-3">{label}</span>
      <div className="flex min-w-0 items-stretch rounded-md border border-line-strong bg-night">
        <code
          className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-2xs text-ink"
          title={value}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 border-l border-line-strong px-3 text-2xs font-medium text-ink-2 hover:bg-raised hover:text-ink"
        >
          {status === 'copied' ? (
            <CheckIcon className="size-3.5 text-good" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
          <span aria-live="polite">
            {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
          </span>
        </button>
      </div>
      {note && <p className="text-2xs text-ink-3">{note}</p>}
    </div>
  );
}
