export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown
    // Escape HTML tags to prevent XSS
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```...```
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="bg-zinc-950 p-3 rounded-lg border border-zinc-800 font-mono text-[11px] overflow-x-auto my-2 text-zinc-200"><code>${code.trim()}</code></pre>`;
  });

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-orange-300">$1</code>');

  // Checkboxes: - [x] or - [ ]
  html = html.replace(/^[\s-]*\[x\]\s*(.+)$/gim, '<div class="flex items-center gap-2 text-zinc-400 line-through my-1"><span class="w-3.5 h-3.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center justify-center text-[10px] font-bold">✓</span><span>$1</span></div>');
  html = html.replace(/^[\s-]*\[ \]\s*(.+)$/gim, '<div class="flex items-center gap-2 text-zinc-200 my-1"><span class="w-3.5 h-3.5 rounded bg-zinc-900 border border-zinc-700"></span><span>$1</span></div>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-sm font-bold text-white mt-3.5 mb-1.5">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-base font-bold text-white mt-4 mb-2">$1</h1>');

  // Images: ![alt](url)
  html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, '<div class="my-2"><img src="$2" alt="$1" class="max-h-48 rounded border border-zinc-800 object-cover" /></div>');

  // Links: [text](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-orange-400 hover:text-orange-300 underline">$1</a>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-white">$1</strong>');
  html = html.replace(/\*(.*?)\*/gim, '<em class="italic text-zinc-300">$1</em>');

  // Unordered list items: * item or - item
  html = html.replace(/^[\s]*[-*]\s+(.*)$/gim, '<li class="ml-4 list-disc text-zinc-300">$1</li>');

  // Paragraphs
  const paragraphs = html.split('\n\n').map(p => {
    if (p.startsWith('<pre') || p.startsWith('<h') || p.startsWith('<div')) return p;
    return `<p class="my-1.5">${p.replace(/\n/g, '<br />')}</p>`;
  });

  return paragraphs.join('');
}
