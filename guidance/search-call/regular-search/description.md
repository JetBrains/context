# Node: regular search

The agent's next search is for something EXACT that it already knows by name,
or for ALL occurrences of such a name, or it is not a code search at all.
Choose this node if ANY holds:

1. Exact target. From the task and the session so far, the agent already knows
   the name of what it needs: a symbol, file name/path, literal string, error
   message, config key, flag, import, or test name. The user gave it, or the
   session established it (a file the agent read, a search result, a
   jbcontext/explorer report). The agent now wants to locate, verify, or
   follow up on it, e.g. check a detail inside a file already located.

2. Exhaustive enumeration of a known name. The agent needs ALL occurrences,
   not the most relevant ones: every call site before a rename or signature
   change, every importer of X, every entry of config key K.

3. Meta / environment lookup, or not a code-discovery task. Logs, build or
   test output, environment variables, tool config, local generated artifacts,
   git metadata (status/diff/log/show/blame); also git operations, running
   builds or tests, shell setup, reviewing a diff already in hand.

## Not when

- The agent wants something it can only describe by what it does or means:
  no name for it has been established, so any name it searched for would be
  a guess (see `../jbcontext-search/description.md`). Signs in the session:
  - its reasoning describes a behavior or concept ("where do we...",
    "find the code that...") rather than naming a symbol, file, or string
  - earlier lexical searches with guessed words came back empty, unused, or
    as large mostly unrelated output
- The agent needs a map across several components or a cross-module flow
  -> context-explorer (`../context-explorer/description.md`).
