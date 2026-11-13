import { findConversions, type Conversion } from '@zoneshift/core';
import './style.css';

/**
 * Early annotator. Every recognised time gets a clock icon after it:
 *  - prose times are converted straight away (solid icon);
 *  - timestamps in code/log blocks and ISO 8601 timestamps are left as
 *    written (hollow icon) until the reader asks for them.
 * The icon opens a popover to switch one time, or every time on the page.
 *
 * Not built yet: settings, per-site memory, feedback, <time> elements.
 */

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'TIME']);
const TECHNICAL = 'code, pre, samp, kbd, tt';

type State = 'converted' | 'original';
const marks = new Map<HTMLElement, Conversion>();
/** Set once the reader picks "all on this page"; applied to content added later. */
let pageState: State | null = null;

function shouldSkip(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable || el.classList.contains('zoneshift')) return true;
    if (el.id === 'zoneshift-popover') return true;
  }
  return false;
}

function setState(mark: HTMLElement, state: State): void {
  const c = marks.get(mark);
  if (!c) return;
  mark.dataset.zsState = state;
  mark.firstElementChild!.textContent = state === 'converted' ? c.converted : c.original;
  mark.lastElementChild!.setAttribute(
    'aria-label',
    state === 'converted' ? `Converted to local time. Original: ${c.original}` : `Local time: ${c.converted}`,
  );
}

function setAll(state: State): void {
  pageState = state;
  for (const mark of marks.keys()) {
    if (mark.isConnected) setState(mark, state);
    else marks.delete(mark);
  }
}

function createMark(c: Conversion, technical: boolean): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'zoneshift';
  mark.dataset.zsConfidence = c.confidence;
  const text = document.createElement('span');
  const icon = document.createElement('span');
  icon.className = 'zoneshift-icon';
  icon.setAttribute('role', 'button');
  icon.tabIndex = 0;
  mark.append(text, icon);
  marks.set(mark, c);
  setState(mark, pageState ?? (technical || c.format === 'iso' ? 'original' : 'converted'));
  return mark;
}

function annotate(root: Node): void {
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  }

  for (const node of nodes) {
    const text = node.data;
    if (!node.isConnected || !/\d/.test(text) || shouldSkip(node)) continue;
    const conversions = findConversions(text);
    if (conversions.length === 0) continue;
    const technical = node.parentElement?.closest(TECHNICAL) != null;

    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const c of conversions) {
      fragment.append(text.slice(pos, c.index), createMark(c, technical));
      pos = c.index + c.length;
    }
    fragment.append(text.slice(pos));
    node.replaceWith(fragment);
  }
}

// ---- Popover ---------------------------------------------------------------

const POPOVER_CSS = `
  :host { all: initial; position: fixed; z-index: 2147483647; }
  .box {
    font: 13px/1.4 system-ui, sans-serif; color: #111827; background: #fff;
    border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 12px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); width: max-content; max-width: min(320px, calc(100vw - 16px));
    box-sizing: border-box;
  }
  dl { margin: 0 0 8px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  dt { color: #6b7280; } dd { margin: 0; overflow-wrap: anywhere; }
  .note { color: #b45309; margin: 0 0 8px; }
  button {
    display: block; width: 100%; margin-top: 6px; padding: 7px 10px; font: inherit; text-align: left;
    color: inherit; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer;
  }
  button:hover { background: #e5e7eb; }
  @media (prefers-color-scheme: dark) {
    .box { color: #f3f4f6; background: #1f2937; border-color: #4b5563; }
    dt { color: #9ca3af; } .note { color: #fbbf24; }
    button { background: #374151; border-color: #4b5563; } button:hover { background: #4b5563; }
  }
`;

let popover: { host: HTMLElement; box: HTMLElement } | null = null;

function closePopover(): void {
  popover?.host.remove();
  popover = null;
}

function openPopover(mark: HTMLElement): void {
  const c = marks.get(mark);
  if (!c) return;
  closePopover();

  const host = document.createElement('div');
  host.id = 'zoneshift-popover';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(POPOVER_CSS);
  shadow.adoptedStyleSheets = [sheet];
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Zoneshift');

  const dl = document.createElement('dl');
  for (const [label, value] of [
    ['Original', c.original],
    ['Local', c.converted],
    ['Read as', c.sourceDescription],
  ] as const) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  box.append(dl);

  if (c.confidence === 'low') {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'The zone label is ambiguous, so this may be wrong.';
    box.append(note);
  }

  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      action();
      closePopover();
    });
    box.append(b);
  };
  const converted = mark.dataset.zsState === 'converted';
  button(converted ? 'Show original here' : 'Convert to local time', () =>
    setState(mark, converted ? 'original' : 'converted'),
  );
  button('Convert all times on this page', () => setAll('converted'));
  button('Show all originals on this page', () => setAll('original'));

  shadow.append(box);
  document.documentElement.append(host);
  popover = { host, box };

  // Place under the icon, kept inside the viewport.
  const anchor = mark.lastElementChild!.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - size.width - 8));
  const below = anchor.bottom + 6;
  const top = below + size.height > window.innerHeight - 8 ? Math.max(8, anchor.top - size.height - 6) : below;
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  (box.querySelector('button') as HTMLElement).focus();
}

function iconFrom(event: Event): HTMLElement | null {
  const target = event.target;
  return target instanceof HTMLElement && target.classList.contains('zoneshift-icon') ? target : null;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    annotate(document.body);

    document.addEventListener(
      'click',
      (event) => {
        const icon = iconFrom(event);
        if (icon) {
          // The time may sit inside a link or button; the icon must not trigger it.
          event.preventDefault();
          event.stopPropagation();
          openPopover(icon.parentElement!);
        } else if (popover && !event.composedPath().includes(popover.host)) {
          closePopover();
        }
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') closePopover();
        const icon = iconFrom(event);
        if (icon && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          openPopover(icon.parentElement!);
        }
      },
      true,
    );
    window.addEventListener('scroll', closePopover, { passive: true, capture: true });

    // Pages that add content later (single-page apps, streaming logs).
    let pending: Node[] = [];
    let scheduled = false;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) pending.push(n);
      if (scheduled || pending.length === 0) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const batch = pending;
        pending = [];
        for (const n of batch) if (n.isConnected) annotate(n);
      }, 200);
    }).observe(document.body, { childList: true, subtree: true });
  },
});
