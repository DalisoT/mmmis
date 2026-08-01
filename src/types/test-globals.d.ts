// Ambient type declarations for Vitest's Assertion type so that
// @testing-library/jest-dom matchers (toBeInTheDocument, toHaveValue,
// toBeDisabled, etc.) are visible to `tsc -b` during the production
// build. The runtime side is registered by `import
// '@testing-library/jest-dom/vitest'` in vitest.setup.ts.
//
// This file is included by tsconfig.app.json (which covers the whole
// src/ tree) but is harmless at runtime because it has no emitted code.

import 'vitest';
import '@testing-library/jest-dom/vitest';
