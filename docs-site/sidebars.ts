import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// One explicit sidebar so the reading order is deliberate. Doc ids are the file
// paths under docs/ without the extension.
const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['intro'],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['guides/student', 'guides/faculty', 'guides/admin'],
    },
    {
      type: 'category',
      label: 'Installation & Setup',
      items: [
        'setup/production',
        'setup/production/linux',
        'setup/production/macos',
        'setup/production/windows',
        'setup/production/non-docker',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/updates',
        'operations/backups',
        'operations/tls',
        'operations/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/roles-and-permissions',
        'reference/client-api',
        'reference/deployment-architecture',
        {
          type: 'link',
          label: 'API Reference',
          href: 'https://pennstatewilkes-barre.github.io/AFCT-Dashboard/api/',
        },
      ],
    },
  ],
};

export default sidebars;
