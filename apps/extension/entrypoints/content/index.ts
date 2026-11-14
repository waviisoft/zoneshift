import { createAnnotator } from '../../lib/annotator';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    const stop = createAnnotator(document).start();
    // The extension was updated, reloaded or removed: stop watching and put
    // the page's own text back, since the icons can no longer respond.
    ctx.onInvalidated(stop);
  },
});
