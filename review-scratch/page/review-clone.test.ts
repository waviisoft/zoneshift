import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnnotator, MUTATION_DELAY, POPOVER_ID } from '../lib/annotator';
const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ''; vi.useRealTimers(); });
const settle = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50); };

describe('review: copies of annotated markup', () => {
  it('edit, cancel (restore a snapshot), edit, save: the saved HTML has no marks', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="e"><p>Meeting at 1:30 AM UTC.</p></div>';
    stop = createAnnotator(document, OPTIONS).start();
    const e = document.getElementById('e')!;
    // Edit: a common click-to-edit keeps a snapshot for Cancel.
    e.contentEditable = 'true';
    const snapshot = e.innerHTML;
    await settle();
    // Cancel.
    e.innerHTML = snapshot;
    e.contentEditable = 'false';
    await settle();
    // Edit again, then Save.
    e.contentEditable = 'true';
    await settle();
    expect(e.innerHTML).toBe('<p>Meeting at 1:30 AM UTC.</p>');
  });

  it('a cloned time (carousel loop, template copy) still opens its popover', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="slide"><p>Kick-off 1:30 AM UTC</p></div>';
    stop = createAnnotator(document, OPTIONS).start();
    const copy = document.getElementById('slide')!.cloneNode(true) as HTMLElement;
    copy.id = 'copy';
    document.body.append(copy);
    await settle();
    copy.querySelector<HTMLElement>('.zoneshift-icon')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    expect(document.getElementById(POPOVER_ID)).not.toBeNull();
  });
});
