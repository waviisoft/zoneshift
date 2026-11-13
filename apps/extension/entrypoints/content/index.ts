import { createAnnotator } from '../../lib/annotator';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    createAnnotator(document).start();
  },
});
