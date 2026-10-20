import '@staticcanvas/hawk/css';
import './style.css';
import logcad from '@staticcanvas/logcad';

const root = document.documentElement;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const desktop = matchMedia('(min-width: 1200px)');
const mobile = matchMedia('(max-width: 819px)');
const themeButton = document.querySelector('.theme-toggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : systemTheme.matches;
const toast = document.querySelector('.toast');
let toastTimer;
function announce(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}
function diagnostic(message) {
  logcad.logc([{ text: 'lazylab docs', b: true }, { text: ` · ${message}` }]);
}
function themeLabel() {
  themeButton.setAttribute('aria-label', `Switch to ${dark() ? 'light' : 'dark'} theme`);
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--bg').trim();
}
themeButton.addEventListener('click', () => {
  root.dataset.theme = dark() ? 'light' : 'dark';
  try { localStorage.setItem('lazylab-docs-theme', root.dataset.theme); } catch {}
  themeLabel();
  document.dispatchEvent(new Event('docs-theme-change'));
});
systemTheme.addEventListener('change', themeLabel);
themeLabel();

const navToggle = document.querySelector('.nav-toggle');
const sidebar = document.querySelector('.sidebar');
const backdrop = document.querySelector('.nav-backdrop');
function navigation(open, returnFocus = false) {
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} navigation`);
  backdrop.hidden = !open;
  sidebar.inert = mobile.matches && !open;
  if (open) (sidebar.querySelector('[aria-current="page"]') || sidebar.querySelector('a')).focus({ preventScroll: true });
  else if (returnFocus) navToggle.focus({ preventScroll: true });
}
navToggle.addEventListener('click', () => navigation(navToggle.getAttribute('aria-expanded') !== 'true', true));
backdrop.addEventListener('click', () => navigation(false, true));
sidebar.addEventListener('click', (event) => { if (mobile.matches && event.target.closest('a')) navigation(false); });
mobile.addEventListener('change', () => navigation(false));
navigation(false);
document.addEventListener('keydown', (event) => {
  if (navToggle.getAttribute('aria-expanded') !== 'true') return;
  if (event.key === 'Escape') { event.preventDefault(); navigation(false, true); }
  if (event.key !== 'Tab') return;
  const focusable = [navToggle, ...sidebar.querySelectorAll('a[href]')];
  const index = focusable.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1).focus(); }
  else if (event.shiftKey && index === 1) { event.preventDefault(); navToggle.focus(); }
  else if (!event.shiftKey && index === 0) { event.preventDefault(); focusable[1].focus(); }
  else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); navToggle.focus(); }
});
// Bring the current page into the navigation's own scroll area, without moving the document.
const currentPage = sidebar.querySelector('[aria-current="page"]');
if (currentPage && !mobile.matches) {
  const current = currentPage.getBoundingClientRect();
  const rail = sidebar.getBoundingClientRect();
  if (current.bottom > rail.bottom - 40) sidebar.scrollTop += current.bottom - rail.bottom + 80;
}

const outline = document.querySelector('.outline');
const toc = document.querySelector('#page-toc');
const headingLinks = [...document.querySelectorAll('.toc-link')];
const headings = headingLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));
function recoverOutline() {
  if (!outline) return;
  outline.open = desktop.matches;
  const summary = outline.querySelector('summary');
  summary.tabIndex = desktop.matches ? -1 : 0;
  summary.setAttribute('aria-disabled', String(desktop.matches));
}
desktop.addEventListener('change', recoverOutline);
recoverOutline();
outline?.querySelector('summary').addEventListener('click', (event) => { if (desktop.matches) event.preventDefault(); });
toc?.addEventListener('click', (event) => { if (!desktop.matches && event.target.closest('a')) outline.open = false; });
let selected;
let scheduled = false;
let progress = -1;
function updateScroll() {
  scheduled = false;
  const threshold = parseFloat(getComputedStyle(root).getPropertyValue('--header-height')) + (desktop.matches ? 52 : 90);
  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].getBoundingClientRect().top <= threshold) index = i;
    else break;
  }
  if (scrollY + innerHeight >= document.documentElement.scrollHeight - 4 && scrollY > 0) index = headings.length - 1;
  const active = headingLinks[index];
  if (selected !== active) {
    selected?.removeAttribute('aria-current');
    selected = active;
    active?.setAttribute('aria-current', 'location');
    if (active && outline.open) {
      const item = active.getBoundingClientRect();
      const rail = toc.getBoundingClientRect();
      if (item.top < rail.top + 6 || item.bottom > rail.bottom - 6) {
        toc.scrollTo({ top: toc.scrollTop + item.top - rail.top - toc.clientHeight / 2 + item.height / 2, behavior: motion.matches ? 'auto' : 'smooth' });
      }
    }
  }
  const height = document.documentElement.scrollHeight - innerHeight;
  const next = height > 0 ? Math.round(Math.min(1, Math.max(0, scrollY / height)) * 1000) / 1000 : 0;
  if (next !== progress) { root.style.setProperty('--reading-progress', next); progress = next; }
}
function scheduleScroll() { if (!scheduled) { scheduled = true; requestAnimationFrame(updateScroll); } }
addEventListener('scroll', scheduleScroll, { passive: true });
addEventListener('resize', scheduleScroll, { passive: true });
addEventListener('hashchange', scheduleScroll);
updateScroll();

for (const button of document.querySelectorAll('.copy-code')) {
  button.addEventListener('click', async () => {
    const text = button.closest('.code-block').querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      button.setAttribute('aria-label', 'Code copied');
      announce('Code copied to clipboard');
      setTimeout(() => { button.textContent = 'Copy'; button.setAttribute('aria-label', 'Copy code'); }, 2200);
    } catch { announce('Could not copy automatically. Select the code and copy it.'); }
  });
}

let searchModule;
async function openSearch() {
  try {
    if (mobile.matches) navigation(false);
    searchModule ||= import('./search.js').catch((error) => { searchModule = null; throw error; });
    const { openSearch: open } = await searchModule;
    open();
  } catch { diagnostic('Search could not load'); announce('Search could not load. Please try again.'); }
}
document.querySelector('[data-search-trigger]').addEventListener('click', openSearch);
document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
    event.preventDefault();
    openSearch();
  }
});
const shortcut = document.querySelector('[data-search-shortcut]');
if (/Mac|iPhone|iPad/.test(navigator.platform)) shortcut.textContent = '⌘ K';

const intro = document.querySelector('[data-typeflow]');
if (intro && !motion.matches && !location.hash) {
  const text = intro.textContent;
  import('@staticcanvas/typeflow').then(({ TypeFlow }) => {
    if (motion.matches) return;
    TypeFlow.type(intro, text, { typeStyle: 'word-fade', speed: 6, wordStagger: 8, wordFadeDuration: 200, cursor: '', cursorBlink: false, respectReducedMotion: true });
  }).catch(() => { intro.textContent = text; });
}

// Keep the existing diagram rendering; text and code remain readable if the CDN is unavailable.
if (document.querySelector('pre.mermaid')) {
  const diagrams = [...document.querySelectorAll('pre.mermaid')].map((node) => ({ node, source: node.textContent }));
  import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs').then(async ({ default: mermaid }) => {
    let pending = Promise.resolve();
    const render = () => {
      pending = pending.catch(() => {}).then(async () => {
        for (const { node, source } of diagrams) { node.textContent = source; node.removeAttribute('data-processed'); }
        mermaid.initialize({ startOnLoad: false, theme: dark() ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: getComputedStyle(document.body).fontFamily });
        await mermaid.run({ nodes: diagrams.map(({ node }) => node) });
        scheduleScroll();
      });
      return pending;
    };
    document.addEventListener('docs-theme-change', () => { render().catch(() => diagnostic('Could not update diagram theme')); });
    await render();
  }).catch(() => diagnostic('Diagram renderer unavailable; showing diagram source'));
}
