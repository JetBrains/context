---
name: library-search
description: "Semantic search in the sources of an open-source library at the version the project depends on.\n- Use this skill when the answer depends on how a third-party dependency actually behaves: its defaults, configuration options, exceptions it throws, extension points, or an API whose signature you are unsure of for this version.\n- When not to use: for code inside the current project (use context-search), for libraries the project does not depend on, or when the library's source is already checked out locally."
argument-hint: query dependency [version]
---

# Library Source Search

Use `jbcontext search-deps` to find code in the sources of a library the project uses, at the version it uses. It searches a shared index of open-source libraries; nothing has to be downloaded or indexed locally.

## Usage

```bash
jbcontext search-deps "<detailed and descriptive query>" <dependency> <version>
jbcontext search-deps "<query>" <dependency> <version> --limit 5
```

`<dependency>` is the library coordinate as declared in the build, e.g. Maven `group:artifact`. `<version>` is optional: without it the index picks the version to search, which may not be the one the project uses.

## Find the dependency and version first

Pass the version whenever the project pins one, and do not guess it: read it from the project before searching.

- Gradle: `build.gradle(.kts)` dependency declarations, version catalogs in `gradle/libs.versions.toml`, or `./gradlew dependencies` / `dependencyInsight --dependency <name>` for the resolved version.
- Maven: `pom.xml` `<dependency>` and `<dependencyManagement>`, property placeholders such as `${ktor.version}`, or `mvn dependency:tree`.
- Lock files, when present, hold the resolved version: `gradle.lockfile`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum`.

Prefer the resolved version over a declared range or a BOM-managed placeholder.

## Reading the result

The first line names what was actually searched, for example:

```text
Searched io.ktor:ktor-client-core 3.1.1 in ktorio/ktor@0495b8b1c2d3, nearest to 3.0.3
```

- `nearest to <requested>` means the requested version is not indexed and the closest indexed one was searched instead. Behavior can differ between versions: say so when the answer depends on details that may have changed.
- Each result has a `Source:` link to the file on GitHub at that commit. Use it (or `gh api`) to read the full file around the snippet before relying on it.

## When nothing is found

- `Library ... is not indexed for library search.` - check the coordinates against the build file (exact group and artifact, not a plugin id or a BOM). Many projects publish several artifacts from one repository; try the core artifact. If it is still not indexed, fall back to the library's sources directly (GitHub, sources jar, IDE navigation).
- `No relevant results found.` - the library is indexed, so rephrase: use the library's own vocabulary (class names, config option names, error messages) instead of the project's.

## Query Tips

- Be descriptive: "default retry policy and backoff for failed HTTP requests" > "retry"
- Name the API you are asking about when you know it: "HttpRequestRetry configuration retryOnServerErrors"
- Search for the error message text to find where an exception is thrown
