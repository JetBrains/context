**Scope & Reference Run**

All primary statistics below come from the **latest `claude-opus-5-5` (`medium`) composite run** on `SWE-bench LG Private` (`522` trials = `174` unique issues × `3` seeds: `126` `Ultimate` + `396` `BenchRoom LG`):
- **Candidate run**: `jcp-1931570` (`2026-11-16`, `dev:0.9.21-no-imports-filter`, `EMBARK_FLAGS="--auto"`, Claude CLI `2.1.322`, `284/522` solved, `-0.6%` cost, `+10.1%` duration vs. matched baseline `jcp-1899094`).
- **Cross-checked against**: `jcp-1899090` (`release:0.9.21.1593` `--auto`, CLI `2.1.322`), `jcp-1928132` (`release:0.9.15.969` `artemk/gepa_optimized`), and `jcp-1931393` (`release:0.9.21.1593` `--auto` at `xhigh` effort).
- **Subagent audit**: Invoked literal `claude-opus-5-5` (`claude --bare --model claude-opus-5-5 --effort high`) on verbatim `jbcontext search` outputs and active `CLAUDE.md` instructions from `jcp-1931570`.

---

**Part 1: Why Opus Skips `jbcontext` When Locations or Identifiers Are Mentioned**

**1.1 The Active Instructions Explicitly Tell Opus to Skip `jbcontext`**

Under `--auto`, `jbcontext` installs `instructions/claude/context-instructions-noskills-aggressive.md` into `/home/builduser/.claude/CLAUDE.md`, which contains two explicit exit ramps:
- **Lines 26–29**: *"Skip it - go straight to the right tool - when: the task names the exact file, class, or symbol (keyword grep is faster); the relevant file is already open or identified"*
- **Lines 47–48**: *"Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection."*

(`artemk/gepa_optimized` in `jcp-1928132` contains the same rule: *"Skip semantic search when no discovery is needed: ... The task supplies an exact file or unambiguous code symbol that direct opening or exact search can locate."*)

**1.2 Skipping Is Deterministic Per Issue (`93.1%` Seed Unanimity), Not Random**

Across the `174` unique tasks (`3` seeds each with the exact same issue text):

| Seeds Calling `jbcontext` on the Same Issue | Tasks (`/ 174`) | Share | Interpretation |
|---|---:|---:|---|
| **`0 / 3` seeds called** (unanimous skip) | **`49`** | **`28.2%`** | Issue/repo deterministically suppresses `jbcontext` |
| `1 / 3` seeds called | `6` | `3.4%` | Borderline issue |
| `2 / 3` seeds called | `6` | `3.4%` | Borderline issue |
| **`3 / 3` seeds called** (unanimous call) | **`113`** | **`64.9%`** | Issue deterministically triggers `jbcontext` |

**`162 / 174` tasks (`93.1%`)** behave identically across all 3 seeds. Overall trial call distribution in `jcp-1931570`:
- **Combined (`522` trials)**: `165` zero-call (`31.6%`), `294` single-call (`56.3%`), `63` `2+` calls (`12.1%`).
- **`Ultimate` (`126` trials)**: `13` zero-call (**`10.3%`**), `107` single-call (**`84.9%`**), `6` `2+` calls (`4.8%`).
- **`BenchRoom LG` (`396` trials)**: `152` zero-call (**`38.4%`**), `187` single-call (`47.2%`), `57` `2+` calls (`14.4%`).

**1.3 Skip Rate Scales Monotonically With Issue Location / Identifier Specificity**

Your hypothesis is strongly confirmed by the data. Measuring anchors present in `problem_statement` across all `522` trials (`174` tasks):

| Anchor Present in `problem_statement` | Tasks (`Trials`) | Skip Rate (`jcp-1931570`) | Skip Rate When Absent | Ratio (`Yes / No`) |
|---|---:|---:|---:|---:|
| **Exact ground-truth full path** (`a/b/Foo.kt` in `patch`) | `3` (`9`) | **`100.0%`** (`9/9`) | `30.4%` (`156/513`) | **`3.3×`** |
| **Exact ground-truth filename** (`Foo.ext` in `patch`) | `12` (`36`) | **`83.3%`** (`30/36`) | `27.8%` (`135/486`) | **`3.0×`** |
| **Stack trace frame** (`at pkg.Cls(File.kt:N)` / `File.ext:line`) | `15` (`45`) | **`80.0%`** (`36/45`) | `27.0%` (`129/477`) | **`3.0×`** |
| **Exact ground-truth file stem / class** (`PostmanCookie`, etc.) | `30` (`90`) | **`75.6%`** (`68/90`) | `22.5%` (`97/432`) | **`3.4×`** |
| **Exact ground-truth diff symbol** (identifier modified in `patch`) | `44` (`132`) | **`60.6%`** (`80/132`) | `21.8%` (`85/390`) | **`2.8×`** |
| **Multi-segment repo file path** (any `dir/File.ext`) | `10` (`30`) | **`60.0%`** (`18/30`) | `29.9%` (`147/492`) | **`2.0×`** |
| **ANY ground-truth file, stem, or diff symbol** | **`57` (`171`)** | **`60.2%`** (`103/171`) | **`17.7%`** (`62/351`) | **`3.4×`** |

Grouping all `174` tasks (`522` trials) into **mutually-exclusive ground-truth-verified tiers** (and cross-checking across four Opus runs) shows an important nuance — Opus distinguishes **real internal symbols** (`GT1`/`GT2`) from **user-reproduction toy code** (`GT3`, such as `class LessonRepository` pasted by a YouTrack reporter):

| Mutually-Exclusive Issue Tier | Tasks (`Trials`) | `jcp-1931570` (`no-imports`) Skip | `jcp-1899090` (`rel 0.9.21`) Skip | `jcp-1928132` (`gepa_opt`) Skip | `jcp-1931393` (`xhigh`) Skip |
|---|---:|---:|---:|---:|---:|
| **`GT1`: Names exact `patch` file/path** | `12` (`36`) | **`83.3%`** | **`86.1%`** | **`91.7%`** | `58.3%` |
| **`GT2`: Names exact `patch` class/stem/symbol** | `45` (`135`) | **`54.1%`** | **`57.0%`** | **`59.3%`** | `23.7%` |
| **`GT3`: Has code/repro identifiers, none in `patch`** | `44` (`132`) | **`12.9%`** | `13.6%` | `23.5%` | `4.5%` |
| **`GT4`: No file or code symbol in issue** | `73` (`219`) | **`20.5%`** | `20.1%` | `18.7%` | `12.3%` |

Looking purely by **lexical tier** split by benchmark leg explains why `Ultimate` skips only `10.3%` while `BenchRoom LG` skips `38.4%`:
- **`T1` (file path / filename / stack trace)**: `52.2%` skip overall (`24.2%` `Ultimate`, **`68.4%` `BenchRoom LG`**).
- **`T2` (class / symbol / dotted config key)**: `31.5%` skip overall (`6.4%` `Ultimate`, **`45.1%` `BenchRoom LG`**).
- **`T3` (API route or exact quoted literal only)**: `25.3%` skip overall (**`0.0%` `Ultimate`**, `29.3%` `BenchRoom LG`).
- **`T4` (pure behavioral natural language)**: `21.1%` skip overall (**`0.0%` `Ultimate`**, `21.7%` `BenchRoom LG`).

In `Ultimate` (a massive monorepo where listing files is impossible), **when no file or code symbol is named (`T3` + `T4`), Opus calls `jbcontext` `100.0%` of the time (`15/15`)**.

**1.4 Complete Accounting of All `165` Zero-Call Trials (What Opus Did Instead on Turn 1)**

Inspecting Turn 1–2 tool calls across every single one of the `165` zero-call trials in `jcp-1931570` accounts for `100%` of skips:
1. **`133 / 165` (`80.6%` of all skips, or `85.3%` of the `156` active zero-call sessions)**: Opus extracts a **verbatim path, class, annotation, config key, or literal string directly from the issue** (e.g., `grep -rl "class PostmanCookie"`, `grep -rn "validation.group.pre-update"`, `cat .../SessionStatusSyncService.kt`) and runs `grep`/`cat` on Turn 1 (`126`) or Turn 2 (`7`).
   - **`90.9%` (`150/165`)** immediately get a non-empty repo hit on Turn 1.
   - **`70.3%` (`116/165`)** hit an **exact ground-truth `patch` file on Turn 1** without `jbcontext`.
2. **`19 / 165` (`11.5%`, all in `BenchRoom LG`)**: Small microservice repositories where Turn 1 reads `AGENTS.md` / `docs/ARCHITECTURE.md` (`9` trials) or runs `git ls-files` / `find src -type f` (`10` trials), exposing the entire `30–80`-file service layout on Turn 1 so location discovery is already finished before Turn 2 (explaining `BenchRoom LG`'s `21.7%` skip rate on `T4`).
3. **`4 / 165` (`2.4%`)**: Opus guesses an exact domain enum/constant on Turn 1 (`grep -rn "BRIGHT_CYAN\|BRIGHT_MAGENTA"`).
4. **`9 / 165` (`5.5%`)**: Aborted/empty sessions with `0` tool calls (`$0.00` container/harness failures).

**1.5 Does Opus Actually "Switch to Manual Read" After Calling `jbcontext`?**

Among the `357` trials that call `jbcontext` (`408` total `jbcontext search` invocations across `404` Bash calls):
- **Single-shot compliance is high (`82.4%`)**: `294 / 357` call `jbcontext` once; only `5.4%` (`25 / 460`) ever pass `-p <path>`.
- **Pipe filtering is near-total (`90.2%`)**: Out of `408` `jbcontext` invocations, **`335` (`82.1%`) are piped to `| head`** (mostly `head -40`, `head -50`, `head -30`, `head -60`), **`33` (`8.1%`) are piped to `| grep File:`** (deliberately discarding all snippets!), and **only `40` (`9.8%`) are truly unpiped**.
- **Opus rarely trusts `jbcontext` enough to switch purely to `Read`**: On the turn immediately following the first `jbcontext search`:
  - **`39.2%` (`140 / 357`)** run `grep`/`rg`/`find` **without reading any file returned by `jbcontext`**.
  - **`30.0%` (`107 / 357`)** read a `jbcontext` file **while simultaneously running `grep`/`find`** to verify/supplement.
  - **Only `13.7%` (`49 / 357`)** switch cleanly to direct file reads of `jbcontext` hits.
  - **`10.9%` (`39 / 357`)** immediately issue another `jbcontext search`.
  - Overall, visible `jbcontext` output (post-`head`) contains a ground-truth `patch` file in only **`40.3%` (`144 / 357`)** of caller trials, and in **`21.0%` (`75 / 357`)** of caller trials Opus **never opens a single file returned by `jbcontext` in the entire session**.

---

**Part 2: Through `claude-opus-5-5`'s Eyes — Information Density, Partiality, Ambiguity & Trust**

We passed active `CLAUDE.md` instructions plus **six verbatim `jbcontext search` outputs** from `jcp-1931570` (covering multi-module `BenchRoom LG` services, `TeamCity`, `Matterhorn`, and `IntelliJ Ultimate`, both unpiped and piped) to a `claude-opus-5-5` subagent, alongside a structural audit of all `404` `jbcontext` tool results in `jcp-1931570`.

**2.1 Corpus-Wide Structural Numbers Backing Opus 5.5's Critique (`404` Tool Outputs, `2,409` Entries, `1,129` Snippets)**

- **`53.1%` (`1,280 / 2,409`)** of all visible entries are **bare `N. File: <path>` lines** with zero symbol, score, or match reason (`0.3 < score ≤ 0.7` in `SearchResultFormatter.kt`).
- **`50.7%` (`205 / 404`)** of `jbcontext` outputs contain **duplicate entries for the exact same file** (`346` duplicate file slots).
- **`38.4%` (`925 / 2,409`)** of visible entries are **test / `testData` / fixture files**, frequently outranking production code.
- **`30.2%` (`341 / 1,129`)** of snippets — affecting **`56.9%` (`230 / 404`) of calls** — hit `HYBRID_CONTENT_MAX_LENGTH = 750` chars and **truncate mid-line with `...`** and no omitted-line count.
- **`23.9%` (`270 / 1,129`)** of snippets **start mid-block** (e.g., at `{`, parameter continuations, or inner statements) without the enclosing class/method header, and **`9.3%` (`105 / 1,129`)** are **`≤ 3`-line signature stubs** (`public class Foo extends Bar {`).

**2.2 Element-by-Element Information Density Audit (From `claude-opus-5-5`)**

| Output Element | Opus 5.5 Value Rating | Why (In Opus 5.5's Own Assessment) |
|---|---|---|
| **File path** in `N. File: <path>` | **Highest value** | Primary takeaway — maps which module/subsystem owns the behavior. However, repeating 100-char package prefixes across 10–30 entries wastes massive tokens. |
| **Line numbers** (`174\| ...`) | **Very high** | Directly usable as `Read` offsets and edit anchors. |
| **Snippets containing control flow** | **High** | When a chunk captures actual branching/calls (e.g., `when (command.executionOnResolvedPolicy)` + `getIssueSafe`, or `params["path"]` flowing unchecked into `Path.of(path)`), it diagnoses the bug immediately and surfaces internal identifiers to `rg` next. |
| **Rank integer `N.` without score** | **Near zero** | Rank `1.` vs `12.` means nothing without similarity scores or a visible "score cliff" showing where relevance drops off. |
| **`Content:` label & `Searched revision: <hash>`** | **Zero / Low** | `Content:` is pure framing overhead (indentation already marks code). `Searched revision` is never checked against `HEAD` — it would only be actionable if it warned `index ≠ HEAD (N dirty files unindexed)`. |
| **Signature-only stubs (`1–3` lines)** | **Low** | E.g., `41\| public class SpringDataRepositoryMethodParametersInspection extends ...` gives no more reasoning value than a 1-line path+symbol entry while burning 4 lines of `head` budget. |
| **Multiple fragments from the same file** | **Mostly waste** | Forces Opus to mentally reassemble 1–2 files from 4–5 scattered chunks, repeats long file paths, and crowds out distinct files under `\| head -40`. |
| **Bare `File:`-only tail (`53.1%` of entries)** | **Mixed / Ambiguous** | Sometimes hides the actual key file (`SpringDataPartTypes.java`, `youTrackDslConfig.kt`, `DescriptionBasedPipelineSettingsGenerator.java`), but with no symbol name or score it is indistinguishable from `8 × expected/pipeline.yml` test fixtures. |
| **Test data / PSI dumps** | **Negative** | 21 lines of `PsiElement(...)` parser tree dumps or YAML test fixtures actively burn context and push production files past the `head -40` cutoff. |
| **750-char `...` cutoffs** | **Harmful** | Cuts land at arbitrary character counts, frequently right before the payload (`logger.info(...`, `Iterable<Part> parts = partTree`, `try {`), with no `(+N lines → end)` indicator. |

**2.3 What Opus 5.5 Disregards as Partial, Ambiguous, or Untrusted**

1. **Disregarded as Partial (Forces Immediate Full-Function Re-Read)**:
   - Even when `jbcontext` hits the exact method, **orphan starts** (`23.9%`) omit the enclosing loop or class-level `@RequestMapping` annotation, while **750-char `...` cutoffs** (`30.2%`) chop off the downstream check or assertion (e.g., `SpringDataRepositoryMethodParametersInspection.checkParameters` cut at line `62` right before parameter-count checking; `YouTrackModule.kt` cut at line `112` right before command execution and without the outer loop). Opus still has to `Read` lines `60–140` of that file anyway, turning the snippet tokens into sunk cost except as a pointer.
2. **Disregarded as Ambiguous (Cannot Tell Role, Execution Path, or Match Reason)**:
   - **No `[main | test | testdata | ui]` distinction and no enclosing `Class › method` breadcrumb**: A mock helper (`YouTrackModuleTestBase.verifyServiceCalled`), a UI consumer (`web-core/controllers/RunBuildDependencies`), a neighbor test (`testFilePath$absolute` when the bug is relative paths), and 12 `testData/.../headers/*` files matching the query word `"Content-Type"` look structurally identical to core production code.
   - **Bare `File:` entries lack symbol/match context**: When 28–42 bare paths appear, Opus cannot tell *why* `CurlParser.java` or `SpringDataPartTypes.java` matched without grepping inside them.
3. **Disregarded as Untrusted (Why `69.2%` Run `grep`/`find` Immediately After `jbcontext`)**:
   - **Incompleteness by nature**: Semantic top-K is a sample, never an exhaustive enumeration. Any fix touching a shared policy, helper, or interface requires *all* call sites/implementations — which only `rg` guarantees.
   - **Named-symbol misses destroy session trust**: When an issue names a real class (e.g., `BuildTypeDependencies` in `TeamCity-446`) and `jbcontext` omits its definition while ranking test files `#2–#5`, Opus explicitly notes that it **discounts `jbcontext` ranking for the rest of the session** (in the real `TeamCity-446` trajectory, this triggered a retry and `grep`).
   - **Uncommitted-edit blindness**: Once Opus edits any file, it cannot tell if `jbcontext` reflects dirty state and stops trusting it locally.

**2.4 Why Opus Reflexively Pipes to `| head -40` (`82.1%`) or `| grep File:` (`8.1%`) — and Why That Breaks `HYBRID` Output**

Opus 5.5 explained this interaction directly:
- **Why Opus pipes**: `CLAUDE.md` gives **zero indication that `jbcontext search` output is bounded**. In Bash, Opus treats unfamiliar search CLIs like `grep -r` or `find` that might dump thousands of lines into permanent session context, so `| head -40` is reflexive context insurance (and `| grep File:` on `8.1%` of calls is the opposite workaround when Opus expects snippets to be too verbose).
- **The `HYBRID` × `| head -40` layout collision**: `SearchResultFormatter.kt` (`HYBRID` mode) places **expensive, multi-line snippets (`5 ×` up to `750` chars, often tests, duplicates, or PSI dumps) at the top** and **compact 1-line `File:` paths at the bottom**, with **no total-hit header or truncation footer**.
  - `| head -40` keeps `2.1–4` verbose chunks (frequently tests or duplicate chunks of 1 file) and **silently slices off ranks `#5–#30` where the production file paths sit** — explaining why only `40.3%` of `jbcontext` calls surface a ground-truth `patch` file in the post-pipe output seen by Opus.
  - Worse, because there is no `showing 5 of 33 hits` header/footer, a `head`-chopped list looks complete or dead-ended.

**2.5 Concrete High-Density Output Changes Opus 5.5 Asked For**

1. **Self-budget total output to `~2.0–2.5 KB`** and state explicitly in `CLAUDE.md`: *"Output is already compact and capped (~2.5 KB); never pipe `jbcontext search` into `head` or `grep`."*
2. **Put a summary + freshness header on Line 1**: `jbcontext · 33 hits, showing top 8 · index = HEAD` (or warn if dirty/behind), so even if truncated, total hit count is known immediately.
3. **Deduplicate/merge per file** (`YouTrackClient.kt:49,56` instead of repeating 2 chunks + 100-char pathprefixes), alias common directory prefixes, and **collapse fixture/testData families** (`8 × .../expected/pipeline.yml`, never render `PsiElement(...)` / `testData` bodies as snippets).
4. **Add structural metadata per hit instead of `File:` / `Content:` boilerplate**:
   - Score + explicit `--- score cliff ---` divider, `[main | test | testdata]` tag, `path:start-end`, and **enclosing symbol breadcrumb + full function span** (`YouTrackModule › processCommand [fn 84-131]`).
   - Cap rich snippets at **3 production-biased snippets × ≤10 lines centered on the matched logic**, with explicit omitted-line markers (`…(+21 lines → 131)`) instead of raw `750`-char mid-token `...` cuts; move 1-line class/method signature hits and tail hits onto compact single lines (`score kind path › Symbol`).
5. **Hybrid exact-identifier anchor**: When a query contains a verbatim repo symbol (`BuildTypeDependencies`), guarantee its definition is pinned (`exact`) so semantic ranking never misses an explicitly named class.
   
#### Task experiment results:

## Pre-Experiment Diagnosis: Why Piping Happens & Why "Unordered List" Framing Fails

Before modifying instructions, we tested whether Opus's `90.2%` pipe rate (`82.1%` `| head`, `8.1%` `| grep File:`) stems from assuming `jbcontext search` returns a ranked top-K list — and whether framing it as unordered would stop piping. Trajectory evidence from `jcp-1931570` and matched `BASELINE` (`jcp-1899094`) rules this out:

1. **Opus pipes *unordered* Bash commands at the same `87–95%` rate**: Turn-1 recursive `grep -r` / `rg` (arbitrary filesystem walk order) is piped to `| head` **`87.0%`** (`114/131`) in `jcp-1931570` and **`95.0%`** (`415/437`) in `BASELINE`, matching Call #1 `jbcontext search` (`89.6%`, `320/357`). `head -30/-40/-50/-60` is a universal Bash stdout circuit-breaker, not top-K extraction.
2. **Call #1 vs. Call #2+ proves `| grep File:` is a reaction to `| head` clipping the `File:` tail**:
   - **Call #1 (`357` calls, output format unseen)**: **`89.6%`** `| head`, **`0.0%`** `| grep File:`, `10.4%` unpiped.
   - **Call #2+ (`51` calls, after seeing `HYBRID` output)**: `29.4%` `| head`, **`64.7%`** `| grep File:`, `5.9%` unpiped (`22` `HEAD → GREP_FILE` transitions vs. **`0`** `UNPIPED → GREP_FILE`).
3. **Why "unordered list" framing would backfire**: Without a bounded-output guarantee, stdout-flood fear remains intact (or pushes Call #1 straight into `| grep File:`, discarding all snippets), while destroying the real `HYBRID` relevance boundary (`score > 0.7` snippets vs. `0.3–0.7` tail paths where `38.4%` are tests/fixtures).
4. **Instruction gap**: `instructions/junie/context-instructions-noskills.md` already explicitly forbids piping (`Run jbcontext search on its own and read its whole output: don't pipe it into head, grep or other commands`), whereas `instructions/claude/` had no output-size or piping guidance.

## Local Parity Lab Setup & Calibration (`live_parity_v1`)

To iterate rapidly on prompts and formatter changes before running full `522`-trial TeamCity evaluations, we built `local-lab/local_lab.py` mirroring `JbContext.kt` + `ClaudeExecutor.kt` with `claude-opus-5-5` (`medium`), Claude Code `2.1.322`, `jbcontext 0.9.21.1593 --auto`, and a local HTTP prompt server (`--prompts-source local`), covering `12` gradable tasks (`all12` = `jbc3` `jbcontext`-specific suite + `gradable9` / `lg5` shared suite):
- **Live parity (`1`-seed calibration, `live_parity_v1`)**: `12/12` (`100%`) prompt/transcript parity; **`7/12` (`58.3%`)** solved vs. `20/36` (`55.6%`) live; mean cost **`$0.387`** vs. `$0.414` live (`$0.466` vs. `$0.471` live on `lg5`, `-1.2%`; `15.6` vs. `16.2` turns).
- **Behavioral reproduction**: Reproduced the **`90.0%`** `| head` rate (`9/10` calls vs. `89.6%` live Call #1) and **`80.0%`** immediate post-`jbcontext` `grep`/`find` rate (`69.2%` live).

## Piping fix via result boundary safety instructions

### 1. Instruction Iteration & Piping Results (`local-lab`, `claude-opus-5-5` `medium`, `jbcontext 0.9.21.1593 --auto`)

To eliminate Opus's reflexive `| head -30/-40` piping without changing the CLI binary, we iterated on `instructions/claude/context-instructions-noskills-aggressive.md` and tested locally against previously-piping tasks from `live_parity_v1`:

| Experiment | Instruction Variant | Tasks Tested | Call #1 Pipe Mode | Unpiped Rate |
|---|---|---|---:|---:|
| `live_parity_v1` (baseline) | Default `--auto` (no output-size info) | `751`, `pat-145174`, `aip-1103`, `aip-1283` | `head -30/-40` on `4/4` | **`0%` (`0/4`)** |
| `exp_bounded_output_v1` | Explicit anti-pipe + bounds under `### Usage` | `751`, `pat-145174`, `aip-1103`, `aip-1283` *(+ `jcp-434` skipped)* | `unpiped` on `4/4` calling | **`100%` (`4/4`)** |
| `exp_bounded_neutral_v1` | Neutral bounds in separate `### jbcontext result boundaries` section (no anti-pipe rule) | `751` | `head -60` (`1/1`) | **`0%` (`0/1`)** |
| `exp_bounded_neutral_v2` | Neutral bullet inside `### How to use it` stating result bundle is information-dense, bounded, and safe to read in full | `751` | `unpiped` (`1/1`) | **`100%` (`1/1`)** |
| `exp_bounded_neutral_v3` | Same neutral bullet (typos fixed) on a second task | `pat-145174` | `unpiped` (`1/1`) | **`100%` (`1/1`)** |
| `exp_bounded_neutral_no_dense_v1` | Same bullet inside `### How to use it` with `"information-dense"` sentence removed (placement ablation) | `751` | `unpiped` (`1/1`) | **`100%` (`1/1`)** |

Key takeaway on wording & placement:
- A standalone neutral section (`exp_bounded_neutral_v1`) only relaxed the cap slightly (`head -40` → `head -60`) and did not stop piping.
- Moving the same neutral boundedness statement directly into `### How to use it` as an actionable bullet stopped piping on **`2/2`** distinct tasks (`751` and `pat-145174`) without needing a negative prohibition, and removing `"information-dense"` (`exp_bounded_neutral_no_dense_v1`) still kept `751` **unpiped** — indicating that **placement inside the active `### How to use it` procedural list** is a major driver alongside wording.

### 2. Per-Task Comparison (Truncated vs. Untruncated)

| Task | Run | Pipe Mode | Output Seen (Lines / Chars) | Turns | Duration | Cost | Result |
|---|---|---|---:|---:|---:|---:|---|
| `751` | `live_parity_v1` | `head -40` | `71` lines* / `2.6 KB` | `11` | `109.2s` | `$0.348` | `PASS` |
| `751` | `exp_bounded_output_v1` | `unpiped` | `132` lines / `5.5 KB` | `9` | `90.8s` | `$0.325` | `PASS` |
| `751` | `exp_bounded_neutral_v1` | `head -60` | `60` lines | `10` | `91.2s` | `$0.378` | `PASS` |
| `751` | `exp_bounded_neutral_v2` | `unpiped` | `149` lines / `6.6 KB` | `13` | `126.4s` | `$0.506` | `PASS` |
| `751` | `exp_bounded_neutral_no_dense_v1` | `unpiped` | `125` lines / `5.4 KB` | `9` | `90.3s` | `$0.377` | `PASS` |
| `pat-145174` | `live_parity_v1` | `head -40` | `67` lines* / `2.7 KB` | `8` | `85.1s` | `$0.285` | `PASS` |
| `pat-145174` | `exp_bounded_output_v1` | `unpiped` | `147` lines / `7.0 KB` | `8` | `64.0s` | `$0.327` | `FAIL` |
| `pat-145174` | `exp_bounded_neutral_v3` | `unpiped` | `114` lines / `5.4 KB` | `9` | `63.8s` | `$0.257` | `FAIL` |
| `aip-1103` | `live_parity_v1` | `head -40` | `64` lines* / `3.8 KB` | `15` | `201.5s` | `$0.406` | `PASS` |
| `aip-1103` | `exp_bounded_output_v1` | `unpiped` | `105` lines / `6.2 KB` | `26` | `102.5s` | `$0.691` | `FAIL` |
| `aip-1283` | `live_parity_v1` | `head -30` | `30` lines / `1.3 KB` | `8` | `76.0s` | `$0.229` | `FAIL` |
| `aip-1283` | `exp_bounded_output_v1` | `unpiped` | `121` lines / `6.5 KB` | `8` | `80.2s` | `$0.265` | `FAIL` |
| `jcp-434` | `live_parity_v1` | `head -40` | `~40` lines | `8` | `51.8s` | `$0.283` | `PASS` |
| `jcp-434` | `exp_bounded_output_v1` | `none` (0 calls) | — | `12` | `67.6s` | `$0.428` | `PASS` |

*(Notes: `*` indicates chained Turn-1 Bash commands (`cat issue.md; ls; jbcontext ... | head -40`) where total tool-result lines include `issue.md`/`ls` output. `pat-145174` has known single-seed solve variance — `1/3` solved in live `jcp-1931570` — due to an underspecified parser test; `jcp-434` has a named anchor and skipped `jbcontext` `0/3` in live runs.)*

### 3. How the Agent Behaves With Access to the Untruncated Result

Inspecting Turn 2+ actions across all unpiped runs (`exp_bounded_output_v1`, `exp_bounded_neutral_v2`, `exp_bounded_neutral_v3`, `exp_bounded_neutral_no_dense_v1`) shows a clear split between how Opus consumes the **snippet zone** vs. the **bare `File:` tail**:

1. **High utilization of the snippet zone (`#1–#5`), cutting discovery hops**:
   - Across the 4 unpiped trials in `exp_bounded_output_v1`, Opus read/used **`90.9%` (`10/11`)** of unique files appearing in the snippet zone (`#1–#5`).
   - With lower snippets no longer sliced off by `| head -40`, Opus immediately opens multiple relevant files on Turn 2 instead of running exploratory `grep`/`find` first:
     - On `751`, Turn 2 directly `cat`ted `GitFileDiffUtil.kt` and `JVMGitDiffProvider.kt` (plus `GitDiffUtilsTest.kt` and bare `#10 filesModified.diff` in `v1`), cutting turns from `11` → `9` and duration from `109.2s` → `90.3–90.8s` in `v1` and `no_dense_v1`.
     - On `pat-145174`, Turn 2 immediately opened `YouTrackModule.kt` (and `#5 YouTrackService.kt` in `v1`; in `v3`, Turn 3 jumped straight to `getIssueSafe` in `YouTrackService.kt` and Turn 4 began editing), dropping duration from `85.1s` → `63.8–64.0s`.
     - On `aip-1103`, Opus directly opened bare `#6 FileClusterBuilderTest.kt` plus `#7/#8 ClusterFileIndexer*.kt` without grepping for the test file, cutting wall-clock duration nearly in half (`201.5s` → `102.5s`) though it burned extra turns iterating on the fix.
2. **Low utilization of the bare `File:` tail (`#6+`)**:
   - Across `exp_bounded_output_v1`, Opus opened only **`15.4%` (`6/39`)** of unique files in the bare `File:` tail.
   - It exclusively opened bare paths in ranks `#6–#10` whose filenames were self-evident (`*Test.kt`, `dto.kt`, `ClusterFileIndexer*.kt`, `filesModified.diff`).
   - It ignored **`0/13`** bare entries on `aip-1283` and missed **`#11 YouTrackFixedIssuesParser.kt`** (the second gold file on `pat-145174`) even though unpiping raised visible gold recall from `0.50` → `1.00`.
3. **Exposed next bottleneck (`SearchResultFormatter.kt`)**:
   - Even with full unpiped output, **`45.0%` (`9/20`)** of the 5 snippet slots were duplicate chunks of `#1` (`5/5` on `aip-1103`, `3/5` on `pat-145174` and `aip-1283`, `2/5` on `751`), while Opus still `cat`ted `#1` in full on Turn 2 in every trial.
   - Deduplicating snippets per file (1 best snippet per file) and attaching enclosing symbol/line context to bare `#6+` paths are the clearest next levers to test locally.

### 4. Why Opus Still Truncated Under Neutral Bounds (`| head -60`) — Opus 5.5 Introspective Audit

To understand why `exp_bounded_neutral_v1` still produced `| head -60` (rather than unpiped) even after explicitly stating that the bundle is bounded and `"safe to read in full"`, we sent the verbatim `live_parity_v1`, `exp_bounded_neutral_v1`, `exp_bounded_neutral_v2`, and `exp_bounded_output_v1` instructions and Turn-1 commands to `claude-opus-5-5` (`claude --model claude-opus-5-5 --effort high`) for an introspective audit.

#### Drivers Beyond Unbounded-Output Fear
1. **Turn-1 "skim mode" habit (phase-level, not tool-level)**: On Turn 1, Opus defaults to piping unfamiliar exploration commands to `| head`. Notably, in both `live_parity_v1` and `exp_bounded_neutral_v1`, Opus even ran `cat issue.md | head -5` on the same command line — truncating the task description itself, which has no flood risk. When `v2` and `no_dense_v1` switched to unpiped `jbcontext search`, `cat issue.md` also became unpiped, indicating a turn-wide switch from *skim mode* to *read mode*.
2. **`"Safe to read in full"` reads as permission, not a warning of lost value**: `"Safe"` only says nothing bad will happen; it does not say truncating loses useful information. With truncation still appearing free, the `| head` habit wins.
3. **Asymmetric / invisible truncation cost**: Output flooding is immediately visible; silently cutting off the right file at line 61 is invisible. Without an explicit reason to value the tail, truncating looks rational.
4. **Internal arithmetic calibration (`head -40 → head -60`, not dropping `| head`)**: Rather than convincing Opus that the full output was small enough to read raw, the explicit structural spec (`"at most 5 short code snippets up to 750 chars each, followed by compact one-line File: paths, capped at 50 results total"`) gave Opus the exact numbers needed to *tune* its `| head` cutoff:
   - **Mental line-count conversion**: Opus translated `5 snippets × 750 chars` (~`3.75 KB` ≈ `60–90` lines including `File:`/`Content:` headers) + up to `45–50` one-line `File:` paths into **`~110–150` lines total** (closely matching the actual `105–149` lines / `5.4–7.0 KB` seen in unpiped runs).
   - **Signal-vs.-tail mental split**: Because `v1` stated no value claim for the `File:` tail, Opus's prior assumed relevance drops sharply after the top snippets — making `"up to 50 results"` sound like ~45 lines of low-signal semantic tail clutter rather than a navigation map.
   - **Surgical cap tuning (`40 → 60`)**: Armed with that estimate, Opus didn't ask *"is 150 lines safe?"* — it asked *"how many lines do I need to capture the snippets without paying for the tail?"* and bumped its default blind guard from `head -40` to **`head -60`**, ironically slicing right across the lower snippets (`#3–#5`) and dropping `100%` of the `File:` list.
   - **Design implication**: Enumerating component-level caps (`5 × 750 chars + 50 paths`) invites the model to do line-budget arithmetic and visually separates the output into a "keep" zone and a "trim" zone. Expressing the bound in **holistic, model-native units** (e.g., *"~100 lines / ~1.5k tokens total — smaller than reading a single source file, already relevance-truncated"*) eliminates both the arithmetic trigger and the illusion that cutting lines `61+` saves meaningful context.
5. **Chained Turn-1 commands + mild doc skepticism**: Combining `cat; ls; jbcontext` in one Bash call encourages capping each segment, and unpolished phrasing (e.g., the stray `)` and `"bounded at most"` in `v1`) slightly lowers trust in tool docs.

#### Factor Weights (`v1` vs. `v2`) & Placement Ablation
- **Placement inside `### How to use it` (High weight)**: `### How to use it` is the active operational checklist Opus follows when constructing the Turn-1 command, whereas a standalone `### jbcontext result boundaries` section reads as passive reference metadata. Our ablation (`exp_bounded_neutral_no_dense_v1`, removing `"information-dense"` while keeping the bullet in `### How to use it`) stayed **unpiped** on `751` (`125` lines, `5.4 KB`, `9` turns, `PASS`), directly supporting placement as a strong lever (subject to `n=1` sampling variance).
- **`"Information-dense result bundle"` (High weight in Opus's assessment)**: The only phrase in `v2` that makes a *value claim* challenging the prior that `#6–#50` bare paths are filler.
- **Sampling variance caveat (High weight on `n=1–2`)**: Opus explicitly cautioned that single-trial comparisons (`n=1` for `v1` and `no_dense_v1`, `n=2` for `v2/v3`) cannot cleanly separate placement, `"information-dense"`, and Turn-1 skim/read variance; `n ≥ 20` per arm is needed to measure exact rates.

#### Reliability Prediction & Recommended Framing
- **Predicted reliability across 100 diverse tasks (`medium` effort)**: Opus estimates neutral procedural wording (`v2`) will achieve **`~65–80%` unpiped** (`80%` CI: `50–90%`), compared to **`95%+`** with an explicit anti-pipe rule. Residual slip-back to `| head` is most likely on chained Turn-1 commands (`cd; cat; ls; jbcontext`), large monorepos / broad queries, long prompts, long `CLAUDE.md` files, and defensive `2>&1` commands.
- **What actually shifts Opus's Turn-1 cost-benefit calculation**:
  1. State **what truncation costs** (that the ranked `File:` list after the snippets is the navigation map and often holds the target file when top snippets don't).
  2. Express size in **model-native units** (`~100 lines / ~1.5k tokens, smaller than reading one source file`) instead of raw `5 × 750 chars + 50 paths` arithmetic.
  3. Frame output as **already relevance-truncated by the tool** (making `| head` redundant double-truncation).
  4. Keep the bullet inside `### How to use it`, and optionally pair the rationale with a concise prohibition (`Read jbcontext search output in full — do not pipe to head/tail`) to cover habit-driven Turn-1 calls where costs are not explicitly weighed.

### 5. Synthesized Takeaways & Next Experiment Levers

1. **Prompt-level piping fix (ready for multi-task validation)**: Place the boundedness + truncation-cost bullet inside `### How to use it` (using model-native size units and explaining the value of the `File:` navigation map, optionally paired with a concise no-pipe rule) and benchmark on `all12` (`≥ 2–3` seeds) before a full `522`-trial TeamCity run.
2. **Formatter-level information density (`SearchResultFormatter.kt`, highest-leverage next code change)**: Unpiping alone raised snippet-zone utilization to **`90.9%`**, but exposed two structural bottlenecks that prompt wording cannot fix:
   - **Per-file snippet deduplication**: `45.0%` of snippet slots in unpiped runs (`50.7%` of live calls) are duplicate chunks of `#1`, wasting slots that could surface distinct production files.
   - **Enriching the bare `File:` tail (`#6+`)**: Opus ignored `84.6%` of bare paths (`33/39`), including gold file `#11 YouTrackFixedIssuesParser.kt`. Adding enclosing symbol + line range (`path:start-end › Class.method`), `[main|test|testdata]` tags, score/cliff markers, and collapsing testData/PSI dumps directly targets both tail utilization and trust.
3. **Skip-behavior takeaway**: `70.3%` of Opus's zero-call skips (`116/165`) already hit a gold file on Turn 1 via verbatim anchors; forcing `jbcontext` on exact-anchor tasks is likely net negative, whereas narrowing skip rules only matters for multi-file/indirect tasks (e.g., `jcp-433`).
