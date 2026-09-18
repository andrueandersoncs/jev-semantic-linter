---
globs:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
---
# Adapt Promises once at integration boundaries

Wrap each Promise-based SDK in a dedicated adapter. When rejection is expected, use `Effect.tryPromise`, start the SDK call inside its callback, deliberately map the rejection to a specific failure, and preserve the original cause. Pass the cancellation signal when the SDK supports cancellation.

Workflows must consume the adapter's Effect instead of repeatedly converting between Promises and Effects.
