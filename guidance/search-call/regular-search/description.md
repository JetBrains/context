# Node: regular search

Choose this node if ANY holds:

1. Exact target. The pending call looks up, verifies, or follows up on
   an exact anchor that the user gave or that the session already established:
   a symbol, file name/path, literal string, config key, flag, import,
   test name, or a tight regex.
   Includes grepping a symbol that appeared in a jbcontext/explorer result,
   and checking a detail inside a file already located.

2. Exhaustive enumeration of a known symbol or literal. The agent needs ALL
   occurrences, not the most relevant ones: every call site before a rename or
   signature change, every importer of X, every entry of config key K.

3. Meta / environment lookup, or not a code-discovery task. Logs, build or
   test output, environment variables, tool config, local generated artifacts,
   git metadata (status/diff/log/show/blame); also git operations, running
   builds or tests, shell setup, reviewing a diff already in hand.

## Not when

The search target is described by meaning rather than exact
(see `../jbcontext-search/description.md`). Typical signs in the pending call:

- the pattern is a guessed concept word or synonym bag
  (`risk`, `auth|login|session`, `-i retry`) over the repo root
- 2+ lexical searches in this task returned results the agent didn't use
- the previous grep output was large and mostly unrelated

