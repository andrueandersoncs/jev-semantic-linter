**Optimize for how little a reader must understand to change the code safely—not for the fewest lines.** Use these rules as defaults, rather than rigid constraints.

1. **Solve the problem that exists.** Do not add extension points, configuration options, or generic infrastructure for hypothetical future requirements.

2. **Prefer obvious code over clever code.** Use straightforward expressions and familiar language features. Saving a few lines is not worth making the reader decode the implementation.

3. **Name things so their purpose is clear.** Prefer `overdueInvoices` to `filteredData` and `calculateShippingCost` to `process`. Names should explain meaning, not merely describe a type.

4. **Give each function or module one coherent responsibility.** Split code when it mixes distinct jobs or unrelated reasons to change—not simply because it exceeds an arbitrary line count.

5. **Keep related code together.** A reader should not need to open six files to understand one simple operation. Extract code when doing so creates a useful concept, not merely a shorter file.

6. **Keep control flow shallow.** Use guard clauses and early returns to handle exceptional cases, leaving the main path easy to follow. Break complicated conditions into clearly named checks.

7. **Make inputs, dependencies, and side effects explicit.** Avoid functions that secretly depend on global state or unexpectedly modify their inputs. Make database writes, network calls, and other external effects easy to identify.

8. **Minimize mutable and duplicated state.** Store each fact in one authoritative place and derive other values where practical. Avoid maintaining several fields that must always be updated together.

9. **Let abstractions emerge from concrete needs.** Before introducing a shared abstraction, identify the stable concept it represents. Similar-looking code is not necessarily the same responsibility; a little duplication can be simpler than a forced generalization.

10. **Keep interfaces small and predictable.** Expose only what callers need. Avoid functions with many optional parameters or boolean flags that turn one function into several different operations.

11. **Choose data structures that reduce special cases.** Prefer a clear representation of the problem over scattered flags and loosely related variables. For example, a single `status` value is easier to reason about than several booleans that can contradict one another.

12. **Separate complicated decision-making from external operations.** Where it helps, keep calculations and business rules independent of files, databases, and network calls. Do not create extra layers around trivial operations just to enforce this separation.

13. **Handle errors explicitly and close to the right boundary.** Validate untrusted inputs where they enter the system. Do not silently swallow errors or disguise failure as success; recover only where meaningful recovery is possible.

14. **Follow existing conventions unless there is a clear reason not to.** Reuse the codebase’s naming, formatting, and organizational patterns. Avoid introducing a new approach for a problem the project already handles adequately.

15. **Make dependencies earn their complexity.** Consider what a dependency removes as well as what it adds. Avoid a large library for a trivial task, but do not reimplement a difficult subsystem merely to reduce the dependency count.

16. **Optimize demonstrated bottlenecks, not imagined ones.** Start with a clear, correct implementation and measure when performance matters. Keep necessary optimizations localized, and explain the constraint that justifies them.

17. **Test behavior rather than implementation details.** Write focused tests that show what the code promises, including important failure cases. Tests should allow internal simplification without requiring unrelated rewrites.

18. **Remove what no longer contributes.** Delete dead code, obsolete options, unused abstractions, and commented-out implementations. Use comments to explain non-obvious reasons and constraints—not to narrate obvious statements.

**A useful review question:** “Could someone unfamiliar with this code explain its behavior, identify its side effects, and make a small change without tracing the entire system?”
