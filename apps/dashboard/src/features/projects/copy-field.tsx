'use client';

import { useState } from 'react';

interface CopyFieldProps {
  label: string;
  value: string;
  note?: string;
}

/** Read-only key display with a copy button; no value is kept after unmount. */
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
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-2 py-1.5 font-mono text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      {note && <p className="text-xs text-zinc-500 dark:text-zinc-500">{note}</p>}
    </div>
  );
}
