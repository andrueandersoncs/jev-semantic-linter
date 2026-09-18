---
globs:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
---
# Keep operational policies with their operations

Keep timeout, concurrency, retry, and logging policy beside the integration or workflow that owns the operation. Do not create or apply a global retry-everything helper.

Code that retries an external state-changing operation must explicitly state why repeated execution is idempotent or otherwise safe.
