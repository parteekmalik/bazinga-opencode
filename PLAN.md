# bazinga-opencode — build plan

**Status:** planning only. Nothing in this repo is built, installed or committed.
**Scope:** OpenCode only. OpenCode 2 (the `Plugin.define` / `plugins` API).
**Thesis:** the plugin is a **frame**, not a ruleset. Every base layer is invariant across projects; every project supplies its own rules through one narrow slot.

---

## 1. What this repo is

An OpenCode plugin that provides a stable skeleton for agentic work on *any* project:

- two roles — a tool-less **CEO** and a tool-ful **01-manager**
- one contract between them — a **brief** down, one **terminal report** up
- the machinery that makes that contract hold: spawn-time context injection, a codebase map, task isolation, and the records the CEO reasons over

It does **not** ship opinions about how code should be written. A project supplies those. This is the whole reason for the base/project split in §3.

### Why the split exists

Rules change from project to project: naming, structure, language conventions, test strategy, what counts as risky, what may never be touched. A plugin that hard-codes any of that is usable on exactly one project.

Conversely, the *contract* — how a task is declared, how a result is reported, when an agent must stop — does not change per project. That is the base.

So: **base layers are mechanisms. Project layers are content.** A base layer that needs project knowledge must take it as an explicit parameter, never a default.

---

## 2. Install

Designed so installation needs no publishing step and no hosted install script.
There are two routes: the installer for anything that lives as a file, and
`plugin add` for the plugin alone.

### The installer

`registry.json` lists what this repository can place into an OpenCode folder.
The CLI copies only what is selected and records what it wrote.

```sh
node bin/bazinga.js list
node bin/bazinga.js install --global --only plugin:core
node bin/bazinga.js install --global --only agent:ceo,agent:01-manager
node bin/bazinga.js install --global --all
```

Destinations are `--global` (`~/.config/opencode`), `--project` (`./.opencode`)
or `--target <absolute path>`. `--dry-run` prints the plan and writes nothing;
`--no-config` never touches `opencode.json`; `--force` is required to replace an
existing install. Uninstall reads the receipt the install wrote.

This is the only route that can place **agents** — see below. It also lets a
user take one skill or one agent without the plugin or the rest of the
repository.

### Plugin only

```sh
opencode plugin add github:parteekmalik/bazinga-opencode
```

```
/bazinga-init      # places the two agent definitions, reports what it wrote
/bazinga-doctor    # verifies this OpenCode build actually supports what we rely on
```

`/bazinga-init` is the in-session equivalent of the installer's agent
components. No `curl | bash`, no npm publish, no manual file copying.

**Why `github:` works with no publish:** `opencode plugin add` accepts npm-compatible Git package specifications — hosted shortcuts (`github:owner/repo`), HTTPS, SSH including private repositories, plus branches, tags and complete commit hashes. There is no registry step in the critical path.

Pin it for stability, since a full commit hash stays pinned on update:

```sh
opencode plugin add github:parteekmalik/bazinga-opencode#<sha>
opencode plugin update     # unpinned npm/Git is checked; exact versions and full SHAs are skipped
```

### How this compares to what other plugins do

| Approach | Who uses it | What it costs |
|---|---|---|
| `curl \| bash` installer | OpenAgentsControl, oh-my-openagent | A hosted script; writes into the global OpenCode config; needs its own updater (`update.sh`) and `--install-dir` handling |
| npm publish + `plugin add` | ponytail | An npm account, a publish step, and version discipline in the critical path |
| Git spec + `plugin add` | the plugin-only route here | One command, no publish, `plugin update` handles updates — but it cannot place agents |
| **Node CLI + `registry.json`** | **this repo** | One checkout, no publish, granular components, receipt-backed uninstall. No hosted script |
| Config array only | several | Manual edit of `opencode.json` |
| Auto-discovery | ponytail (from a checkout) | Zero config, but per-checkout and not shareable |

The `curl | bash` route is the right answer when you are dropping many files into `~/.config/opencode/` — that is genuinely what OAC and OmO do. This repository does drop files now: agents, skills and commands. So it needs an installer. It uses a Node CLI instead of a hosted shell script, which keeps the same ground without `curl | bash`: `--dry-run`, `--force`, component selection and a receipt for uninstall.

### The one thing a plugin cannot install

**Agents.** V2's `AgentEditor` exposes `list`, `get`, `default`, `update` and `remove` — there is **no `add`**. Commands, skills and tools all have `add`; agents do not.

Agents come from two places instead:

- an `agents` key in any OpenCode config file
- markdown files at `~/.config/opencode/agents/<name>.md` (global) or `.opencode/agents/<name>.md` (project). Nested paths become part of the ID: `.opencode/agents/team/reviewer.md` → `team/reviewer`

The installer is the primary route: `node bin/bazinga.js install --only agent:ceo` copies the markdown into the chosen destination and records it. `/bazinga-init` is the in-session equivalent, registered by the plugin (a plugin *can* register commands), for when the plugin is already installed and the user does not want to leave the session.

`/bazinga-init --project` writes into `.opencode/agents/`; the default writes globally. It prints every path it touched, and `--uninstall` removes exactly those.

### The other three ways in

**Project-scoped instead of global:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:parteekmalik/bazinga-opencode"]
}
```

Relative paths resolve from the config file containing the entry. Plugin arrays from the applicable config files are applied **lowest to highest precedence**, not replaced:

```
~/.config/opencode/opencode.jsonc     lowest
./opencode.jsonc
./.opencode/opencode.jsonc            highest
```

**Zero-config development** — no config entry at all:

```
.opencode/plugins/index.ts
```

A project install by the CLI lands at `.opencode/plugins/bazinga/index.ts`, which
is discovered the same way.

OpenCode loads direct `.ts` and `.js` files *and* immediate plugin package directories from every discovered `.opencode/plugins/`. `.ts` loads directly, so there is no build step. Note the constraint: a `plugins/` directory sitting beside a project-root `opencode.json(c)` is **not** discovered automatically — it must be under `.opencode/`.

**Install once globally, opt out per project.** Entries are processed in order, `-` disables, `*` matches every plugin and `.*` matches an ID prefix:

```jsonc
{ "plugins": ["-bazinga-opencode"] }
```

### Uninstall

```sh
node bin/bazinga.js uninstall --global
opencode plugin remove bazinga-opencode
/bazinga-init --uninstall     # removes the agent files it wrote
```

The installer removes exactly the paths and config entries recorded in its
receipt, then deletes the receipt. Nothing else is left behind: per-project
settings live in the project's own `opencode.json`, and the CEO's runtime
bookkeeping lives in plugin-scoped storage (§4, B8).

---

## 3. The central split

### The rule that keeps the base reusable

> **Base layers never default. A project value is either supplied explicitly or absent.**

The failure mode this prevents is drift: a project value quietly becoming a base default, and the base then carrying one project's assumptions forever. An absent value must produce *no behaviour*, not a sensible guess.

### What is invariant, what varies

| Concern | Kind | Why |
|---|---|---|
| Host adapter, plugin export shape | **Base** | OpenCode's API does not vary per project |
| Registration via transforms | **Base** | Same roster everywhere |
| Agent definition files | **Base** | A plugin cannot create agents, so they ship as files |
| Brief and report schemas | **Base** | The interface; must be identical on both ends |
| Halt conditions, anti-guessing rule | **Base** | Structure of the safety model |
| Authority ladder | **Base** | Who may decide what |
| Spawn-time context injection | **Base** | Mechanism; contents come from project |
| Request-hook parity across kinds | **Base** | Prompt-cache correctness |
| Codebase map generator | **Base** | Algorithm invariant; file patterns are project |
| Task isolation | **Base** | Native worktree API; destinations are project |
| Records and ledgers | **Base** | Formats invariant |
| Diagnostics | **Base** | Capability probing |
| **Discipline and rules text** | **Project** | The whole point |
| **Conventions, forbidden paths** | **Project** | Project-specific by definition |
| **Test predicate overrides** | **Project** | "Risky" differs by domain |
| **Allowed tools per role** | **Project** | Depends on the project's toolchain |
| **Stack rules** | **Project** | TS/Python/Go all differ |
| **Never-cut additions** | **Project** | Regulatory or product constraints |

The base is deliberately larger than the project surface, because that is what gets reused: **nine of the eleven layers in §4 are base layers**, and only B2 and B3 are backed by project input.

---

## 4. The layer stack

Numbered bottom-up. `BASE` is invariant; `PROJECT` is supplied per project.

| # | Layer | Kind | Owns |
|---|---|---|---|
| B0 | Host adapter | BASE | Version detection, export shape, config precedence, fail-open, timeouts |
| B1 | Registration | BASE | Commands, skills, tools via transforms; agent files via `/bazinga-init` |
| B2 | Rules slot | **PROJECT** | Discipline text — the only place rules enter |
| B3 | Convention intake | **PROJECT** | Write-set defaults, forbidden paths, stack rules, predicate overrides |
| B4 | **Contract** | BASE | Brief, report, terminal events, halt rules, authority ladder |
| B5 | Context assembly | BASE | Spawn-time injection: role + brief + catalogue + rules |
| B6 | Orientation | BASE | Codebase map, interface index |
| B7 | Isolation | BASE | Worktrees, via the native API |
| B8 | Records | BASE | Report archive, pending decisions, debt ledger |
| B9 | Observability | BASE | Reason codes, evidence capture, ask-rate. Off by default |
| B10 | Diagnostics | BASE | `/bazinga-doctor` — probe capabilities before trusting them |

### B0 · Host adapter

Everything that depends on OpenCode's shape and nothing else.

**Layer rules:**

- Use the V2 `Plugin.define` shape. A V1 shim is not planned; the single default export leaves the door open if it ever becomes free.
- **Exactly one plugin-shaped export per module.** OpenCode's legacy loader treats every exported function from a plugin module as a plugin, so a helper left exported gets called as a plugin and throws.
- **Return a cleanup function.** `setup` may return one, and unloading the plugin disposes its registrations automatically.
- Fail **open** on every hook. Missing, unparseable or timed-out input means "proceed", never "block".
- Guard any regex used at spawn time — a synchronous `.test()` against a pathological pattern blocks the event loop.
- No side effects at import. Reading files at module scope is fine; writing is not.

### B1 · Registration

| Artifact | Mechanism | Can the plugin add it? |
|---|---|---|
| Commands | `ctx.command.transform(e => e.add({ name, description, execute }))` | **Yes** |
| Skills | `ctx.skill.transform(e => e.add({ id, name, description, path, content }))` | **Yes** |
| Tools | `ctx.tool.transform(e => e.add({ name, description, input, execute }))` | **Yes** — with optional `namespace` and `codemode` |
| **Agents** | `agents/*.md` files or the `agents` config key | **No** — no `add` in `AgentEditor` |

The roster:

| Artifact | Id | Role |
|---|---|---|
| Agent | `ceo` | Tool-less. Decompose, arbitrate, own the user channel |
| Agent | `01-manager` | Tool-ful. Scope, build, verify, review, report |
| Command | `/bazinga` | Show or switch the rules level |
| Command | `/bazinga-init` | Write or remove the agent definition files |
| Command | `/bazinga-doctor` | Probe host capabilities (B10) |
| Command | `/bazinga-report` | Show the last terminal report / pending decisions |
| Command | `/bazinga-debt` | Harvest `shortcut:` markers into a ledger |
| Skill | `base-contract` | The brief/report contract and halt rules |
| Skill | `base-review` | Read-only review contract |
| Skill | `base-audit` | Read-only repo audit contract |
| Skill | `base-ladder` | The borrowable minimal-change ruleset (absent by default) |

Two mechanics worth knowing:

- **Registration order matters, and later registrations win.** "A later valid registration overrides the same effective tool name."
- **Each model request captures a stable tool snapshot.** Later transforms and reloads affect *future* snapshots, not definitions already captured. So registering tools lazily mid-session does not retroactively change an in-flight request.

### B2 · Rules slot — the only entry point for discipline

Sources resolved by precedence (§7). Compose **by named section**, never by concatenation.

**Why sections, not concatenation:** stacking two always-on prompt layers produces two voices and contradictory instructions. A later source **overrides** a section; it never appends to one. This is the single rule that makes a project's rules composable without collision.

A project may supply nothing. An empty slot is valid and produces the base behaviour alone.

### B3 · Convention intake

Structured project facts, not prose:

| Field | Example |
|---|---|
| Declared write-set defaults | `src/**`, never `migrations/**` |
| Forbidden paths | `**/vendor/**`, `.env*` |
| Exclusive resources | lockfiles, schema files, migration ordering |
| Stack rules | "no new runtime dependencies", "tests colocated" |
| Test predicate overrides | domain-specific additions to the base predicate |
| Never-cut additions | regulatory, accessibility, data-retention constraints |
| Per-role tool allowlists | what the CEO may never call; what 01 may |

B3 feeds B4's brief schema and B6's map. It is what makes the base's generic mechanisms project-aware without the base knowing anything.

### B4 · Contract — the heart of the base

The only reason the base is reusable is that both ends of every delegation agree on a shape. Details in §5.

### B5 · Context assembly

**Verified:** a parent's session context never reaches a spawned child, and the main agent activates when a background subagent finishes. There is no push, no mid-flight read, no follow-up to a finished child.

V2 gives five request kinds their own hook, and **"a hook that should apply to every request must register for each kind."** Parity therefore means registering all four model-request kinds, not just one:

| Hook | Covers |
|---|---|
| `context` | the agent loop, including tool-driven continuations |
| `compaction` | checkpoint summaries. `event.result` can record the compaction yourself and skip the model call |
| `generate` | transient `ctx.session.generate` calls |
| `title` | title generation; no `agent` or `tools`, and `event.result` supplies the title directly |

Plus `prompt`, which intercepts incoming user prompts **once at admission**, not before every model call. It runs for commands that submit through `session.prompt`, and does *not* run for synthetic messages, shell messages, compaction controls or move controls.

Omitted, the ruleset silently disappears from compaction and auxiliary requests — and with it the provider prompt cache. That is a cost bug, not just a correctness one.

Other rules:

- Inject at **spawn time**: role, the brief, the permitted tool catalogue, and the resolved rules slot.
- The injected catalogue is the *permission-filtered* set for that specific child. Parent permissions do not authorize a child; discovery is not permission.
- Changes affect the outgoing model call only, never persisted history or configuration.
- `event.options` starts **empty** each call and does not contain resolved model settings.

### B6 · Orientation

- A codebase map built from `git ls-files` plus per-language regex — **no model call**. Top-level exports per folder, inside a character budget, shared code sorted first.
- An interface index: which exports changed and which are consumed. This is what fills the brief's interface row, which is what catches collisions a write-set cannot see.
- **It must run before the brief is written**, or the interface row stays empty and the mechanism does nothing.
- Declared ceiling: a regex map misses nested and dynamic definitions. A real parser is the upgrade path if exactness is ever needed.

### B7 · Isolation — native, not hand-rolled

OpenCode already has worktrees as a first-class feature. Do not reimplement it.

| Piece | Use |
|---|---|
| `opencode.json(c)` `worktree: { "directory": "../worktrees" }` | Where worktrees live |
| `ctx.worktree.create({ projectID, name })` | One worktree per parallel task |
| `ctx.worktree.list({ projectID })` | Inventory — saved state only, no filesystem discovery |
| `ctx.worktree.refresh({ projectID })` | Reconcile with the filesystem |
| `ctx.worktree.remove({ projectID, directory, force })` | Cleanup |
| `ctx.worktree.transform(e => e.add(strategy))` | Only if a custom strategy is ever needed |

The bundled Git strategy is the default. Registering a strategy selects it automatically and the last active registration wins; disposing restores the previous implementation, ultimately Git. So v1 registers **nothing** and just uses `ctx.worktree`.

Two behaviours to design around:

- **Removal uses the worktree's recorded strategy, not the current default.** A missing owner fails the removal rather than falling back to Git. That is the right failure — never silently remove with the wrong tool.
- A strategy can request force confirmation via `Worktree.OperationError`, so an "uncommitted changes" guard is expressible without depending on Git errors.

Isolation stops file collisions, **not semantic ones**. Two isolated tasks can still rename the same function. The interface index and the integration task cover that.

Integration is an ordinary task managed by `01-manager`, with the merged surface as its write-set. No third role.

### B8 · Records

Split by audience, because the two have different requirements:

| Record | Store | Why there |
|---|---|---|
| Report archive | `ctx.storage` | CEO-private; durable, plugin-scoped JSON |
| Pending decisions | `ctx.storage` | Must survive a session, must not clutter the repo |
| Task ledger (live footprints) | `ctx.storage` | CEO-private bookkeeping |
| Debt ledger — `shortcut:` markers | **Files in the repo** | Must be greppable by humans and CI, and it belongs to the project |

`ctx.storage` gives `get`, `set`, `remove`, and `scan({ prefix, after, limit })` with cursor pagination — enough for a ledger without inventing a file format.

**The distinction is the rule:** records humans and CI need to see stay as files in the repo; the CEO's own bookkeeping goes in storage.

### B9 · Observability

Off by default. On when diagnosing.

- Reason codes for tool choices, so a choice is reviewable after the fact.
- Evidence capture: exact command, exit code, raw output.
- **Ask-rate**: how often the CEO has to ask the user. A rising rate means briefs are not carrying enough — a brief-schema problem, not a manager problem.
- An explicit **never-report list**: no confidence percentages, no test reported as passing without its output, no file reported as changed without naming it.

### B10 · Diagnostics

`/bazinga-doctor` probes and reports, changing nothing. Even though the V2 docs now answer most of §12's questions, a doctor is still the only thing that proves them **on the version actually installed**.

| Probe | Answers |
|---|---|
| Host + plugin API version | Which export shape is live |
| Command / skill / tool transform availability | Whether registration works |
| Agent discovery | Whether `/bazinga-init` output was picked up |
| All four request hooks fire | Whether parity is achievable |
| `ctx.options` arrives | Whether per-project config works |
| `ctx.storage` read/write/scan | Whether the ledgers persist |
| `ctx.worktree` create / list / remove | Whether isolation is usable |
| `ctx.session.interrupt` on a background child | Whether a requirement change can stop stale work |
| Tool catalogue visibility at spawn | Whether a permission-filtered catalogue can be built |

---

## 5. The two contracts

These are the interfaces between the base and every project, which is why they cannot vary.

### The brief (CEO → manager)

| Field | Purpose |
|---|---|
| Task id, parent, goal | Identity |
| Requirement text, current version | What is being asked |
| **Declared write-set** | The CEO's arbitration unit |
| **Exclusive resources claimed** | Catches dependency and ordering collisions |
| **Interfaces touched** — exports changed, consumed | Catches collisions a write-set cannot see |
| Sibling footprints | So a neighbour is avoided without asking |
| Acceptance criteria + test predicate | Defines what evidence proves success |
| Authority bounds | What it may decide, what is a halt |

### The report (manager → CEO)

| Field | Purpose |
|---|---|
| Task id, terminal event | `success` \| `failure` \| `halted` |
| What changed — files, diff stat | Blast radius, comparable to sibling footprints |
| **Evidence** — command, raw output, exit code | The only verifiable content in the report |
| Verified vs. claimed | Separates the two explicitly |
| Review findings, grouped and numbered | Must fix / should fix / nice to have |
| Assumptions, requirement deltas | The CEO is the record of what was inferred |
| Unknowns needing a user decision | Each with a recommendation, options, impact if wrong |
| Not checked, deviations from brief | Honesty that survives each hop |

### Rules both ends obey

- **The terminal report is the only channel.** The CEO is dormant while children run. Anything not in a report did not happen. Details are left to the agents — this is a plan, not a field-by-field spec.
- **A report must be self-contained.** No follow-up question to a finished child.
- **The halt list outranks completion.** Otherwise it never fires.
- **Never guess.** If a requirement cannot be derived from the brief, the code or a stated convention, that is a halt.
- **Recommendation is not partial execution.** Nothing downstream of an undecided question is built.
- **No halt without a recommendation.** Otherwise the user is handed the design work.
- **Verification produces artifacts, not opinions.**
- **Batched decisions.** A single CEO turn may receive several reports. Decide them together — one report can change what another was acting on.

### Halt conditions

Halt when: the requirement changed from any source · the requirement is undecidable from the brief, the code and stated conventions · **the declared footprint is wrong** (files outside the write-set) · the brief loses against what the code does · acceptance criteria cannot be tested · a non-negotiable would have to be cut · no progress after a bounded number of attempts.

### What counts as "already agreed"

| Question | Reading | Behaviour |
|---|---|---|
| Would two reasonable users, reading the same request, want different outcomes? | A **requirement** | **Halt.** Not agreed |
| Does the codebase or a stated convention already establish it? | Already agreed, just unwritten | Follow it, record the resolution |
| Would any competent implementation do the same thing? | Implementation detail | Proceed |

The middle row is not a loophole: following an existing convention discovers behaviour the user already accepted. What is forbidden is inventing a *new* choice the user has not made.

### Authority ladder

| Level | Owns | Cannot |
|---|---|---|
| User | Requirements — what gets built | — |
| CEO | Decomposition, arbitration, the user channel, what to ask | Decide product, approve a recommendation, expand the agreed request |
| `01-manager` | Implementation, in-task decomposition, verification, tests, review | Ask the user, decide a requirement, execute an unagreed decision, broaden authority |

Everyone recommends. **Only the user decides.**

---

## 6. Repo layout

```
bazinga-opencode/
├── README.md                    # what it is, install, the base/project split
├── PLAN.md                      # this document — the build
├── SKELETON.md                  # phase 0: what exists and what was verified
├── INSTALL.md                   # installer commands, destinations, selection
├── LICENSE                      # MIT
├── registry.json                # components and profiles the installer reads
├── package.json                 # type: module, exports → plugin, bin → installer
├── opencode.json                # schema + experimental.subagent_depth; the repo is its own project
├── bin/
│   └── bazinga.js               # installer CLI: list, install, uninstall
├── install/
│   ├── resolve.js               # selection -> components
│   ├── apply.js                 # destination, copy, opencode.json merge
│   ├── interactive.js           # terminal prompts (@clack/prompts)
│   └── receipt.js               # record what was written
├── .opencode/
│   ├── plugins/index.ts         # exactly one plugin-shaped export
│   ├── agents/                  # shipped as files; the installer places them
│   ├── skills/                  # registered through transforms or copied as files
│   └── commands/                # registered through transforms or copied as files
├── schema/
│   ├── brief.md
│   └── report.md
├── docs/
│   ├── base-layers.md           # §4 expanded
│   ├── writing-rules.md         # how a project fills B2/B3
│   └── host-notes.md            # verified OpenCode behaviour, with provenance (§13)
└── tests/
    ├── config.test.ts
    ├── contract.test.ts
    ├── init.test.ts
    └── host.test.ts
```

`.opencode/plugins/index.ts` exports one default. Every other file is a plain
module. That is a hard constraint from B0, not a preference.

The module split listed above for B0–B10 (`host.ts`, `register.ts`,
`contract.ts`, …) lands under `.opencode/plugins/` as each phase needs it.

Commands and skills register through transforms, so only the plugin entry must
be found by the loader. Agents are always files, which is why the installer and
`/bazinga-init` exist. The installer reads `registry.json`; it assumes no path
beyond what that file declares.

---

## 7. Config, options and precedence

### The project's own config file, first

V2's object form passes options straight to the plugin, readable as `ctx.options` in `setup`. **This means per-project settings need no extra file** — they live in the `opencode.json` the project already has:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "bazinga-opencode",
      "options": {
        "level": "full",
        "rules": ["./.bazinga/rules"],
        "neverCut": ["accessibility"]
      }
    }
  ]
}
```

### Resolution order

| Priority | Source | Typical use |
|---|---|---|
| 1 | `ctx.options` in `opencode.json(c)` | Per-project settings, in the project's own file |
| 2 | Project `.bazinga/config.json` | When the project prefers a separate file |
| 3 | User `~/.config/bazinga/config.json` | Personal defaults |
| 4 | Plugin default | Deliberately **empty** where a project value is expected |

### Shared rule sets

`ctx.reference.transform` adds local or Git references a project can point at:

```ts
editor.add("standards", { type: "git", repository: "https://github.com/acme/standards", branch: "main" })
```

That makes a house rule set a normal Git artifact, versioned and shared across projects, rather than something copied between repos. `base-ladder` is deliberately not shipped as a default — a project that wants it adds it as a reference or a local rule file.

### Level

`off · lite · full · ultra`. The level changes **which lines of the rules are composed**, not which ruleset loads. A worked example or intensity table keyed by level is filtered; ordinary rule bullets survive verbatim.

`off` disables the rules slot only. The base — contract, halt rules, records, doctor — stays active, because those are structural, not stylistic.

---

## 8. What may and may not go in the rules slot

| Allowed | Not allowed |
|---|---|
| Code style and structure conventions | Anything that changes the brief or report schema |
| Language and framework rules | Instructions that override halt conditions |
| Review priorities and severity definitions | Authority changes (who may decide what) |
| Worked examples per level | A second, competing process layer |
| Additions to the never-cut list | New always-on prompt injection outside the slot |

The right-hand column is the base. If a project needs something there, that is a base change — deliberately gated, versioned, and applied to every project.

---

## 9. Licensing boundaries

| Source | Licence | Permitted |
|---|---|---|
| This repo's own code | MIT | Freely |
| ponytail rules and review contract | MIT, commit `09c434a` | Lift with attribution and the licence notice |
| OpenAgentsControl | MIT | Lift with notice |
| oh-my-openagent | SUL-1.0 | **Ideas only. Do not lift code.** Reimplement the mechanism from observation |
| OmO's vendored browser engine | Unresolved | Do not touch. Absence of a licence is not permission |

**Practical consequence:** the base is written from scratch, plus MIT text. No OmO code at any point. Where an OmO mechanism informs a design, the design note must say so.

---

## 10. Build phases

Each phase has a stop/go condition. Do not start the next phase before the current one's evidence exists.

| Phase | Deliverable | Stop/go evidence |
|---|---|---|
| **0 · Install path** | Per `SKELETON.md` — a package that loads and an installer that places components | `opencode plugin list` reports `cinder`; `bin/bazinga.js` installs, refuses overwrite without `--force`, and uninstalls from its receipt |
| **1 · Contract** | Brief and report schemas as documents; halt rules; authority ladder | Schemas written and reviewed. Text only, no runtime |
| **2 · Registration** | `/bazinga`, `/bazinga-init`, `/bazinga-doctor`, `/bazinga-report`, `/bazinga-debt`; four skills; **`/bazinga-init` places both agents** | Both agents appear after init; commands resolve; init reports every path it wrote |
| **3 · Context** | Spawn-time injection + all four request-hook kinds | A spawned child demonstrably receives role + brief + catalogue; compaction does not drop it |
| **4 · Orientation** | Map + interface index | Map produces output inside budget on a real repo; runs before a brief is written |
| **5 · Isolation** | Worktrees via `ctx.worktree`, per-task destination config | Two parallel tasks complete without file collision; removal uses the recorded strategy |
| **6 · Records** | Storage-backed archive and ledgers; file-backed debt ledger | A halted task survives a session and is visible afterwards |
| **7 · Observability** | Reason codes, evidence capture, ask-rate | Off by default; enabling it changes no behaviour |

Phase 1 is text-only by design. If the contract is wrong, no amount of runtime fixes it — and this ordering is what keeps phases 2–7 from being built on a guess.

---

## 11. Out of scope

| Excluded | Reason |
|---|---|
| Browser, Git/GitHub, LSP, PTY, auth, notifications | Independent capabilities. Compose as separate plugins |
| Context pruning, plan-review UI | Already solved by maintained plugins |
| **Worktree tooling** | **Native. Use `ctx.worktree` and the `worktree.directory` config** |
| A custom worktree strategy | Only if the bundled Git strategy proves insufficient |
| A custom tool-catalogue broker beyond spawn-time injection | Gated on doctor results |
| Secret guard, stale-edit protection | Need a runnable baseline to attach to |
| Cost and reuse metrics | Need a real baseline to measure against |
| OpenCode V1 API support | OpenCode 2 only |
| A `curl \| bash` installer | The Node CLI covers the same ground without a hosted script |
| Second process or prompt layer | One voice, one slot |

---

## 12. Open decisions

| Question | What settles it |
|---|---|
| Are requirements identified, or prose? | Identified makes "which tasks does this delta affect" mechanical instead of a guess |
| Halt at a checkpoint, or immediately? | Whether halted state is resumable or must be reverse-engineered |
| Does the CEO wake once per child, or once for several? | How practical batched decisions actually are |
| Self-review, or review as a sibling subtask? | Whether self-review's weaker independence costs anything measurable |
| Should any record be repo-visible besides the debt ledger? | Whether project-side visibility of pending decisions is ever wanted |
| Does `base-ladder` ship at all, or is it example content? | Whether a project wants it. Shipping opinions is what the split exists to avoid |
| Does `plugin add github:` resolve on the target version? | Phase 0 — the entire install story rests on it |

**Answered by the V2 documentation** — the doctor still verifies them on the installed version, but they are no longer unknowns:

| Was open | Answer |
|---|---|
| Can the CEO cancel or reach a running child? | `ctx.session.interrupt({ sessionID, continue: false })`; `ctx.session.wait({ sessionID })` |
| Which request kinds need separate hooks? | `context`, `compaction`, `generate`, `title` — one hook per kind |
| Which auxiliary surfaces were unnamed? | `generate` and `title`, both with `event.result` |
| Is worktree isolation available? | Yes, natively, with a pluggable strategy |
| Does the pending-decisions ledger survive a session? | Yes — `ctx.storage` is durable and plugin-scoped |
| Can a plugin register agents? | **No.** Files or the `agents` config key |

---

## 13. Verified host facts

Everything the base relies on, with how it was established. Docs read 2026-10-19.

| Fact | Source | How verified |
|---|---|---|
| `plugin add` accepts `github:owner/repo`, HTTPS, SSH, and `#ref` | opencode.ai/v2/docs/plugins | Documentation |
| A full commit hash stays pinned on update; exact npm versions too | same | Documentation |
| The `plugins` object form passes `options`, read via `ctx.options` | opencode.ai/v2/docs/build/plugins | Documentation |
| Plugin arrays across config files apply lowest → highest | opencode.ai/v2/docs/plugins | Documentation |
| `.opencode/plugins/` auto-loads direct `.ts`/`.js` and package dirs | same | Documentation |
| A `plugins/` dir beside a project-root config is **not** auto-discovered | same | Documentation |
| `-`, `*` and `.*` control which plugins are enabled | same | Documentation |
| `AgentEditor` has no `add` | opencode.ai/v2/docs/build/plugins | Documentation, API reference |
| `CommandEditor`, `SkillEditor`, `ToolEditor` all have `add` | same | Documentation |
| Agents load from `agents` config or `agents/*.md`, nested into the ID | opencode.ai/v2/docs/agents | Documentation |
| Four request hooks; each kind needs its own registration | opencode.ai/v2/docs/build/plugins | Documentation |
| `prompt` runs once at admission, not per model call | same | Documentation |
| `ctx.storage` is durable, plugin-scoped, with prefix scan | same | Documentation |
| `ctx.worktree` create/list/refresh/remove take a `projectID` | same | Documentation |
| Removal uses the recorded strategy; a missing owner fails | same | Documentation |
| A parent's context never reaches a spawned child | ponytail `hooks/ponytail-subagent.js:4-6`, issue #252 | Source read, local clone |
| V2 has no `config` hook; read files at module scope | ponytail `.opencode/plugins/ponytail.mjs:72` | Source read |
| Legacy loader treats every exported function as a plugin | ponytail `plugins/ponytail-frontmatter.cjs:4-11` | Source read |
| OpenCode 2 rejects a file path in `plugins`; must be a directory | ponytail `INSTALL.md:92` | Source read |
| Compaction hook omitted ⇒ ruleset *and* prompt cache drop | ponytail `.opencode/plugins/ponytail.mjs:155-163` | Source read |

**Provenance note.** The ponytail rows are source observations from a local clone at `09c434a`, not integration tests. They are evidence that a working plugin does this, not proof that every behaviour holds on this machine.

---

## 14. The one-sentence test

> If a project could reasonably want something different here, it belongs in B2 or B3, not in the base.

Apply that to every future addition. It is the whole reason the base stays reusable, and the reason this repo has nine base layers and exactly two project ones.
