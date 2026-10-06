---
description: "It also searches the sources of the project's open-source dependencies at the version the project uses."
tools: [mcp__jbcontext__library_search]
---

<library_search>
When the intent is about a third-party library rather than the project's own code, use `mcp__jbcontext__library_search` (allowed on top of the tools in <rules>) instead of `code_search`: its sources are not in the repository, and Read/Grep over the project or the build caches will not find them. Pass the dependency as the project declares it and the version from its build or lock files; omit the version rather than guess it. It counts against the same search budget, and its `Source:` links point to GitHub, not to local files - quote the snippet it returned instead of reading them.
</library_search>
