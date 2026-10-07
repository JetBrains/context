# Guidance: jbcontext search (CLI)

What you are looking for is described by meaning, not by an exact name.
Find it with semantic search instead of guessing grep patterns.

## Call

```bash
jbcontext search "<query>"
jbcontext search -p <path> "<query>"   # narrow to a directory or file
jbcontext search "<code snippet>"      # find similar code
```

Use `--limit <n>` to change the number of results. Do not pipe the output
through `head`.

## Query

- Write one sentence that describes a single concept or intent. Name the
  behavior or pattern, the domain terms from the task, and the kind of code
  you expect (handler, validator, config, test).
  - Good: "function that validates user email addresses and returns boolean"
  - Good: "where the outbound HTTP request timeout is configured"
  - Good: "tests that exercise lambda-parameter indentation handling"
- Avoid single words ("email", "error"), bare declarations ("class User"),
  and keyword bags ("product composite REST controller service reviews openapi tests").
- One concept per query. If you need two different things, run two queries
  instead of combining them.
- To find code similar to a piece you already have, pass a short
  representative snippet as the query.

## Path filter (`-p`)

- Use it only when you have evidence for the directory or file, e.g. the
  directory of a relevant earlier hit.
- Relative to the project root: `src/auth`, `services/payments`, `app/models/user.py`.
- Never absolute paths, leading slashes, `.`, `./`, `*`, or globs.
- Omit it to search the whole project.

## After the results

Results are ranked file paths with code snippets and line numbers.

1. Read the most relevant returned files.
2. If a hit is relevant but incomplete, inspect neighboring files in the same
   directory before searching again.
3. Continue with Read and grep on the exact names you found.
4. If you still need semantic search, retry narrowed with
   `-p <directory of the best hit>`, or rephrase the query. Do not repeat the
   same query.

## Caveats

- The index may lag uncommitted local edits. Use grep and Read for files
  changed in this session.
- Results are the most relevant matches, not all occurrences. To find every
  usage of a name, use grep.
