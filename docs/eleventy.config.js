// Eleventy config for the lazylab documentation site.
// Build: cd docs && bun install && bun run build   (output: docs/_site)
// Serve: cd docs && bun run dev                    (http://localhost:8090)
// Set DOCS_PATH_PREFIX (e.g. /lazylab/) when the site is served from a sub-path such as GitLab Pages.
import { HtmlBasePlugin } from '@11ty/eleventy';
import * as pagefind from 'pagefind';
import { enhanceNavigation } from './scripts/navigation.mjs';
import { buildAssets } from './scripts/build-assets.mjs';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);
  eleventyConfig.addPassthroughCopy({ 'src/assets/brand': 'assets/brand', 'src/assets/screenshots': 'assets/screenshots' });
  eleventyConfig.addPassthroughCopy({ '.generated': 'assets' });
  eleventyConfig.addWatchTarget('src/assets/');
  eleventyConfig.addWatchTarget('scripts/');
  eleventyConfig.watchIgnores.add('.generated/**');
  eleventyConfig.on('eleventy.before', buildAssets);
  eleventyConfig.addTransform('docs-navigation', function (html) {
    return this.page.outputPath?.endsWith('.html') ? enhanceNavigation(html) : html;
  });
  eleventyConfig.on('eleventy.after', async ({ directories }) => {
    const { index, errors } = await pagefind.createIndex();
    if (!index) throw new Error(`Pagefind: ${errors.join('; ')}`);
    try {
      const result = await index.addDirectory({ path: directories.output });
      if (result.errors.length) throw new Error(`Pagefind: ${result.errors.join('; ')}`);
      const written = await index.writeFiles({ outputPath: `${directories.output}/pagefind` });
      if (written.errors.length) throw new Error(`Pagefind: ${written.errors.join('; ')}`);
      console.log(`[search] Indexed ${result.page_count} documentation pages`);
    } finally { await index.deleteIndex(); await pagefind.close(); }
  });
  eleventyConfig.addFilter('sectionFor', (nav, url) => nav.find((section) => section.items.some((item) => item.url === url))?.title || 'Documentation');
  eleventyConfig.addFilter('sourcePath', (path) => path.replace(/^\.\/src\//, '').split('/').map(encodeURIComponent).join('/'));

  // ```mermaid fences render as diagrams in the browser instead of code.
  eleventyConfig.amendLibrary('md', (md) => {
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.info.trim() === 'mermaid') return `<pre class="mermaid" data-pagefind-ignore>${escapeHtml(token.content)}</pre>\n`;
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
