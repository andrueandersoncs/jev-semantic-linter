**Modularity means being able to understand, change, and test one part of a system without needing to understand or modify everything else.** The goal is not more files or classes; it is clearer boundaries and fewer dependencies.

Here are practical, language-agnostic rules to apply. A “module” can be a package, library, component, or a small set of related files.

### Responsibilities and boundaries

1. **Give every module one clear purpose.**
   Describe its responsibility in one sentence. “Calculates invoice totals” is a useful boundary; “handles miscellaneous business logic” is not. Keep closely related behavior together, and separate responsibilities that change for different reasons.

2. **Place boundaries around decisions that should be able to change independently.**
   For example, changing a payment provider should not require rewriting order validation. Hide the provider-specific behavior behind a payment boundary.

3. **Keep implementation details private by default.**
   Expose only what other modules need. Callers should not depend on private helpers, internal folder layouts, database schemas, or cache structures. Prohibit imports into another module’s internal files.

4. **Give each piece of mutable state a clear owner.**
   Other modules should request changes through the owner’s interface rather than modifying its data directly. Avoid shared mutable globals and multiple modules independently enforcing the same data invariants.

### Dependencies

5. **Keep dependencies acyclic.**
   A module must not depend on itself indirectly: `A → B → C → A`. Resolve cycles by moving responsibilities, extracting a genuinely shared concept, or introducing an appropriate interface—not by hiding the cycle behind dynamic imports.

6. **Define and enforce dependency direction.**
   Decide which parts may depend on which others. For example, business rules should not import UI code or require knowledge of a particular database implementation. Document allowed relationships so that “convenient” imports do not gradually erase the architecture.

7. **Make dependencies explicit and narrow.**
   Pass required collaborators through function arguments or constructors. Avoid hidden dependencies through global registries, service locators, or application-wide context objects. A module that needs a clock should receive a clock, not the entire application.

8. **Use abstractions at meaningful boundaries—not everywhere.**
   Introduce a contract when it isolates an external system, supports real variation, or separates responsibilities. Do not create an interface and factory for every class merely to make the code look modular.

9. **Prefer composition over cross-module inheritance.**
   Let modules collaborate through small interfaces rather than relying on another module’s inheritance hierarchy or protected internals. A change to a base class should not unexpectedly alter behavior across unrelated modules.

### Interfaces and communication

10. **Keep public interfaces small, explicit, and task-focused.**
    Expose meaningful operations such as `reserveInventory(items)` rather than making callers coordinate a sequence of low-level mutations. Specify inputs, outputs, errors, and side effects. Avoid making callers know the “correct secret order” of method calls.

11. **Do not expose internal representations unnecessarily.**
    Return data appropriate to the caller’s task rather than leaking storage-specific records or mutable internal collections. Passing a returned value should not grant accidental access to a module’s private state.

12. **Minimize back-and-forth communication between modules.**
    When a simple task requires many calls across a boundary, reconsider where the behavior belongs. Move cohesive work behind one meaningful operation rather than distributing the workflow across callers. Do not solve this by creating a giant catch-all method.

13. **Treat public contracts as promises.**
    Preserve documented behavior when changing internals. Changes to error behavior, ordering guarantees, or side effects can break callers even when function signatures stay the same. Make breaking changes intentional and coordinate them with consumers.

### Implementation and maintenance

14. **Separate decision-making from external effects.**
    Keep calculations, validation, and business decisions separate from database access, network calls, file operations, and time retrieval where practical. This lets you test the rules without recreating the outside world.

15. **Extract shared concepts, not merely similar-looking code.**
    Share an abstraction when its consumers need the same behavior for the same reason. Similar code that is likely to evolve differently can remain separate. Avoid `utils`, `common`, or `helpers` modules becoming dumping grounds for unrelated responsibilities.

16. **Test modules through their contracts.**
    A module’s core behavior should generally be testable without starting the whole application. Avoid tests that depend heavily on private implementation details. Also test important integrations: isolated tests alone cannot establish that modules work together.

17. **Automate architectural rules.**
    Use checks for forbidden imports, dependency cycles, access to internal packages, and prohibited layer relationships. Run them alongside the test suite so boundaries do not depend solely on reviewers remembering every rule.

18. **Split or merge based on cohesion and coupling—not line counts.**
    Split a module when it contains independently changing responsibilities. Consider merging or redrawing boundaries when modules constantly access each other’s internals or must change together. Many tiny files can still form one tightly coupled system.

**A useful code-review question:** “Can this module’s implementation change without forcing unrelated callers to change?” When the answer is no, identify which internal detail or responsibility is crossing the boundary.
