import { defineConfig } from 'wxt';

export default defineConfig({
  // No permissions: the content script needs none, and each one must be
  // agreed with the owner first (storage arrives with settings).
  manifest: ({ browser }) => ({
    name: 'Zoneshift',
    description: 'Shows dates and times on web pages in your own time zone.',
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'zoneshift@waviisoft.com',
          // The extension makes no network requests and collects nothing.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
