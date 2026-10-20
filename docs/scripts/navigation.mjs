import { parseHTML } from 'linkedom';

/** Build links into HTML so headings and the contents panel also work without JavaScript. */
export function enhanceNavigation(html) {
  const { document } = parseHTML(html);
  const article = document.querySelector('article');
  if (!article) return html;
  const ids = new Set([...document.querySelectorAll('[id]')].map((node) => node.id));
  const toc = document.querySelector('#page-toc');
  const headings = [...article.querySelectorAll('h1,h2,h3')];
  for (const heading of headings) {
    const title = heading.textContent.trim();
    if (!heading.id) {
      const base = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
      let id = base;
      for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
      heading.id = id;
      ids.add(id);
    }
    if (heading.localName === 'h1') continue;
    heading.setAttribute('tabindex', '-1');
    const link = document.createElement('a');
    link.className = 'anchor';
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.setAttribute('aria-label', `Link to ${title}`);
    link.setAttribute('data-pagefind-ignore', '');
    link.textContent = '#';
    heading.append(link);
    if (toc) {
      const item = document.createElement('a');
      item.className = 'toc-link';
      item.href = `#${encodeURIComponent(heading.id)}`;
      item.dataset.depth = heading.localName.slice(1);
      item.textContent = title;
      toc.append(item);
    }
  }
  if (!toc?.children.length) document.querySelector('.page-outline')?.remove();
  const minutes = Math.max(1, Math.ceil(article.textContent.split(/\s+/).filter(Boolean).length / 220));
  document.querySelectorAll('[data-reading-time]').forEach((node) => { node.textContent = `${minutes} min read`; });
  article.querySelectorAll('pre:not(.mermaid)').forEach((pre) => {
    if (!pre.querySelector('code')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const bar = document.createElement('div');
    bar.className = 'code-toolbar';
    bar.setAttribute('data-pagefind-ignore', '');
    const language = document.createElement('span');
    language.textContent = pre.querySelector('code').className.match(/language-([\w-]+)/)?.[1] || 'text';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-code';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    bar.append(language, copy);
    pre.replaceWith(wrapper);
    wrapper.append(bar, pre);
  });
  return document.toString();
}
