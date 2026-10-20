# bazinga-opencode — skeleton

**Status:** skeleton verified on `opencode v2.0.32`; the agent team verified on
`v2.1.0` (OpenCode updated mid-session), 2026-10-20.
**Relation to `PLAN.md`:** this is phase 0 of §10, expanded into the frame the
build sits in. `PLAN.md` is the build; this is what exists today.
**Scope:** the load path, the component installer, and three agents (`ceo`,
`01-manager`, `worker`). The skill and command slots are declared but empty.

---

## 1. What the skeleton is

Two things, both working:

1. A plugin OpenCode loads — `opencode plugin list` reports `cinder`.
2. An installer that copies chosen components from this repo into an OpenCode
   folder and records exactly what it wrote.

The load path is proven before any contract, skill or agent is written against
it. The installer exists because not every user wants the whole repository: they
can take the plugin, a skill, an agent, or any combination.

## 2. What it deliberately does not contain

| Absent | Why |
|---|---|
| Specialised workers | Only the general `worker` exists. Narrow ones (find references, web search, review…) come once the general one has been measured |
| Skills | Slots exist at `.opencode/skills/`; content arrives in phase 2 |
| Commands | Slot exists at `.opencode/commands/`; content arrives in phase 2 |
| Tools | Nothing to register yet |
| Contract, schemas, brief/report logic | Phase 1. Text, and it must be reviewed before it is code |
| Context injection, map, worktrees, records, doctor | Phases 3–7 |
| Contract and workflow tests | The installer is tested; there is no contract or agent behaviour yet |
| Build step | `.ts` loads directly. No bundler, no transpile, no `dist/` |
| Runtime dependencies | The plugin has none beyond the host-provided API package. The installer uses `@clack/prompts` for its interactive mode |

## 3. The tree

```
bazinga-opencode/
├── .opencode/
│   ├── plugins/index.ts         # the single plugin-shaped export
│   ├── agents/ceo.md            # tool-less coordinator; denies all but launching 01-manager
│   ├── agents/01-manager.md     # one task -> worker jobs; launches worker only
│   ├── agents/worker.md         # general leaf: read, search, edit; no shell, no launching
│   ├── skills/.gitkeep          # empty — phase 2 sources land here
│   └── commands/.gitkeep        # empty — phase 2 sources land here
├── bin/bazinga.js               # installer CLI
├── install/
│   ├── resolve.js               # selection -> components
│   ├── apply.js                 # destination, copy, opencode.json merge
│   ├── interactive.js           # terminal prompts (@clack/prompts)
│   └── receipt.js               # record what was written
├── registry.json                # the component catalog and profiles
├── opencode.json                # the repo is its own OpenCode project
├── package.json
├── tsconfig.json                # editor and typecheck only; noEmit
├── README.md
├── INSTALL.md
├── PLAN.md
├── SKELETON.md                  # this file
├── LICENSE
├── schema/.gitkeep              # phase 1 brief/report
├── docs/.gitkeep
└── tests/
    └── installer.test.js        # selection, destinations, copy, config, uninstall
```

There are no root `agents/` or `skills/` folders: every installable component
lives under `.opencode/`, so the source tree mirrors the destination.

## 4. How the pieces work

### 4.1 `.opencode/plugins/index.ts`

One plugin-shaped export, found by OpenCode 2 automatically when this directory
is opened. It has three jobs:

- resolve a target directory (`ctx.options.target`, `"default"`, `"cwd"`, or an
  absolute path)
- append a `loaded` / `unloaded` line to `<target>/plugin-loaded.log`
- never throw — an unwritable target must not break the host

The file side effect is the proof. `console.log` from a plugin is not captured
anywhere.

### 4.2 `registry.json`

```json
{
  "version": 1,
  "components": {
    "plugins": [
      {
        "id": "core",
        "type": "plugin",
        "source": ".opencode/plugins",
        "destination": "plugins/bazinga",
        "register": "plugins"
      }
    ],
    "agents": [
      {
        "id": "ceo",
        "type": "agent",
        "description": "Tool-less coordinator: briefs, arbitration, the user channel",
        "source": ".opencode/agents/ceo.md",
        "destination": "agents/ceo.md",
        "settings": [{ "key": "experimental.subagent_depth", "min": 3, "reason": "…" }]
      },
      {
        "id": "01-manager",
        "type": "agent",
        "source": ".opencode/agents/01-manager.md",
        "destination": "agents/01-manager.md",
        "settings": [{ "key": "experimental.subagent_depth", "min": 2, "reason": "…" }]
      },
      {
        "id": "worker",
        "type": "agent",
        "source": ".opencode/agents/worker.md",
        "destination": "agents/worker.md"
      }
    ],
    "skills": [],
    "commands": []
  },
  "profiles": {
    "plugin": ["plugin:core"],
    "full": ["plugin:core", "agent:ceo", "agent:01-manager", "agent:worker"]
  }
}
```

`source` is relative to this repo. `destination` is relative to the chosen
OpenCode folder. `register` names the config array the installed path is added
to — only the plugin needs one. `settings` lists scalar config values a component
needs (`agent:ceo` declares `experimental.subagent_depth`, minimum 3, with the
reason). They are applied only on request: a yes in the TUI or `--settings`.
A setting is either `{ "min": n }` (a number, raised to at least n) or
`{ "value": true }` (a flag, set to that value; `agent:01-manager` declares
`experimental.todo`). The installer never lowers a number, and records the
previous value in the receipt so uninstall can put it back. When several
selected components ask for the same key, it is written once, at the highest
minimum (the CEO's 3 wins over the manager's 2).

### 4.3 The installer

```bash
node bin/bazinga.js list
node bin/bazinga.js install --global --only plugin:core
node bin/bazinga.js install --project --only plugin:core
node bin/bazinga.js install --target /abs/path --only plugin:core
node bin/bazinga.js uninstall --global
```

- `--dry-run` prints every path and config change, writes nothing.
- `--force` is required to replace an existing installation.
- `--no-config` copies files without touching `opencode.json`.
- `--only`, `--profile` and `--all` form a union.

An install writes a receipt at `<destination>/.bazinga-install.json` containing
every path and config entry it added. Uninstall reads that receipt and removes
exactly those paths, then the entries. Nothing else is touched.

When a config merge is needed, the file is backed up first as
`opencode.json.bak-bazinga-<timestamp>`.

### 4.4 `package.json`

`main` and `exports` point at `.opencode/plugins/index.ts`; `bin.bazinga` points
at the installer. `@opencode/plugin` is an optional peer — the host injects it,
including for a git-installed copy with no `node_modules` of its own.

### 4.5 `opencode.json`

```json
{ "$schema": "https://opencode.ai/config.json" }
```

Schema-only, like ponytail and OpenAgentsControl. Opening this directory needs
no entry: OpenCode discovers `.opencode/plugins/index.ts` on its own.

### 4.6 `tsconfig.json`

`types: ["node"]` is required — without it `node:fs`, `node:os`, `node:path`
and `process` are undeclared and `tsc --noEmit` fails. `include` is
`.opencode/plugins` and `tests`.

### 4.7 `.gitignore`

`node_modules/`, OS noise, `plugin-loaded.log`, installer receipts and config
backups. `bun.lock` is not ignored.

### 4.8 `tests/installer.test.js`

Node's built-in runner, no test dependency:

```bash
node --test tests/
```

The tests cover selection and profiles, destination resolution, copy, refusal
without `--force`, `--no-config`, project-relative config entries, config merge
and idempotency, receipt roundtrip, and uninstall. For the `ceo` agent they check
a standalone install (no plugin, no config change), uninstall, and that its
permissions stay exactly "deny everything, allow launching `01-manager`". For
settings they check raise-only behaviour, refusal of an unusable value before any
copy, distinct backups for two edits to one file, and uninstall restoring the
previous value only when the user has not changed it since. Each
filesystem test creates a directory under `os.tmpdir()` and removes it afterwards.

To inspect the directories, point `TMPDIR` at a visible folder and set
`BAZINGA_KEEP_TESTS=1`:

```bash
TMPDIR="$PWD/../bazinga-installer-tests" BAZINGA_KEEP_TESTS=1 node --test tests/
```

## 5. Facts verified on this machine

Observed on `opencode v2.0.32` on macOS, 2026-10-20, unless marked container.

| Fact | How it was established |
|---|---|
| `console.log` from a plugin is not captured | `--print-logs`, server log and TUI all silent; a file side effect appears |
| An environment variable does not reach the plugin | `PLUGIN_TARGET=x` was ignored: `setup` runs in the background server, which does not inherit the CLI environment |
| `ctx.options` is the working per-project parameter | object-form entry in `opencode.json` changed where the proof was written |
| `ctx.location.directory` is the project directory | used to resolve `"cwd"` |
| `setup` runs once per plugin load, not per session | two consecutive runs produced one `loaded` line |
| Editing the plugin or config hot-reloads it | `touch` produced `unloaded` then `loaded` in about a second |
| OpenCode loads each plugin three times per reload cycle | `plan-write.ts` shows the same; host behaviour, not duplicate registration |
| `.opencode/plugins/index.ts` is discovered with no config entry | `opencode plugin list` reports it from the repo |
| An installed plugin directory loads via the `plugins` entry | install to `/tmp`, `plugin list` reported `cinder` from that path |
| `plugin list` is scoped to the exact directory holding `opencode.json` | a subdirectory and the parent did not list the project plugin; `/tmp` listed only the globally registered plugin |
| `plugin list` has a cold-start race | the first call after a cold start can print `No plugins found`; the next is correct |
| A git-installed copy resolves the host-provided peer | container: install with no `@opencode` in its `node_modules` still ran |
| `private: true` does not block a git install | container |
| `exports` is honoured for a git-installed package | container |
| The `ctx` surface has 26 keys | container; `PLAN.md` §13 |

Observed on `opencode v2.1.0`, the agent team:

| Fact | How it was established |
|---|---|
| Subagent nesting defaults to one level | a manager asked to launch a worker was refused: "Subagent depth limit reached (1). Increase `experimental.subagent_depth`…" |
| `experimental.subagent_depth: 2` allows top → manager → worker | a three-level chain returned `TOP-DONE MGR-DONE WRK-PONG` |
| OpenCode records the subagent tree itself | each session had `parentID`, tokens and cost, no plugin involved |
| A subagent call returns the child's final response and a `sessionID` | tools docs, the tool description, and the chain above |
| CEO → `01-manager` → `worker` completes a real task | installed all three with the installer (`--project --settings`), asked the CEO for a one-line file; the file was created, the CEO called only `subagent`, the manager only `subagent`, the worker `glob`, `read`, `patch` |
| The to-do tool is off by default | asked to list its tools, the default agent named `glob, grep, patch, question, read, shell, skill, subagent, webfetch, websearch, execute`; a test agent with `todowrite` allowed said it had no todo tool |
| `experimental.todo: true` turns it on, as `todowrite` | with the flag, an agent allowed `todowrite` wrote its list and one denied it reported no tool. Source: the v2.1.0 changelog and PR #56947 (research supplied by the user). The schema served at `opencode.ai/config.json` does not list the key yet, so it lags the binary |
| The manager uses `todowrite` when told to plan first, unconditionally | one team run with soft wording: zero calls. After making it a required first step: three calls, plus a separate review worker. One run on one model, not a guarantee |
| Agent permission rules come after the global ones and the last match wins | the CEO's `* deny` overrode the global allows; so the worker re-denies `.env*` after its broad `read`/`edit` allow |

## 6. Probes — all resolved

| # | Question | Outcome |
|---|---|---|
| P1 | Which `plugins` entry forms load on 2.0.32 | A directory entry works; a file entry also loads but the loader warns `configured plugin path must be a directory` |
| P2 | Does `setup` run, or is the package only discovered | It runs, once per load |
| P3 | Can a git-installed plugin resolve a host-provided peer | Yes — the host injects `@opencode/plugin` |
| P4 | Does `private: true` interfere with a git install | No |
| P5 | Is `exports` honoured for a git-installed package | Yes |
| P6 | Does `setup` receive `ctx` | Yes, with 26 keys; `ctx.options` is populated by the object form |

## 7. Install and verify

### From this repository

```bash
bun install
bun run typecheck
opencode plugin list          # expect: cinder local .../.opencode/plugins/index.ts
```

`plugin list` must be run from this exact directory. Run it twice if the first
call prints nothing.

### The installer

```bash
node bin/bazinga.js list
node bin/bazinga.js install --target /tmp/bazinga-install-test --only plugin:core
(cd /tmp/bazinga-install-test && opencode plugin list)   # expect: cinder local .../plugins/bazinga/index.ts
node bin/bazinga.js uninstall --target /tmp/bazinga-install-test
```

### Tests

```bash
node --test tests/
```

57 tests, no dependency beyond Node itself.

### The load proof

The proof is a file, not a log line:

```bash
cat ~/.config/opencode/plugin-loaded.log
```

Each line is `<ISO timestamp> pid=<server pid> loaded|unloaded`.

## 8. Execution order

1. Create the skeleton files. Done.
2. `bun install` and `bun run typecheck`. Done, exits 0.
3. `opencode plugin list` from the repo. Done.
4. Prove `setup` runs with a file marker. Done.
5. Build the registry and installer. Done.
6. Verify install, refusal without `--force`, and uninstall. Done.
7. Add installer tests. Done, 57 passing.
8. Add the `ceo` agent. Done: `.opencode/agents/ceo.md`, registered as `agent:ceo`.
9. Add `01-manager` and `worker`, and run the whole chain end to end. Done.
10. `git init`, commits and push to `github.com/parteekmalik/bazinga-opencode`.
    Done, on your instruction.

## 9. Out of scope

| Excluded | Deferred to |
|---|---|
| Skill and command content, specialised workers | `PLAN.md` phase 2 |
| Brief, report, halt rules | `PLAN.md` phase 1 |
| The module split from `PLAN.md` §6 | As each phase needs it |
| Contract tests | When phase 1 has behaviour to test |
| CI | When there is something to run |
| A `curl \| bash` installer | Not planned — the Node CLI covers the same ground without a hosted script |
| Reconciling `SKELETON.md` with `my-plugin/plan/v1-plan.html` | Separate, still open |
