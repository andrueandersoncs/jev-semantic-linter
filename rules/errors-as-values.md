---
globs:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
---
# Return errors as values

Application functions must return typed Result values instead of throwing.
Callers must inspect the Result discriminant and handle failure at the call site.

An external API may throw only at a boundary that immediately catches the
exception and converts it into an error Result. No exception may escape an
application function.

The executable entrypoint may translate the final Result into console output and
a process exit code. That boundary conversion is error handling, not a thrown
application error.
