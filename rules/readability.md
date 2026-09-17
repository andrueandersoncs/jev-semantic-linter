## Rules for readable code

Use these as defaults, not rigid laws. When rules conflict, prefer the version that makes the code’s intent and behavior easiest to understand.

1. **Name things by their purpose.**
   Prefer `unpaid_invoices` to `data` and `calculate_total()` to `process()`. Use short names only when their meaning is obvious in context, such as `i` in a small loop.

2. **Make important distinctions visible in names.**
   Include units or representations when confusion is possible: `timeout_ms`, `price_cents`, `created_at_utc`. Name booleans as conditions, such as `is_valid` or `has_permission`.

3. **Give each function one coherent responsibility.**
   A function should perform a task you can describe clearly without listing unrelated activities. Split it when doing so creates meaningful, well-named operations—not merely to meet a line-count limit.

4. **Keep each function at a consistent level of detail.**
   Avoid mixing high-level workflow with low-level implementation details. A function that coordinates checkout should not also contain the details of parsing a payment response.

5. **Make the normal flow easy to follow.**
   Handle invalid inputs and exceptional cases with guard clauses where appropriate, then present the main operation without unnecessary indentation. Avoid making readers mentally untangle deeply nested conditions.

6. **Prefer straightforward code over clever code.**
   Avoid dense one-liners, obscure language tricks, and expressions that do several things at once. A few explicit steps are preferable when they make the behavior easier to follow.

7. **Name complicated conditions and intermediate results.**
   Replace a difficult expression with a meaningful variable or helper, such as `is_eligible_for_refund`. Do not introduce temporary variables that merely rename an already-obvious expression.

8. **Keep related code close together.**
   Declare variables near their first use, give them the smallest practical scope, and place closely related helpers where readers can find them. Minimize the distance readers must travel to understand an operation.

9. **Use consistent formatting and follow the project’s conventions.**
   Apply a standard formatter where one is available. Keep indentation, spacing, naming, and file structure predictable; avoid unrelated formatting changes when editing existing code.

10. **Use whitespace to separate logical steps.**
    Group statements that accomplish one small task, then separate the next task with a blank line. Avoid both uninterrupted walls of code and excessive spacing.

11. **Replace unexplained values with meaningful names.**
    Use `MAX_RETRY_ATTEMPTS` instead of an unexplained `3` when the value represents a policy or domain concept. Do not create constants for every obvious literal.

12. **Make interfaces understandable at the call site.**
    Prefer explicit parameters and meaningful return values. Avoid calls like `save(record, True, False)`; use named arguments, descriptive options, or separate operations when they clarify intent.

13. **Make dependencies and side effects visible.**
    Avoid surprising global state, hidden input/output, and unexpected mutation. A function named `calculate_total()` should not silently save a file or send an email.

14. **Write comments that explain what the code cannot.**
    Document intent, constraints, assumptions, and non-obvious tradeoffs. Avoid narrating obvious statements, and update or remove comments when behavior changes.

15. **Abstract shared concepts, not merely similar-looking code.**
    Extract repeated logic when it represents the same rule or responsibility. Allow some duplication when combining unrelated cases would require confusing flags, exceptions, or configuration.

16. **Make failure behavior explicit.**
    Handle errors where useful action can be taken, preserve relevant context, and write messages that explain what failed. Do not silently swallow failures or return success-shaped defaults unless that behavior is intentional and clear.

17. **Remove distractions.**
    Delete unused variables, dead branches, stale comments, and commented-out code. Avoid speculative extension points and configuration that serve no current requirement.

18. **Make tests readable examples of behavior.**
    Name tests after the condition and expected outcome. Keep setup, action, and assertions distinct, and use test data that makes the important behavior obvious.

**Final review question:** Can someone unfamiliar with this code identify its purpose, inputs, outputs, side effects, and failure cases without reconstructing every implementation detail?
