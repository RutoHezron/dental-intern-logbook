import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom has no layout engine. (Sync tests run in the node environment, without a DOM.)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}
