// Sidebar order. Every page must be listed here to appear in the navigation and the pager.
export default [
  {
    title: 'Start',
    items: [
      { title: 'Overview', url: '/' },
      { title: 'Getting started', url: '/getting-started/' },
      { title: 'Configuration', url: '/configuration/' },
      { title: 'Remote access', url: '/remote-access/' },
      { title: 'Security model', url: '/security/' }
    ]
  },
  {
    title: 'Using lazylab',
    items: [
      { title: 'Inbox', url: '/guide/inbox/' },
      { title: 'Notifications and watches', url: '/guide/notifications/' },
      { title: 'CI failures and running pipelines', url: '/guide/ci/' },
      { title: 'Work items and merge requests', url: '/guide/planning/' },
      { title: 'Releases and tags', url: '/guide/releases/' },
      { title: 'Project settings', url: '/guide/project-settings/' },
      { title: 'Vault', url: '/guide/vault/' }
    ]
  },
  {
    title: 'Agents',
    items: [
      { title: 'MCP server', url: '/agents/mcp/' },
      { title: 'REST API', url: '/agents/rest/' },
      { title: 'Agent skills', url: '/agents/skills/' }
    ]
  },
  {
    title: 'Reference',
    items: [
      { title: 'Architecture', url: '/reference/architecture/' },
      { title: 'Feature status', url: '/reference/status/' },
      { title: 'Development', url: '/reference/development/' }
    ]
  }
];
