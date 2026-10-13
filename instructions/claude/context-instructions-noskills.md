# Code search

Start your first exploration Bash command with a semantic search, then your usual grep/find in the same call:

```bash
jbcontext search --limit 5 --renderer filenames "<what the code does, in plain words>"; <your grep for an identifier from the task>
```

It lists the 5 files most related by meaning in about a second. Do this also when the task names a class or symbol, and read the best file from either list. Retry at most once, with snippets and narrowed: `jbcontext search --limit 5 -p <dir> "<query>"`.
