# Code search

`mcp__jbcontext__code_search` finds code by meaning. It is a deferred tool, so in your first turn load it in parallel with your first Bash command:

ToolSearch {"query": "select:mcp__jbcontext__code_search"}

In your next turn call it once, in parallel with your next command - also when the task names a class or symbol, because it ranks the files a grep misses:

{"text": "<what the code does, in plain words>", "topK": 5}

Always pass `text` (not `query`). Read the best hit from either result. Retry at most once, adding "pathFilter": "<dir>".
