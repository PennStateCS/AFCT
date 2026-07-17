import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// Published to GitHub Pages as a project site, so every route lives under
// /AFCT/. The generated OpenAPI reference (Redoc) is copied into the
// same Pages artifact under /api/ by .github/workflows/docs.yml.
const config: Config = {
  title: 'AFCT Dashboard',
  tagline: 'Automated Feedback for CS Theory',
  favicon: 'img/favicon.ico',

  url: 'https://pennstatecs.github.io',
  baseUrl: '/AFCT/',

  organizationName: 'PennStateCS',
  projectName: 'AFCT',

  onBrokenLinks: 'throw',

  markdown: {
    // The docs are plain Markdown moved in from docs/; compile .md as CommonMark
    // so stray < and { in prose can't break the MDX compiler.
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: ['docusaurus-theme-openapi-docs'],

  plugins: [
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'classic',
        config: {
          afct: {
            // Written by `npm run docs:api` at the repo root; run that first,
            // then `npm run gen-api` here to (re)generate the MDX pages.
            specPath: '../docs-dist/openapi.json',
            outputDir: 'docs/api-reference',
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
          },
        },
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          // Docs-only site: serve the docs at the site root.
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/PennStateCS/AFCT/tree/main/docs-site/',
          // Renders the generated OpenAPI pages (everything else falls through
          // to the default doc component).
          docItemComponent: '@theme/ApiItem',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'AFCT Dashboard',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Documentation',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiReference',
          position: 'left',
          label: 'API Reference',
        },
        {
          href: 'https://github.com/PennStateCS/AFCT',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting started', to: '/' },
            { label: 'Production setup', to: '/setup/production' },
            { label: 'Troubleshooting', to: '/operations/troubleshooting' },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'API Reference',
              to: '/api-reference/afct-dashboard-api',
            },
            {
              label: 'OpenAPI spec',
              href: 'https://pennstatecs.github.io/AFCT/api/openapi.json',
            },
            { label: 'Roles and permissions', to: '/reference/roles-and-permissions' },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/PennStateCS/AFCT',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Penn State Wilkes-Barre.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
