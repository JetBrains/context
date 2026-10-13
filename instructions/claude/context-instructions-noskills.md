# Code search

To find code you can't locate yet, run a semantic search in the same Bash call as your first grep:

```bash
jbcontext search --limit 5 "<what the code does, in plain words>"; <your grep for an identifier from the task>
```

Read the best hit from either. Retry at most once, narrowed: `jbcontext search --limit 5 -p <dir> "<query>"`.
