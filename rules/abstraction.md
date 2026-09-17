**Core principle: a new abstraction should let its callers stop knowing, doing, or getting wrong something important. Moving code behind a new name is not enough.**

### Decide whether it belongs

1. **Name the concrete problem it solves.**
   Before implementing it, finish this sentence: “This abstraction owns ___ so callers no longer need to ___.” Good answers identify a responsibility, an invariant, or a source of change—not simply “cleaner code.”

2. **Abstract shared meaning, not merely similar code.**
   Two operations can look alike while representing different concepts. Combine them when they share a contract and should change together; keep them separate when their resemblance is incidental.

3. **Generalize from demonstrated needs.**
   Design around real requirements and representative call sites. Do not add extension points, configuration options, or interchangeable implementations for imagined futures. A single consumer can still justify an abstraction that protects an important invariant or isolates a meaningful boundary.

4. **Require a net reduction in complexity.**
   Count the concepts, configuration, adapters, dependencies, and debugging steps the abstraction introduces—not just the lines it removes. Reject a design that simplifies its implementation by making every caller more complicated.

### Shape the contract

5. **Give it one coherent responsibility.**
   Its public operations should describe a recognizable concept at a consistent level of detail. Avoid catch-all names such as `Manager`, `Helper`, or `Processor` when they obscure unrelated responsibilities.

6. **Define the contract before the implementation.**
   Specify accepted inputs, outputs, invariants, side effects, failure behavior, and relevant lifecycle rules. Callers should be able to use it correctly without reading its internals.

7. **Make the public interface as small as the contract allows.**
   Keep implementation details private by default. Every public method, option, and exposed type should serve a demonstrated caller need; do not expose internal machinery merely because it already exists.

8. **Hide implementation decisions, not important consequences.**
   Encapsulate details such as storage layout or transport mechanics, but make meaningful behavior apparent. Network requests, expensive work, destructive actions, partial results, and consistency limitations should not be disguised as harmless local operations.

9. **Make correct use straightforward and invalid use difficult.**
   Prefer representations and operations that enforce invariants over documentation that asks callers to remember them. Validate at the appropriate boundary, avoid unnecessary call-order requirements, and provide defaults only when they are genuinely safe.

10. **Do not promise interchangeability you cannot deliver.**
    Implementations of the same contract must honor the same guarantees. When capabilities differ meaningfully, expose the distinction or narrow the contract rather than relying on implementation-specific knowledge, downcasts, or surprising “unsupported operation” failures.

### Implement the boundary

11. **Keep dependencies and ownership explicit.**
    Make it clear which collaborators the abstraction requires and who creates, owns, and releases resources. Avoid hidden global state or implicit service lookup that makes behavior depend on invisible setup.

12. **Separate stable behavior from required variation.**
    Keep the common workflow in one place and isolate the parts that actually vary. Prefer small, composable collaborators when appropriate; do not build a flag-heavy configuration system or inheritance hierarchy just to accommodate a few differences.

13. **Keep each invariant under one authority.**
    An abstraction should own the rules it promises to enforce. Do not require callers to duplicate its validation, reconstruct its state, or coordinate competing sources of truth to preserve correctness.

14. **Handle failures at the layer that understands them.**
    Translate errors only when doing so adds useful meaning for callers, and preserve the underlying cause and relevant context. Do not silently turn failures into defaults or add retries without considering whether repeating the operation is safe.

15. **Preserve the controls callers genuinely need.**
    Where relevant, support cancellation, timeouts, resource cleanup, and useful diagnostics. Avoid sealing the implementation so tightly that ordinary operational requirements require bypassing the abstraction—but do not add unrestricted escape hatches preemptively.

### Verify that it earns its place

16. **Exercise it through representative callers.**
    Implement at least one realistic end-to-end use before polishing the interface. When claiming reuse, test materially different intended uses; repeated special cases are a reason to reconsider the boundary.

17. **Test observable guarantees, not private structure.**
    Cover normal behavior, boundary conditions, failures, and promised invariants through the public contract. Tests should allow internal refactoring without unnecessary rewrites. Shared contract tests can help verify multiple implementations.

18. **Keep adoption focused and reversible.**
    Separate structural refactoring from behavior changes where practical. Remove superseded paths after migration, and avoid broad rewrites merely to make everything use the new abstraction. Be willing to simplify or delete it when the expected benefit does not materialize.

**Final review question:** “What can callers now stop knowing, doing, or getting wrong—and is that worth the complexity this abstraction adds?”
