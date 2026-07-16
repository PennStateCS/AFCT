// Side-by-side font comparison for the dev-tests page. The candidate fonts are
// loaded here (and only here), so the rest of the app stays on whatever
// fonts.ts says; preload is off since this is a dev-only page.
import {
  Geist,
  Inter,
  Atkinson_Hyperlegible_Next,
  Source_Sans_3,
  Roboto,
  IBM_Plex_Sans,
  Lexend,
} from 'next/font/google';
// geistSans is whatever fonts.ts currently points the app at (Open Sans for now).
import { geistSans } from '@/app/fonts';

const geist = Geist({ subsets: ['latin'], preload: false });
const inter = Inter({ subsets: ['latin'], preload: false });
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], preload: false });
const sourceSans = Source_Sans_3({ subsets: ['latin'], preload: false });
const roboto = Roboto({ subsets: ['latin'], preload: false });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], preload: false });
const lexend = Lexend({ subsets: ['latin'], preload: false });

const FONTS = [
  { name: 'Open Sans (current)', className: geistSans.className },
  { name: 'Geist', className: geist.className },
  { name: 'Inter', className: inter.className },
  { name: 'Atkinson Hyperlegible Next', className: atkinson.className },
  { name: 'Source Sans 3', className: sourceSans.className },
  { name: 'Roboto', className: roboto.className },
  { name: 'IBM Plex Sans', className: plexSans.className },
  { name: 'Lexend', className: lexend.className },
];

const SIZES = [
  { label: 'text-xs', className: 'text-xs' },
  { label: 'text-sm', className: 'text-sm' },
  { label: 'text-base', className: 'text-base' },
  { label: 'text-lg', className: 'text-lg' },
  { label: 'text-xl', className: 'text-xl' },
  { label: 'text-2xl', className: 'text-2xl' },
];

const SAMPLE = 'Sphinx of black quartz: judge my vow. Il1 O0 5S 8B';

export function FontSamples() {
  return (
    <div>
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
        {FONTS.map((font) => (
          <div key={font.name} className={font.className}>
            <h3 className="mb-3 border-b pb-2 text-sm font-semibold">{font.name}</h3>
            <div className="space-y-3">
              {SIZES.map((size) => (
                <div key={size.label}>
                  <div className="text-muted-foreground font-sans text-xs">{size.label}</div>
                  <p className={size.className}>{SAMPLE}</p>
                </div>
              ))}
              <div>
                <div className="text-muted-foreground font-sans text-xs">weights</div>
                <p className="text-sm">regular 400</p>
                <p className="text-sm font-medium">medium 500</p>
                <p className="text-sm font-semibold">semibold 600</p>
                <p className="text-sm font-bold">bold 700</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
