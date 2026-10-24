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

### When to use

`jbcontext search` is a **search tool for repositories**. Use it when you need to find something in the
repo and don't know where to look.

Skip it - go straight to the right tool - when:

- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all - git operations (rebase, merge, commit), running tests or builds,
  shell/statusline/config setup, or reviewing a diff you already have.

### MANDATORY: jbcontext-first bootstrap

When code discovery *is* needed and no relevant file or subsystem is known yet, your first code-search action MUST be
`jbcontext search` - do not open with `rg`/`grep`/`find` or git history. This mandate governs *how* you start searching,
not whether every task needs a search.

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know
  the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Inspect the first relevant file or directory before issuing another broad semantic search.
- Use another broad `jbcontext search` only if the local path stops being productive.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local
  inspection.
- If you search again after finding a relevant area, narrow with `-p <path>`.

### Examples

```bash
# Find code by its behavior
jbcontext search "code that retries failed HTTP requests with exponential backoff"

# Narrow to specific directory
jbcontext search -p src/auth "Where is the code that verifies a JWT's signature and checks that it has not expired?"
# Find related tests
jbcontext search -p test "tests checking that unauthenticated requests are rejected by middleware"

# Find documentation or specs
jbcontext search "design doc describing how the authentication flow handles token refresh"
```
