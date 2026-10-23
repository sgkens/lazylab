import { HawkSearch } from '@staticcanvas/hawk';
import { createHawkAnimationTypeflow } from '@staticcanvas/hawk/animation-typeflow';
import { TypeFlow } from '@staticcanvas/typeflow';

const driver = createHawkAnimationTypeflow(TypeFlow, {
  title: { typeStyle: 'word-fade', speed: 3, wordStagger: 8, wordFadeDuration: 140 },
  anchorTitle: { typeStyle: 'word-fade', speed: 3, wordStagger: 8, wordFadeDuration: 140 },
  content: { typeStyle: 'word-fade', speed: 1, wordStagger: 2, wordFadeDuration: 120 }
});
const search = new HawkSearch({
  index: new URL('../pagefind/', import.meta.url).pathname,
  // The docs shell owns its trigger and shortcuts, including lazy loading and focus return.
  triggerSelector: '[data-hawk-unused-trigger]', hotkeys: { open: false, slash: false, escape: true },
  theme: { name: 'lazylab', apply(element) { element.dataset.hawkTheme = 'lazylab'; } },
  animation: driver, revealAnimation: 'scale-fade', revealDuration: 180,
  resultsReveal: true, params: { density: 'medium', allowDensityToggle: false },
  headerControls: { density: false },
  strings: { title: 'Search documentation', placeholder: 'Search lazylab docs…' },
  contentSelector: '[data-pagefind-body]',
  onClose() { document.querySelector('[data-search-trigger]').focus({ preventScroll: true }); }
});
export function openSearch() { search.open(); }
