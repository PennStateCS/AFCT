import type { MetadataRoute } from 'next';

/**
 * AFCT is a private course tool -- student work, rosters and grades live behind
 * the login, and nothing here belongs in a search index. So the robots file is a
 * blanket disallow for every user agent, with no sitemap to advertise.
 *
 * robots.txt is only advisory (it asks well-behaved crawlers not to *fetch*; it
 * does not stop a URL being indexed if something links to it), so the real
 * enforcement is the `X-Robots-Tag: noindex, nofollow, ...` response header set
 * on every path in next.config.ts. This file is the polite front door.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
