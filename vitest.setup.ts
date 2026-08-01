// Test setup — runs before every test file.
// Pulls in @testing-library/jest-dom matchers (toBeInTheDocument, etc.).
import '@testing-library/jest-dom/vitest';
import i18n from './src/i18n/config';

// Pin the test language to English so tests don't depend on whatever
// navigator.language reports in jsdom. The actual production app falls
// back to English too, but explicitly setting it here makes the test
// behaviour deterministic across CI environments.
if (i18n.language !== 'en') {
  void i18n.changeLanguage('en');
}
