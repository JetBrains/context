# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "Where is a function that validates user email addresses" > "email"
- Include context: "Find error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Once you get a relevant hit, switch to direct file reads. If one or two searches do not locate the code, refine the query (narrow with `-p <path>`) or switch to exact text search.
- Do not spawn subagents for code search; run `jbcontext search` yourself.

### Keep tool output small

- For exact text, use `git grep -n "<token>"`; when you only need to know which files mention it, use `git grep -l "<token>"` and print matching lines only for the files you will inspect.
- Read files in small windows around the relevant lines (for example `sed -n '120,180p' <file>`) instead of the first few hundred lines; the search result snippet often already shows the relevant code.
- Do not re-run a search or re-read a region whose output you already have.

### Answer

- Keep the final answer short: the relevant file paths, one per line, each with a short phrase; no code excerpts and no restating of the question.
- A short answer is not a reason to stop exploring early: verify the relevant files first, and list every relevant file you verified.
