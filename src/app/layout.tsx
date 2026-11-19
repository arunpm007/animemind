import type { Metadata, Viewport } from 'next';
import { Dela_Gothic_One, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
// Chunky Japanese-gothic display face for page titles and headlines.
const display = Dela_Gothic_One({ weight: '400', subsets: ['latin'], variable: '--font-dela' });

export const metadata: Metadata = {
  title: 'AnimeMind',
  description: 'Never forget what you watched.',
};

export const viewport: Viewport = {
  themeColor: '#0b0806',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
