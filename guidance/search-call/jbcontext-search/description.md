# Node: jbcontext search

The agent wants to find something in the repo by WHAT IT DOES OR MEANS
(information, a pattern, a behavior) and was not told exactly where to start
for it (no file, snippet, or exact name of the target). Exact names it
doesn't know yet would have to be guessed.

Typical needs (examples, not an exhaustive list):

- where a feature, behavior, rule, or concept is implemented or decided
- whether something already exists: a helper, utility, abstraction, extension point
- code similar or analogous to a known piece, e.g. "other places that do the
  same thing" or "an existing implementation to follow", even when the
  example itself is known
- repo conventions: how X is usually done here (errors, config reading,
  logging, DI, testing)
- code related to a known location by meaning, not by name: what else
  handles the same event, data, or concern
- tests, docs, or config that cover a behavior
- grep was tried with guessed words and missed (2+ unused results, or a
  concept-word grep over the repo root)

## Not when

- The target itself is exact (named symbol, path, literal) and the agent
  wants to look it up, verify, or enumerate it -> regular search
  (`../regular-search/description.md`).
- Understanding needs a map: several components, a flow across modules, or
  several distinct aspects at once -> context-explorer
  (`../context-explorer/description.md`).
- Against context-explorer: if one well-formed query can answer
it, this node; if the answer needs several queries whose results must be
combined, context-explorer.
