# Guidance: context-explorer

This needs a map across several components; delegate it to the explorer.

Call the Agent tool with subagent_type `context-explorer` and a 1-2 sentence intent:
what you need to understand or locate, plus anything already tried that missed
(queries, grep patterns, files ruled out). It runs in the foreground: wait for its
report, and do not search the same topics in parallel.

Name the behavior and the parts you need mapped, and ask for file:line locations.

- Good: "Map how the outbound HTTP timeout setting is read, passed to the client,
  and applied; return file:line for each step. Grep for 'timeout' was too broad."
- Bad: "Find timeout code." (no behavior, no scope, nothing tried)
