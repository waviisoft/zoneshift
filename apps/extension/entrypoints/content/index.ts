import { createAnnotator } from '../../lib/annotator';
import { createShadowAnnotator, type Render } from '../../lib/shadow-annotator';
import './style.css';

// Evaluation of #34: VITE_ZS_RENDER=mark|run|inplace builds the shadow-DOM
// prototype instead of the shipping annotator (unset: shipping annotator).
const RENDER = import.meta.env.VITE_ZS_RENDER as Render | 'current' | undefined;
const SHADOW_MODE = (import.meta.env.VITE_ZS_SHADOW_MODE as ShadowRootMode | undefined) ?? 'open';
const STYLE = (import.meta.env.VITE_ZS_STYLE as 'adopted' | 'element' | undefined) ?? 'adopted';
const ORIGINAL = (import.meta.env.VITE_ZS_ORIGINAL as 'unslotted' | 'hidden' | undefined) ?? 'unslotted';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    const annotator =
      RENDER && RENDER !== 'current'
        ? createShadowAnnotator(document, { render: RENDER, shadowMode: SHADOW_MODE, style: STYLE, original: ORIGINAL })
        : createAnnotator(document);
    const stop = annotator.start();
    // The extension was updated, reloaded or removed: stop watching and put
    // the page's own text back, since the icons can no longer respond.
    ctx.onInvalidated(stop);
  },
});
