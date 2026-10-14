# Semantic Code Search

`jbcontext search` returns the most relevant code blocks of the repository for a natural-language question. Each result has the file path, the line range and the code, so you can often act on it directly.

Use it when a new "where is ..." question comes up: first to find the code to change, later to find its callers, related implementations and tests. One search per question; do not repeat a search for something you have already found. For occurrences of an exact identifier you already know, exact search is faster.

## Usage

```bash
jbcontext search "<full sentence describing the behaviour, with names from the task>"
jbcontext search "<code snippet>"                # find similar code
jbcontext search -p <dir> "<query>"              # <dir> is relative to the repository root, not the current directory
```

## Tips

- Name the feature, class, method, setting or message from the task: "where the debugger evaluates watches for Kotlin coroutines" > "watches".
- Read the returned code first; open a file only when you need more than the shown lines.
- If the results are off, rephrase with other terms or narrow with `-p` to the directory of the best hit.
- Do not run `cd` before searching; run it from the repository root.

## Efficiency guidelines

- **Prefer one well-phrased search over multiple exploratory ones.** A single search with the right domain terms usually finds the primary file. Avoid follow-up searches just to gather tangentially related files that are not needed to answer the question.
- **Use search instead of opening files blindly**, but when a search already returned enough context in its snippets, act on it directly without opening more files or running additional searches.
- **Skip searches for things you already know.** If a previous search or file view already revealed an identifier or file path, use exact lookup rather than another semantic search.