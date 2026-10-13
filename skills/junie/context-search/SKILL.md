---
name: context-search
description: "Semantic code search over the whole repository: finds code by meaning and returns matching code blocks with file paths and line ranges.\n- Use it whenever you need code whose location you don't know: the implementation of a described behaviour, callers or related implementations of the code you change, existing tests and test examples.\n- Skip it when you already know the exact identifier or file, or for git operations, builds and running tests."
argument-hint: query

---

# Semantic Code Search

`jbcontext search` returns the most relevant code blocks of the repository for a natural-language question. Each result has the file path, the line range and the code, so you can often act on it directly.

Use it throughout the task, every time a new "where is ..." question comes up: first to find the code to change, later to find its callers, related implementations and tests.

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
