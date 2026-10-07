# Node: context-explorer

Choose this node if the agent needs a MAP of code it does not know yet, not a single location:

1. A flow across modules: how a request, event, or value travels through several
   components (entry point -> processing -> storage/output).
2. Several components at once: the change or question involves 3+ files or modules
   whose identities are unknown, e.g. "all places involved in X".
3. Several distinct aspects at once: e.g. where X is configured AND where it is
   enforced AND how it is tested, which would take several separate searches.

Typical needs (examples, not an exhaustive list):

- trace how a setting travels from where it is read to where it takes effect
- all components involved when X happens (handlers, listeners, caches, persistence)
- how a request flows through the layers of a subsystem before it fails
- explain how a feature works end to end (how X is computed, evaluated, or
  collected) when that spans several files or modules
- every place that must change together to add a new variant of X
  (registration, handling, serialization, tests), when those places are unknown

## Not when

- The target is a single concept or behavior that one semantic search can locate
  -> jbcontext search (`../jbcontext-search/description.md`).
- The target is exact (a name the agent already knows from the user or the session)
  or needs exhaustive enumeration -> regular search (`../regular-search/description.md`).
- The relevant files are already identified in this session; the agent is now
  reading, verifying, or editing them.
- Not a code-discovery task (git, build/test runs, environment, reviewing a diff).
