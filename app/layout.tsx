import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from './components/ServiceWorkerRegistrar';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#020617',
};

export const metadata: Metadata = {
  title: 'SAPOL Camera Map',
  description: 'Live mobile speed camera locations in South Australia',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Camera Map',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full bg-slate-950 text-white antialiased">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
