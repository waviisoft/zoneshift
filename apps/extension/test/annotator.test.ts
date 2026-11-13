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
  ])('leaves %s alone', (html) => {
    load(html);
    expect(marks()).toHaveLength(0);
    expect(document.body.innerHTML).toBe(html);
  });

  it('does not mark its own output twice', () => {
    load('<p>At 1:30 AM UTC.</p>');
    annotator.annotate(document.body);
    annotator.annotate(document.body);
    expect(marks()).toHaveLength(1);
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

  it('stops watching when stopped', async () => {
    load('<div id="feed"></div>');
    stop!();
    stop = undefined;
    document.getElementById('feed')!.innerHTML = '<p>At 1:30 AM UTC.</p>';
    await settle();
    expect(marks()).toHaveLength(0);
  });
});
