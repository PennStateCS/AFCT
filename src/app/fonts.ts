// app/fonts.ts
// Trying Open Sans as the UI font for now (see the dev-tests font comparison).
// The variable keeps its old name so nothing downstream changes; rename it if
// this becomes final.
import { Open_Sans, Geist_Mono } from "next/font/google";

export const geistSans = Open_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
