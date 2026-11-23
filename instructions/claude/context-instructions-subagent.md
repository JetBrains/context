# Tools

## Code discovery: semantic search first

When you need to locate unfamiliar code, your first code-discovery action MUST be `jbcontext search`. Use it directly rather than launching a context-explorer subagent or opening with repository-wide grep, glob, directory listings, or git history. The goal is to replace manual exploration with a small set of useful file pointers, not add a research phase.

Skip semantic search when no code location needs discovering:
- The relevant file or implementation is already identified or open.
- An exact file, class, or symbol is given and a direct open or exact lookup is sufficient.
- The task is a git operation, test/build execution, shell/config setup, or review of an available diff.

A feature name, endpoint, UI label, or behavior is a query anchor, not proof that its implementation is already known.

## Semantic Code Search (jbcontext)

Search by meaning when the implementation's location is unknown.

### Usage

```bash
jbcontext search "<query>"
jbcontext search -p <path> "<query>"
```

`<path>` must be relative to the project root. The optional flag `--limit <n>` caps the number of returned files; the default is 50. Start with `--limit 5` to avoid carrying large result lists through the rest of the task:

```bash
jbcontext search --limit 5 "<query>"
jbcontext search -p <path> --limit 5 "<query>"
```

### Target the implementation

Make one focused query containing:
- The task's distinctive feature, endpoint, field, error, or behavior.
- The operation to locate: creation/defaulting, permission checks, query-field registration, persistence/restore, or another relevant responsibility.
- The owning product, runtime, or layer when the task distinguishes it.

Retain the task's exact names alongside a short behavioral description. Avoid generic queries such as "query parsing implementation" when a specific feature is named. Do not invent likely class names or turn a multi-part task into several speculative searches.

If the task contrasts two implementations, identify which needs changing and which is only a reference. Similar names in another product, compatibility layer, CLI, generated schema, or documentation do not establish ownership.

### Read, follow, stop

After the first search, read the most promising returned implementation file before any further semantic search. Inspect only the relevant range, including enough surrounding code to understand it.

Use the results as a ranked shortlist, not a reading list. Verify that the candidate handles the requested entry point and behavior. Once it does:
- Follow concrete imports, calls, registrations, or delegations with direct reads or scoped exact searches.
- Use discovered symbols and paths instead of repeatedly searching for the same concept.
- Trace only the links needed to establish ownership and behavior. Prefer a shared policy or normalization layer over independently exploring every backend.
- Do not reread unchanged files or explore every neighboring file.

### Retry only for a specific gap

One search is normally enough. Before retrying, identify what remains unknown and why local inspection cannot answer it.

For a relevant but incomplete hit, inspect its concrete references first. If semantic search is still needed, narrow with `-p` to the smallest verified owning directory and query the missing responsibility, not a paraphrase of the first query.

If the first results belong to the wrong subsystem, correct the product/runtime/layer in the query; do not narrow into the wrong directory. If five results provide no useful pointer, refine the query or modestly increase the limit rather than dumping the default 50 results.

Stop semantic discovery when the implementation and necessary relationships are identified. Search is a locator, not evidence that the first plausible file is the right place.