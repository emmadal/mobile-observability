import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { connection } from 'next/server';
import { Providers } from '@/components/providers';
import './globals.css';

// One family; its width axis separates placards (wide) from dense tables (narrow).
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  axes: ['wdth'],
});

export const metadata: Metadata = {
  title: {
    default: 'Mobile Observability',
    template: '%s · Mobile Observability',
  },
  description: 'Crashes, errors and startup performance for React Native and Expo apps.',
};

export const viewport: Viewport = {
  themeColor: '#121a2b',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Every page renders per request so Next.js can stamp the CSP nonce (set in
  // src/proxy.ts) on its scripts; a build-time page could not carry it.
  await connection();
  return (
    <html lang="en" className={`${archivo.variable} dark h-full`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
