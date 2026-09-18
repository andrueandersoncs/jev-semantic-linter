---
globs:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
---
# Give runtimes, resources, and background tasks an owner

Compose long-lived dependencies at application startup or framework lifecycle boundaries, and reuse shared Layer instances instead of rebuilding pools per request. Give every resource scoped cleanup and every background task an explicit lifetime and shutdown path. Layer memoization applies only when the same Layer instance is reused within one construction context.
