// Minimal Web Push shim for the Deno Edge Function runtime.
//
// Wraps the npm `web-push` library via esm.sh so we get the official
// VAPID + payload encryption logic without re-implementing it (the
// Web Push encryption spec is non-trivial and easy to get wrong).
//
// We expose the library's default export directly. The `web-push`
// package ships an object with `setVapidDetails()` and
// `sendNotification()` methods, which is exactly the surface the
// dispatcher needs.
//
// @ts-nocheck
// deno-lint-ignore-file no-explicit-any

import webpushDefault from 'https://esm.sh/web-push@3.6.7';

export const webpush = webpushDefault;