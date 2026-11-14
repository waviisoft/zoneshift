import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnotator, MUTATION_DELAY, POPOVER_ID, type Annotator } from '../lib/annotator';

const OPTIONS = {
  targetZone: 'America/Los_Angeles',
  now: Date.UTC(2026, 10, 11, 20, 0, 0),
};

let annotator: Annotator;
let stop: (() => void) | undefined;

function load(html: string): void {
  document.body.innerHTML = html;
  annotator = createAnnotator(document, OPTIONS);
  stop = annotator.start();
}

const marks = () => [...document.querySelectorAll<HTMLElement>('.zoneshift')];
const shown = () => marks().map((m) => `${m.dataset.zsState}: ${m.firstElementChild!.textContent}`);
const icon = (mark: HTMLElement) => mark.querySelector<HTMLElement>('.zoneshift-icon')!;
const popover = () => document.getElementById(POPOVER_ID);
const popoverButton = (label: string) =>
  [...popover()!.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent === label)!;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('marking', () => {
  it('converts prose times and adds an icon after them', () => {
    load('<p>Starts Friday, November 13, 2026, at 1:30 AM UTC sharp.</p>');
    expect(document.body.textContent).toBe('Starts Thursday, November 12, 2026, at 5:30 PM PST sharp.');
    const [mark] = marks();
    expect(mark!.dataset.zsState).toBe('converted');
    expect(mark!.lastElementChild).toBe(icon(mark!));
    expect(icon(mark!).getAttribute('role')).toBe('button');
    expect(icon(mark!).tabIndex).toBe(0);
    expect(icon(mark!).getAttribute('aria-label')).toContain('Original: Friday, November 13, 2026, at 1:30 AM UTC');
  });

  it('does not restyle the text', () => {
    load('<p>At 1:30 AM UTC.</p>');
    expect(marks()[0]!.getAttribute('style')).toBeNull();
    expect(marks()[0]!.firstElementChild!.getAttribute('style')).toBeNull();
  });

  it('records low confidence for ambiguous zones', () => {
    load('<p>Nov 20, 2026 9:00 AM CST</p>');
    expect(marks()[0]!.dataset.zsConfidence).toBe('low');
  });

  it.each(['code', 'pre', 'samp', 'kbd'])('leaves times in <%s> as written until asked', (tag) => {
    load(`<${tag}>job ran Nov 13, 2026 1:30 AM UTC ok</${tag}>`);
    expect(shown()).toEqual(['original: Nov 13, 2026 1:30 AM UTC']);
  });

  it('leaves ISO 8601 timestamps as written, even in prose', () => {
    load('<p>Built at 2026-11-13T04:10:09Z by CI.</p>');
    expect(document.body.textContent).toBe('Built at 2026-11-13T04:10:09Z by CI.');
    expect(shown()).toEqual(['original: 2026-11-13T04:10:09Z']);
  });

  it('marks every timestamp in a log block', () => {
    load('<pre>2026-11-13T01:30:00Z INFO a\n2026-11-13T01:30:02Z WARN b\n</pre>');
    expect(marks()).toHaveLength(2);
    expect(document.querySelector('pre')!.textContent).toBe(
      '2026-11-13T01:30:00Z INFO a\n2026-11-13T01:30:02Z WARN b\n',
    );
  });

  it.each([
    '<textarea>1:30 AM UTC</textarea>',
    '<script type="text/plain">1:30 AM UTC</script>',
    '<style>/* 1:30 AM UTC */</style>',
    '<time datetime="2026-11-13T01:30Z">1:30 AM UTC</time>',
    '<div contenteditable="true">1:30 AM UTC</div>',
    '<p>The show starts at 7:00 PM.</p>',
    // Foreign content: HTML elements inside SVG or MathML would not render.
    '<svg><text x="0" y="10">1:30 AM UTC</text></svg>',
    '<svg><title>1:30 AM UTC</title><rect width="5" height="5"></rect></svg>',
    '<svg><foreignObject><p>1:30 AM UTC</p></foreignObject></svg>',
    '<math><mtext>1:30 AM UTC</mtext></math>',
    // Form controls, their options and values, and text that is not rendered.
    '<datalist id="d"><option>1:30 AM UTC</option></datalist>',
    '<select><option>1:30 AM UTC</option><optgroup label="x"><option>2:30 AM UTC</option></optgroup></select>',
    '<input value="1:30 AM UTC">',
    '<button value="1:30 AM UTC">Send</button>',
    '<noscript>1:30 AM UTC</noscript>',
    '<title>1:30 AM UTC</title>',
    // Editors, including non-editable islands inside them and custom text boxes.
    '<div contenteditable="true"><p>Edit me</p><span contenteditable="false">1:30 AM UTC</span></div>',
    '<div contenteditable="plaintext-only">1:30 AM UTC</div>',
    '<div role="textbox" aria-multiline="true">1:30 AM UTC</div>',
    // A time that continues into the next element: reading it alone would be wrong.
    '<p>Call at <b>10:00 AM UTC</b>+2 tomorrow</p>',
    '<p>From 1:30<b>–3:00 PM UTC</b></p>',
    '<p>Built 2026-11-13T<b>01:30:00Z</b></p>',
  ])('leaves %s alone', (html) => {
    load(html);
    expect(marks()).toHaveLength(0);
    expect(document.body.innerHTML).toBe(html);
  });

  it('wraps the text in elements no page rule for span or div can match', () => {
    load('<p class="meta"><span>by Bob</span> posted 1:30 AM UTC</p>');
    const p = document.querySelector('p')!;
    // One run replaces the one text node, so a flex or grid container keeps one item.
    expect([...p.childNodes].map((n) => n.nodeName.toLowerCase())).toEqual(['span', 'zoneshift-run']);
    expect([...p.querySelectorAll('zoneshift-run *')].map((e) => e.localName)).toEqual([
      'zoneshift-mark',
      'zoneshift-text',
      'zoneshift-icon',
    ]);
    expect(p.querySelectorAll('span')).toHaveLength(1);
  });

  it('skips form controls on XHTML pages, where tag names are lower case', () => {
    document.body.innerHTML = '<textarea>Meet at 1:30 AM UTC</textarea><p>At 1:30 AM UTC.</p>';
    // In an XHTML document tagName keeps the source case.
    Object.defineProperty(document.querySelector('textarea')!, 'tagName', { value: 'textarea' });
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    expect(document.querySelector('textarea')!.innerHTML).toBe('Meet at 1:30 AM UTC');
    expect(marks()).toHaveLength(1);
  });

  it('does not mark its own output twice', () => {
    load('<p>At 1:30 AM UTC.</p>');
    annotator.annotate(document.body);
    annotator.annotate(document.body);
    expect(marks()).toHaveLength(1);
  });
});

describe('text-node boundaries', () => {
  const split = (...parts: string[]) => {
    document.body.innerHTML = '<p id="p"></p>';
    const p = document.getElementById('p')!;
    p.append(...parts);
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    return p;
  };

  it('leaves a time alone when its zone offset continues in the next text node', () => {
    // Read whole, this is 10:00 UTC+2, which is 12:00 AM PST, not 2:00 AM PST.
    const p = split('Call at 10:00 AM UTC', '+2 tomorrow');
    expect(p.textContent).toBe('Call at 10:00 AM UTC+2 tomorrow');
    expect(marks()).toHaveLength(0);
  });

  it('leaves a time alone when it ends a range that starts in the previous text node', () => {
    const p = split('From 1:30', '–3:00 PM UTC');
    expect(p.textContent).toBe('From 1:30–3:00 PM UTC');
  });

  it('still converts a time followed by ordinary text in the next text node', () => {
    const p = split('Call at 10:00 AM UTC', ' sharp.');
    expect(p.textContent).toBe('Call at 2:00 AM PST sharp.');
  });

  it('follows the engine when the next text node makes the time unreadable', () => {
    // The engine leaves "10:00 AM UTC tomorrow" alone (an unread relative date).
    const p = split('Call at 10:00 AM UTC', ' tomorrow');
    expect(p.textContent).toBe('Call at 10:00 AM UTC tomorrow');
  });

  it('still converts a time whose date sits in the previous element', () => {
    document.body.innerHTML = '<p><b>Friday</b> at 1:30 AM UTC</p>';
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    expect(shown()).toEqual(['converted: 5:30 PM PST (−1 day)']);
  });

  it('still converts a time whose date sits in the previous text node', () => {
    const p = split('Nov 13 at ', '1:30 AM UTC');
    expect(p.textContent).toBe('Nov 13 at 5:30 PM PST (−1 day)');
  });

  it('leaves a time alone when the date before it falls in a different daylight-saving period', () => {
    // Read with today's date this is 5:30 AM PST; on July 1 it is 6:30 AM PDT.
    const p = split('Jul 1, 2026 at ', '1:30 PM UTC');
    expect(p.textContent).toBe('Jul 1, 2026 at 1:30 PM UTC');
  });

  it('undoes a conversion when text added next to it changes the reading', async () => {
    vi.useFakeTimers();
    const p = split('Call at 10:00 AM UTC');
    expect(p.textContent).toBe('Call at 2:00 AM PST');
    p.append('+2 tomorrow');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50);
    expect(p.textContent).toBe('Call at 10:00 AM UTC+2 tomorrow');
    expect(marks()).toHaveLength(0);
  });
});

describe('switching', () => {
  it('toggles one time without touching the others', () => {
    load('<p>At 1:30 AM UTC and 2:30 AM UTC.</p>');
    annotator.setState(marks()[0]!, 'original');
    expect(shown()).toEqual(['original: 1:30 AM UTC', 'converted: 6:30 PM PST (−1 day)']);
    expect(icon(marks()[0]!).getAttribute('aria-label')).toBe('Local time: 5:30 PM PST (−1 day)');
    annotator.setState(marks()[0]!, 'converted');
    expect(shown()[0]).toBe('converted: 5:30 PM PST (−1 day)');
  });

  it('converts everything on the page, then restores every original', () => {
    const html = '<p>At 1:30 AM UTC.</p><pre>2026-11-13T01:30:00Z up</pre>';
    load(html);
    annotator.setAll('converted');
    expect(shown()).toEqual(['converted: 5:30 PM PST (−1 day)', 'converted: 2026-11-12T17:30:00-08:00']);
    annotator.setAll('original');
    expect(document.body.textContent).toBe('At 1:30 AM UTC.2026-11-13T01:30:00Z up');
  });
});

describe('popover', () => {
  beforeEach(() => load('<p><a href="#elsewhere">Nov 20, 2026 9:00 AM CST</a></p><pre>2026-11-13T01:30:00Z up</pre>'));

  const click = (el: HTMLElement) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    el.dispatchEvent(event);
    return event;
  };

  it('opens from the icon with the original, the local time and the reading', () => {
    click(icon(marks()[0]!));
    const text = [...popover()!.shadowRoot!.querySelectorAll('dd')].map((d) => d.textContent);
    expect(text).toEqual(['Nov 20, 2026 9:00 AM CST', 'Nov 20, 2026 7:00 AM PST', 'Central Standard Time']);
    expect(popover()!.shadowRoot!.querySelector('.note')!.textContent).toMatch(/ambiguous/);
  });

  it('does not follow a link the time sits in', () => {
    const event = click(icon(marks()[0]!));
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens with Enter or Space for keyboard users', () => {
    for (const key of ['Enter', ' ']) {
      icon(marks()[1]!).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(popover()).not.toBeNull();
      annotator.closePopover();
    }
  });

  it('offers the action that fits the current state', () => {
    click(icon(marks()[0]!));
    expect(popoverButton('Show original here')).toBeDefined();
    annotator.closePopover();
    click(icon(marks()[1]!));
    expect(popoverButton('Convert to local time')).toBeDefined();
  });

  it('switches one time and closes', () => {
    click(icon(marks()[1]!));
    popoverButton('Convert to local time').click();
    expect(shown()).toEqual(['converted: Nov 20, 2026 7:00 AM PST', 'converted: 2026-11-12T17:30:00-08:00']);
    expect(popover()).toBeNull();
  });

  it('switches the whole page in either direction', () => {
    click(icon(marks()[1]!));
    popoverButton('Convert all times on this page').click();
    expect(marks().every((m) => m.dataset.zsState === 'converted')).toBe(true);
    click(icon(marks()[0]!));
    popoverButton('Show all originals on this page').click();
    expect(marks().every((m) => m.dataset.zsState === 'original')).toBe(true);
  });

  const key = (el: Element | Document, k: string, type = 'keydown', init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, composed: true, ...init });
    el.dispatchEvent(event);
    return event;
  };
  const focused = () => {
    const active = document.activeElement;
    return active?.shadowRoot?.activeElement ?? active;
  };

  it('keeps Enter, Space and pointer presses on the icon from the page', () => {
    const link = document.querySelector('a')!;
    const seen: string[] = [];
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      link.addEventListener(type, () => seen.push(type));
    }
    const i = icon(marks()[0]!);
    for (const k of ['Enter', ' ']) {
      expect(key(i, k).defaultPrevented).toBe(true);
      expect(key(i, k, 'keyup').defaultPrevented).toBe(true);
      annotator.closePopover();
    }
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      i.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
    }
    expect(seen).toEqual([]);
    // Other keys on the icon, and everything elsewhere in the link, still reach the page.
    key(i, 'a');
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(seen).toEqual(['keydown', 'mousedown']);
  });

  it('returns focus to the icon after Escape and after an action', () => {
    const i = icon(marks()[0]!);
    i.focus();
    key(i, 'Enter');
    expect(focused()).toBe(popoverButton('Show original here'));
    key(focused()!, 'Escape');
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(i);

    key(i, 'Enter');
    popoverButton('Show original here').click();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(i);
  });

  it('keeps Tab and Shift+Tab inside the popover', () => {
    const i = icon(marks()[0]!);
    i.focus();
    key(i, 'Enter');
    const [first, , last] = [...popover()!.shadowRoot!.querySelectorAll('button')];
    expect(key(focused()!, 'Tab', 'keydown', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(focused()).toBe(last);
    key(focused()!, 'Tab');
    expect(focused()).toBe(first);
    expect(popover()).not.toBeNull();
  });

  it('keeps keys pressed in the popover from the page', () => {
    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    click(icon(marks()[0]!));
    key(focused()!, 'j');
    document.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('reports whether its popover is open', () => {
    const i = icon(marks()[0]!);
    expect(i.getAttribute('aria-haspopup')).toBe('dialog');
    expect(i.getAttribute('aria-expanded')).toBe('false');
    click(i);
    expect(i.getAttribute('aria-expanded')).toBe('true');
    click(i);
    expect(popover()).toBeNull();
    expect(i.getAttribute('aria-expanded')).toBe('false');
  });

  it('only takes Escape when the popover is open', () => {
    const onKey = vi.fn();
    document.body.addEventListener('keydown', onKey);
    click(icon(marks()[0]!));
    expect(key(focused()!, 'Escape').defaultPrevented).toBe(true);
    expect(onKey).not.toHaveBeenCalled();
    // Closed: a second Escape is the page's (to close its own dialog, say).
    expect(key(document.body, 'Escape').defaultPrevented).toBe(false);
    expect(onKey).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('keydown', onKey);
  });

  it('closes when the page or a container around the icon scrolls, not when another box does', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="other"></div>');
    click(icon(marks()[0]!));
    document.getElementById('other')!.dispatchEvent(new Event('scroll'));
    expect(popover()).not.toBeNull();
    document.querySelector('p')!.dispatchEvent(new Event('scroll'));
    expect(popover()).toBeNull();
    click(icon(marks()[0]!));
    document.dispatchEvent(new Event('scroll'));
    expect(popover()).toBeNull();
  });

  it('closes on Escape and on a click elsewhere', () => {
    click(icon(marks()[0]!));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover()).toBeNull();
    click(icon(marks()[0]!));
    click(document.body);
    expect(popover()).toBeNull();
  });

  it('shows one popover at a time and never annotates it', () => {
    click(icon(marks()[0]!));
    click(icon(marks()[1]!));
    expect(document.querySelectorAll(`#${POPOVER_ID}`)).toHaveLength(1);
    annotator.annotate(document.documentElement);
    expect(marks()).toHaveLength(2);
  });
});

describe('content added later', () => {
  const settle = async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50);
  };

  beforeEach(() => vi.useFakeTimers());

  it('is annotated with the default states', async () => {
    load('<div id="feed"></div>');
    document.getElementById('feed')!.innerHTML = '<p>At 1:30 AM UTC.</p><code>2026-11-13T01:30:00Z</code>';
    await settle();
    expect(shown()).toEqual(['converted: 5:30 PM PST (−1 day)', 'original: 2026-11-13T01:30:00Z']);
  });

  it('follows an earlier page-wide choice', async () => {
    load('<pre id="log">2026-11-13T01:30:00Z up\n</pre>');
    annotator.setAll('converted');
    document.getElementById('log')!.append('2026-11-13T09:00:00Z down\n');
    await settle();
    expect(shown()).toEqual(['converted: 2026-11-12T17:30:00-08:00', 'converted: 2026-11-13T01:00:00-08:00']);
  });

  it('is annotated after the site replaces <body>', async () => {
    load('<p>First 1:30 AM UTC</p>');
    const body = document.createElement('body');
    body.innerHTML = '<p>Second 2:30 AM UTC</p>';
    document.body.replaceWith(body);
    await settle();
    expect(shown()).toEqual(['converted: 6:30 PM PST (−1 day)']);
    document.body.insertAdjacentHTML('beforeend', '<p>Later 3:30 AM UTC</p>');
    await settle();
    expect(marks()).toHaveLength(2);
  });

  it('does not keep marks the page has thrown away', async () => {
    // Every Map or Set entry that holds one of the annotator's elements.
    const held = new Set<unknown>();
    const own = (v: unknown) =>
      v instanceof Element && (v.localName.startsWith('zoneshift-') || v.classList.contains('zoneshift'));
    const mapSet = Map.prototype.set;
    const setAdd = Set.prototype.add;
    vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, k, v) {
      if (own(k) || own(v)) held.add(k);
      return mapSet.call(this, k, v);
    });
    vi.spyOn(Set.prototype, 'add').mockImplementation(function (this: Set<unknown>, v) {
      if (this !== held && own(v)) held.add(v);
      return setAdd.call(this, v);
    });
    load('<p id="clock"></p>');
    const clock = document.getElementById('clock')!;
    for (let i = 0; i < 50; i++) {
      clock.textContent = `Server time 1:${String(i).padStart(2, '0')} AM UTC`;
      await settle();
    }
    vi.restoreAllMocks();
    expect(marks()).toHaveLength(1);
    expect(held.size).toBe(0);
  });

  it('stops watching when stopped', async () => {
    load('<div id="feed"></div>');
    stop!();
    stop = undefined;
    document.getElementById('feed')!.innerHTML = '<p>At 1:30 AM UTC.</p>';
    await settle();
    expect(marks()).toHaveLength(0);
  });

  it('puts the page text back when stopped', () => {
    load('<p id="p"></p>');
    const p = document.getElementById('p')!;
    const text = document.createTextNode('At 1:30 AM UTC.');
    p.append(text);
    annotator.annotate(p);
    expect(marks()).toHaveLength(1);
    stop!();
    stop = undefined;
    expect(p.innerHTML).toBe('At 1:30 AM UTC.');
    expect(p.firstChild).toBe(text);
  });
});

describe('editable content', () => {
  const settle = async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50);
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    (document as { designMode: string }).designMode = 'off';
  });

  it('gets the page text back, node for node, when it becomes editable', async () => {
    load('<div id="doc"><p id="p"></p><pre>2026-11-13T01:30:00Z up</pre></div>');
    const doc = document.getElementById('doc')!;
    const text = document.createTextNode('Meet at 1:30 AM UTC.');
    document.getElementById('p')!.append(text);
    await settle();
    expect(marks()).toHaveLength(2);
    doc.contentEditable = 'true';
    await Promise.resolve();
    expect(doc.innerHTML).toBe('<p id="p">Meet at 1:30 AM UTC.</p><pre>2026-11-13T01:30:00Z up</pre>');
    expect(document.getElementById('p')!.firstChild).toBe(text);
    // Not annotated again while editable.
    await settle();
    expect(marks()).toHaveLength(0);
    // Annotated again once editing ends.
    doc.removeAttribute('contenteditable');
    await settle();
    expect(marks()).toHaveLength(2);
  });

  it('gets the page text back when the document enters design mode', () => {
    load('<p>Meet at 1:30 AM UTC.</p>');
    (document as { designMode: string }).designMode = 'on';
    document.querySelector('p')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    expect(document.body.innerHTML).toBe('<p>Meet at 1:30 AM UTC.</p>');
  });

  it('gets the page text back when focus enters an editing host', () => {
    load('<div id="ed"><p>Meet at 1:30 AM UTC.</p></div>');
    const ed = document.getElementById('ed')!;
    // Made editable by a means the observer cannot see (a style, say).
    Object.defineProperty(ed, 'isContentEditable', { value: true });
    ed.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    expect(ed.innerHTML).toBe('<p>Meet at 1:30 AM UTC.</p>');
  });

  it('gets the page text back when annotated content is moved into an editor', async () => {
    load('<div id="ed" contenteditable="true"></div><p id="p">Meet at 1:30 AM UTC.</p>');
    document.getElementById('ed')!.append(document.getElementById('p')!);
    await Promise.resolve();
    expect(document.getElementById('ed')!.innerHTML).toBe('<p id="p">Meet at 1:30 AM UTC.</p>');
  });
});

describe('other documents', () => {
  it.each([
    ['an XML document', '<root><when>1:30 AM UTC</when></root>', 'application/xml'],
    ['an SVG document', '<svg xmlns="http://www.w3.org/2000/svg"><text>1:30 AM UTC</text></svg>', 'image/svg+xml'],
  ] as const)('leaves %s alone without failing', (_, source, type) => {
    const doc = new DOMParser().parseFromString(source, type);
    const before = new XMLSerializer().serializeToString(doc);
    const a = createAnnotator(doc, OPTIONS);
    expect(() => a.start()()).not.toThrow();
    expect(() => a.annotate(doc.documentElement)).not.toThrow();
    expect(new XMLSerializer().serializeToString(doc)).toBe(before);
  });
});
