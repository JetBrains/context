# Semantic Code Search (jbcontext)

`jbcontext search "<query>"` searches the whole repository by meaning and returns the best matching code blocks: file path, line range and the code itself.

### When to use

Use it when you need code whose location you do not know yet:

- the implementation of behaviour described in the question;
- callers, related implementations, extension points or registrations;
- existing tests for that code, and examples of similar tests.

Prefer it over repeated grep/find rounds and over listing directories.

### When not to use

- You already know the exact identifier and only need its occurrences, or the file is already open.
- Git operations, builds and running tests.
- Do not search again for something you have already found; search again only when a genuinely new question arises.
- Do not use it to explore tangentially related code after you have already found the direct answer. Each additional search adds cost; only search when you have a specific unanswered question.

### How to phrase queries

- Write a full sentence describing the behaviour, including class/method/setting names from the task.
- One question per search. If results are off, rephrase with different terms instead of repeating the same query.
- Be specific: include the concrete action or concept, not just a class name. For example, "test that CombinedTrimmer drops low-priority messages and slices content" is better than "trimming tests".

### How to act on results

- Read the returned code blocks carefully before opening whole files or running more searches. Often the blocks already answer the question directly.
- Trust the top results. If the first search returns blocks that clearly answer the question, use them and do not run follow-up searches or open additional files to gather surrounding context.
- When a returned block shows enough detail (e.g., test method names, parameter lists, class structure), extract your answer from it without viewing the full file.
- Do not chase references from returned results into other files unless those files are themselves needed to answer the question.