// DOCS_SITE_URL is the published base URL (CI sets it from CI_PAGES_URL). Without it the
// link-preview tags that need absolute URLs (og:url, og:image) are left out.
const url = (process.env.DOCS_SITE_URL || '').replace(/\/+$/, '');

export default {
  title: 'lazylab',
  url,
  description: 'A self-hosted GitLab workspace with an inbox, push notifications, CI failure triage and an MCP server for coding agents.',
  repo: 'https://gitlab.com/sgkens/lazylab',
  editBase: 'https://gitlab.com/sgkens/lazylab/-/edit/main/docs/src/'
};
