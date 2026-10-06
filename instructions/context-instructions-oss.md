## Library Source Search (jbcontext)

Dependency sources are usually not in the repository, and Maven/Gradle caches hold only binary jars. Before writing or changing code against a third-party API you are not sure of at the project's version, when an error comes from inside a library, or when configuring it through auto-configuration or properties, search the library's sources with the `/library-search` skill (`jbcontext search-deps "<query>" <dependency> <version>`, or the MCP `library_search` tool) instead of relying on memory.
