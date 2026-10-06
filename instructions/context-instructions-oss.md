## Library Source Search (jbcontext)

Dependency sources are usually not in the repository, and Maven/Gradle caches hold only binary jars. When you add or change a dependency, set library properties or auto-configuration, hit a compile error on a library symbol or an exception from inside a library, or call a library API you are not sure of at the project's version, search the library's sources with the `/library-search` skill (`jbcontext search-deps "<query>" <dependency> <version>`, or the MCP `library_search` tool) instead of relying on memory.
