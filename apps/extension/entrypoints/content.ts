import { findConversions } from '@zoneshift/core';

/**
 * Placeholder annotator: converts text once at page load and shows the
 * original in a tooltip. The popover, per-site settings, feedback flow and
 * handling of dynamically updated pages are not built yet (see docs/design.md).
 */

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'TIME']);

function shouldSkip(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable || el.classList.contains('zoneshift')) return true;
  }
  return false;
}

function annotate(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.data;
    if (!/\d/.test(text) || shouldSkip(node)) continue;
    const conversions = findConversions(text);
    if (conversions.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const c of conversions) {
      fragment.append(text.slice(pos, c.index));
      const span = document.createElement('span');
      span.className = 'zoneshift';
      span.dataset.zoneshiftOriginal = c.original;
      span.dataset.zoneshiftConfidence = c.confidence;
      span.title = `Original: ${c.original} (read as ${c.sourceDescription})`;
      span.style.textDecoration = `underline dotted${c.confidence === 'low' ? ' orange' : ''}`;
      span.textContent = c.converted;
      fragment.append(span);
      pos = c.index + c.length;
    }
    fragment.append(text.slice(pos));
    node.replaceWith(fragment);
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    annotate(document.body);
  },
});
