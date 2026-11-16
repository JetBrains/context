# Tools

## Code discovery: semantic bootstrap, then local inspection

When a task requires finding or understanding code whose location is unknown, your FIRST code-discovery step MUST be:

```bash
jbcontext search "<query>"
```

Use semantic search to obtain an initial pointer, not to conduct the entire investigation. Run it directly by default; a discovery subagent is not a required gate. If discovery is delegated, give that agent ownership of the search and inspection; do not launch parallel searches for the same question or repeat its work.

Skip semantic search when no discovery is needed:
- The relevant file or implementation is already identified or open.
- The task supplies an exact file or unambiguous code symbol that direct opening or exact search can locate.
- The work is a git operation, test/build invocation, shell/config setup, or review of an existing diff, without unknown code to locate.

A feature name, UI label, request field, or error message is a useful query anchor, but does not by itself identify the implementation.

## Semantic Code Search (jbcontext)

Searches code by meaning rather than just keywords.

### Usage

```bash
jbcontext search "<query>"
jbcontext search -p <path> "<query>"
```

`<path>` must be relative to the project root. Use `-p` on the first search when the subsystem is known but the implementation is not.

### Query once, then read

1. Ask one focused question about the behavior and its owning code. Include distinctive task terms and the affected runtime or interface when available. Describe the observed behavior without assuming its cause. Avoid generic queries and speculative diagnoses such as an assumed cache problem.
2. Examine the highest-relevance paths and snippets, not every result. Ranking is a lead, not proof. Prefer the implementation matching the reported execution path over similarly named code for another client, runtime, or subsystem.
3. Read at least one returned file before another semantic search. Read the relevant function and enough surrounding code to understand its role. Search snippets alone are not sufficient evidence.
4. Once a relevant file or symbol is known, use direct reads and exact searches for its definitions, callers, references, and neighboring implementations. Do not ask semantic search where a known symbol is called.
5. Stop semantic exploration when local navigation can answer the remaining questions. Do not search again merely to increase confidence or fill a search allowance.

### Retry only for a specific discovery gap

A retry is justified when the inspected results belong to the wrong execution path, reveal no useful entry point, or leave a missing component that cannot be located through local references.

Before retrying, inspect the best candidate and nearby code. Then narrow to an evidence-supported directory:

```bash
jbcontext search -p <path> "<query>"
```

State the missing responsibility in the query, rather than paraphrasing the original request. Normally one initial search and one narrowed retry suffice. Additional searches require a distinct unresolved location question, not repeated low confidence.

Do not narrow to a guessed directory. If no usable path was returned, revise the original query using concrete task terminology instead of inventing a path.

### Keep discovery small and evidence-based

- Avoid parallel paraphrases, full result dumps, exhaustive reading, and reopening unchanged ranges.
- Compare a nearby working implementation when it exposes the same behavior through another field or interface; do not jump to a shared infrastructure change from a suggestive result.
- Poor results do not establish that code is absent or lives elsewhere. Follow concrete data types and call paths before changing subsystems.
- If a tool reports an error but includes readable paths and snippets, inspect a promising returned file before repeating the request.
- A delegated report should contain only inspected `path:line` references, brief findings, and any unresolved location question. Clearly distinguish verified code from search-only leads.