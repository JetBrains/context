# Tools

## Code discovery: semantic bootstrap, then local inspection

When you need to locate code whose location is unknown, your FIRST
code-discovery step MUST be `jbcontext search`. Use it to replace exploratory
chains of grep/glob/find, directory listings, and speculative file reads.

A named class or method is a useful query anchor, not a known location.
If the task names a symbol but you do not know its file, start with semantic
search.

Skip semantic search when no discovery is needed:
- The exact file is supplied, already open, or already identified; read it.
- The task is only a git operation, test/build run, shell/config setup, or
  review of an available diff.

Do not search as a formality. Once a relevant location is known, use direct
reads and exact searches for definitions, references, implementations, and
nearby examples.

## Semantic Code Search (jbcontext)

### Usage

```bash
jbcontext search "<query>"
jbcontext search -p <path> "<query>"
```

`<path>` must be a single directory relative to the project root. Do not put
multiple directories in one path argument.

Both forms accept `--limit <n>` to cap the number of returned files (default
50). Start with `--limit 8`; avoid paying for a large result list you will not
inspect.

### Target the behavior and its owner

Write one focused query combining:
- The most distinctive feature, field, symbol, error, or behavior named in the
  task.
- The operation involved, such as creation, validation, filtering, or parsing.
- Any reliable product, language, or subsystem context.

Ask for the implementation responsible for the behavior, not just its public
endpoint or documentation. Preserve distinctions in the request: a comparison
with another component does not mean that component owns the bug. Do not
invent subsystem context from a link or a passing mention.

Avoid generic queries such as "REST controller handling requests" when the
task supplies a distinctive field or behavior. Do not split one discovery
question into several overlapping searches.

### Read, follow evidence, and stop searching

After the first search, read at least one returned file before another
semantic search. Choose by relevance to the requested behavior, not rank
alone. Prefer implementation or a focused behavioral test over generated
schemas, documentation, clients, and translations.

Read the relevant range with enough surrounding code to understand its role;
do not repeatedly dump whole files. Use imports, calls, registrations, and
test references to follow the concrete path locally.

Before expanding discovery:
- Check whether the candidate actually owns the requested operation. Similar
  names or parallel implementations are not proof.
- Inspect a nearby working implementation of analogous behavior when available.
  This often reveals the intended extension point without tracing an entire
  framework or indexing system.
- If a candidate is a storage adapter or wrapper, follow its caller or delegate
  to find where the behavior is normalized or enforced.

Once you have the owning implementation and a useful local example or caller,
stop broad discovery. Do not search semantically for a symbol or path that the
files already identify.

### Retry only for a concrete gap

Normally one search is enough. Before retrying, inspect the best returned
candidate and its directly related code locally.

If an unresolved question still requires semantic discovery, make one focused
retry with `-p` set to the smallest plausible owning directory. State the
missing behavior in the query; do not paraphrase the original query.

If the first results clearly belong to the wrong subsystem, correct the
query's context rather than narrowing into that subsystem. Increase the
result limit only when the initial results provide no useful lead.

### Delegation

Run the bootstrap directly by default. Do not launch a discovery subagent
merely to repeat the same search. If delegating genuinely separate research,
include these query, read-before-retry, and stopping rules in its prompt.
Do not duplicate its exploration in parallel. Request only concise
`file:line` findings, ownership evidence, and unresolved uncertainty, not
large excerpts or speculative diagnoses.