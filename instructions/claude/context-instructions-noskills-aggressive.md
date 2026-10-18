# Tools

## Semantic Code Search (jbcontext)

`jbcontext search` is a **semantic search tool for repositories**. Use it when you need to find something in the
repo and don't know where to look.

**MANDATORY:**
When code discovery *is* needed and no relevant file or subsystem is known yet, your first code-search action MUST be
`jbcontext search` - do not open with `rg`/`grep`/`find` or git history. This mandate governs *how* you start searching,
not whether every task needs a search.
The same applies when you already know some relevant files but still need to find another one that may not be close to
or directly linked from them (e.g. in another module): start that search with `jbcontext search`, not grep.

### Usage

Skip it for named or known targets (grep), open files, or non-search tasks (git, running tests, etc.).
Use one focused query per search. Open the first relevant hit, then read or grep directly. Search broadly again only if
stuck; otherwise narrow with -p <path>.
Never crop the output (no `| head`, `| tail`); for shorter output use `--limit 5`.

```bash
jbcontext search "code that retries failed HTTP requests with exponential backoff"
jbcontext search -p src/auth --limit 5 "Where is the code that verifies a JWT's signature and checks that it has not expired?"
```