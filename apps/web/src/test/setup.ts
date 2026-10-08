import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom has no layout engine.
Element.prototype.scrollIntoView = function scrollIntoView() {};
window.scrollTo = (() => {}) as typeof window.scrollTo;
