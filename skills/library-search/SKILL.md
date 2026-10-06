---
name: library-search
description: "Semantic search in the sources of an open-source library at the version the project depends on. The sources are usually not in the repository, and Maven/Gradle caches hold only binary jars.\n- Use this skill before writing or changing code that calls a third-party library when you are not sure of its API signature or behavior at this version; when an error or stack trace comes from inside a library; when configuring a library through auto-configuration or properties (Spring Boot starters, springdoc, Testcontainers, etc.) and need the property names, defaults or conditions; or when the answer depends on its defaults, exceptions or extension points.\n- When not to use: for code inside the current project (use context-search), for libraries the project does not depend on, or when the library's source is already checked out locally."
argument-hint: query dependency version
---

# Library Source Search

Use `jbcontext search-deps` to find code in the sources of a library the project uses, at the version it uses. It searches a shared index of open-source libraries; nothing has to be downloaded or indexed locally.

## Usage

```bash
jbcontext search-deps "<detailed and descriptive query>" <dependency> <version>
jbcontext search-deps "<query>" <dependency> <version> --limit 5
jbcontext search-deps "<query>" npm:lodash 4.17.21
```

`<dependency>` is the library name as the project declares it. Maven `group:artifact` goes as is; other ecosystems take a prefix: `npm:lodash`, `npm:@babel/core`, `pypi:requests`, `cargo:serde`, `go:github.com/x/y` (the module path). Always pass `<version>`, the one the project uses: without it the latest indexed version is searched, which may not match the project.

## Finding the version

Read it from the project; never guess it, even for a well-known library. If you cannot determine it, call without a version and say so in the answer rather than passing a made-up one.

A lock file holds the resolved version; prefer it to the range in the manifest.

- Maven/Gradle: `gradle.lockfile`, `build.gradle(.kts)` declarations, version catalogs such as `gradle/libs.versions.toml`, `pom.xml` `<dependency>` and `<dependencyManagement>`. A dependency declared without a version gets it from the parent pom (`spring-boot-starter-parent`), a BOM imported in `<dependencyManagement>`, a Gradle `platform(...)` or the Spring Boot plugin: a Spring Boot starter has the Spring Boot version.
- npm: `package-lock.json` (`"node_modules/<name>"` -> `"version"`), `yarn.lock`, `pnpm-lock.yaml`; not the `^`/`~` range in `package.json`. `npm ls <name>` prints the installed one.
- Cargo: `Cargo.lock` (`[[package]]` with `name = "<crate>"`); `cargo tree -i <crate>` when several versions are locked.
- Go: `go.mod` `require <module> <version>`, after any `replace`; the version is a tag like `v1.2.0` or a pseudo-version like `v0.0.0-20240101120000-abcdef123456`, pass it as is. `go list -m <module>` prints the selected one.
- PyPI: `poetry.lock`, `uv.lock`, `Pipfile.lock` or a pinned `requirements.txt` (`name==version`); `pip show <name>` in the project's environment.

In a Maven or Gradle build, when the build file has no literal version (a variable, a parent, a BOM, `platform(...)`), the dependency is transitive, or you are unsure, ask the build for the resolved one:

```bash
./gradlew dependencyInsight --dependency <artifact> --configuration <runtimeClasspath|compileClasspath>
mvn dependency:tree -Dincludes=<group>:<artifact>
```

In a multi-module Gradle build, run it for the module that uses the library, e.g. `./gradlew :app:dependencyInsight ...`.

## Reading the result

The first line names what was actually searched, for example:

```text
Searched io.ktor:ktor-client-core 3.1.1 in ktorio/ktor@0495b8b1c2d3, nearest to 3.0.3
```

- `Version not specified, searched the latest indexed ...` means no version was passed: the answer describes the latest indexed version, which may differ from the project's. Find the version and search again, or say so in the answer.
- `nearest to <requested>` means the requested version is not indexed and the closest indexed one was searched instead. Behavior can differ between versions: say so when the answer depends on details that may have changed.
- Each result has a `Source:` link to the file on GitHub at that commit. Use it (or `gh api`) to read the full file around the snippet before relying on it.

## When nothing is found

- `Library ... is not indexed for library search.` - check the name against the project (exact Maven group and artifact, not a plugin id or a BOM; the right prefix for other ecosystems; the Go module path, not a package inside it). Many projects publish several artifacts from one repository; try the core artifact. If it is still not indexed, fall back to the library's sources directly (GitHub, sources jar, IDE navigation).
- `No relevant results found.` - the library is indexed, so rephrase: use the library's own vocabulary (class names, config option names, error messages) instead of the project's.

## Query Tips

- Be descriptive: "default retry policy and backoff for failed HTTP requests" > "retry"
- Name the API you are asking about when you know it: "HttpRequestRetry configuration retryOnServerErrors"
- Search for the error message text to find where an exception is thrown
