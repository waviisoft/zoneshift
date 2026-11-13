import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Zoneshift',
    description: 'Shows dates and times on web pages in your own time zone.',
    permissions: ['storage'],
    browser_specific_settings: {
      gecko: {
        id: 'zoneshift@waviisoft.com',
        // The extension makes no network requests and collects nothing.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
