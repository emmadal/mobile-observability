'use client';

import { CSPProvider } from '@base-ui/react/csp-provider';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Client-side providers for the shadcn/Base UI components.
 *
 * The CSP (src/proxy.ts) only allows nonced <style> elements, so Base UI's
 * inline scrollbar <style> is disabled and its rule lives in globals.css
 * (`.base-ui-disable-scrollbar`) instead.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <CSPProvider disableStyleElements>
      <TooltipProvider>{children}</TooltipProvider>
    </CSPProvider>
  );
}
