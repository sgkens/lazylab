// Eleventy config for the lazylab documentation site.
// Build: cd docs && bun install && bun run build   (output: docs/_site)
// Serve: cd docs && bun run dev                    (http://localhost:8090)
// Set DOCS_PATH_PREFIX (e.g. /lazylab/) when the site is served from a sub-path such as GitLab Pages.
import { HtmlBasePlugin, IdAttributePlugin } from '@11ty/eleventy';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);
  // Heading ids for deep links; the layout adds the "#" anchors.
  eleventyConfig.addPlugin(IdAttributePlugin);
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  // ```mermaid fences render as diagrams in the browser instead of code.
  eleventyConfig.amendLibrary('md', (md) => {
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.info.trim() === 'mermaid') return `<pre class="mermaid">${escapeHtml(token.content)}</pre>\n`;
      return fence(tokens, idx, options, env, self);
    };
  });

  // Previous / next page from the ordered navigation in _data/nav.js.
  eleventyConfig.addFilter('pager', (nav, url) => {
    const flat = nav.flatMap((section) => section.items);
    const i = flat.findIndex((item) => item.url === url);
    return { prev: i > 0 ? flat[i - 1] : null, next: i > -1 && i < flat.length - 1 ? flat[i + 1] : null };
  });

  return {
    dir: { input: 'src', includes: '_includes', data: '_data', output: '_site' },
    // Markdown is not run through Nunjucks, so `{{ }}` in code samples stays literal.
    markdownTemplateEngine: false,
    htmlTemplateEngine: 'njk',
    pathPrefix: process.env.DOCS_PATH_PREFIX || '/'
  };
}
