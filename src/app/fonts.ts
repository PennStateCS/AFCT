// app/fonts.ts
// Geist Sans is the interface font; Geist Mono is for code, versions, identifiers
// and other technical values. Nothing else should load a font: the dev-tests font
// comparison page is the one exception, and it loads its candidates locally.
import { Geist, Geist_Mono } from 'next/font/google';

export const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
