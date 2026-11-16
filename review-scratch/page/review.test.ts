import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnnotator, MUTATION_DELAY, POPOVER_ID, type Annotator } from '../lib/annotator';

const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
let annotator: Annotator;
let stop: (() => void) | undefined;
function load(html: string): void {
  document.body.innerHTML = html;
  annotator = createAnnotator(document, OPTIONS);
  stop = annotator.start();
}
const marks = () => [...document.querySelectorAll<HTMLElement>('.zoneshift')];
const settle = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50); };
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('review: forbidden containers', () => {
  it.each([
    '<svg><text x="0" y="10">1:30 AM UTC</text></svg>',
    '<svg><title>1:30 AM UTC</title><rect width="5" height="5"></rect></svg>',
    '<datalist id="d"><option>1:30 AM UTC</option></datalist>',
    '<math><mtext>1:30 AM UTC</mtext></math>',
    '<div contenteditable="true"><p>Edit me</p><span contenteditable="false">1:30 AM UTC</span></div>',
    '<div role="textbox" aria-multiline="true">1:30 AM UTC</div>',
  ])('leaves %s alone', (html) => {
    load(html);
    expect(marks()).toHaveLength(0);
    expect(document.body.innerHTML).toBe(html);
  });

  it('svg: inserted span is in the XHTML namespace inside <text>', () => {
    load('<svg><text x="0" y="10">1:30 AM UTC</text></svg>');
    const m = document.querySelector('svg .zoneshift');
    expect(m?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('content that becomes editable later still contains marks (saved HTML would include them)', () => {
    load('<div id="doc"><p>Meet at 1:30 AM UTC.</p></div>');
    const doc = document.getElementById('doc')!;
    doc.contentEditable = 'true';
    expect(doc.innerHTML).not.toContain('zoneshift');
  });
});

describe('review: framework-owned text nodes', () => {
  it('a framework that kept a reference to the text node can still remove it', () => {
    document.body.innerHTML = '<p id="p"></p>';
    const p = document.getElementById('p')!;
    const t = document.createTextNode('Updated 1:30 AM UTC');
    p.append(t);
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    expect(() => p.removeChild(t)).not.toThrow();
  });
  it('a framework that updates its text node in place is still shown', () => {
    document.body.innerHTML = '<p id="p"></p>';
    const p = document.getElementById('p')!;
    const t = document.createTextNode('Updated 1:30 AM UTC');
    p.append(t);
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    t.data = 'Updated 2:45 AM UTC';
    expect(p.textContent).toContain('6:45 PM');
  });
});

describe('review: split text', () => {
  it('does not convert a zone whose offset is in the next text node', () => {
    document.body.innerHTML = '<p id="p"></p>';
    const p = document.getElementById('p')!;
    p.append('Call at 10:00 AM UTC', '+2 tomorrow');
    annotator = createAnnotator(document, OPTIONS);
    stop = annotator.start();
    // Whole text reads 10:00 UTC+2 = 00:00 PST; annotator shows 2:00 AM PST (2 hours wrong)
    expect(p.textContent).toBe('Call at 10:00 AM UTC+2 tomorrow');
  });
});

describe('review: keyboard', () => {
  it('Enter on the icon does not reach page key handlers', () => {
    load('<div id="row" tabindex="0">Ticket opened 1:30 AM UTC</div>');
    const onKey = vi.fn();
    document.getElementById('row')!.addEventListener('keydown', onKey);
    document.querySelector<HTMLElement>('.zoneshift-icon')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onKey).not.toHaveBeenCalled();
  });
  it('returns focus to the icon after Escape', () => {
    load('<p>At 1:30 AM UTC.</p>');
    const icon = document.querySelector<HTMLElement>('.zoneshift-icon')!;
    icon.focus();
    icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.getElementById(POPOVER_ID)).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(icon);
  });
});

describe('review: observer cost and memory', () => {
  it('a ticking clock does not grow internal state', async () => {
    vi.useFakeTimers();
    const isMark = (k: unknown) => k instanceof HTMLElement && k.className === 'zoneshift';
    const origSet = Map.prototype.set, origDel = Map.prototype.delete;
    let live = 0;
    vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, k, v) { if (isMark(k) && !this.has(k)) live++; return origSet.call(this, k, v); });
    vi.spyOn(Map.prototype, 'delete').mockImplementation(function (this: Map<unknown, unknown>, k) { const had = this.has(k); if (isMark(k) && had) live--; return origDel.call(this, k); });
    load('<p id="clock"></p>');
    const clock = document.getElementById('clock')!;
    for (let i = 0; i < 50; i++) { clock.textContent = `Server time 1:${String(i).padStart(2, '0')} AM UTC`; await settle(); }
    expect(document.querySelectorAll('.zoneshift')).toHaveLength(1);
    expect(live).toBeLessThan(5);
  });
});
