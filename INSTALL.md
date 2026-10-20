# Install

This repository is both a plugin and an installer. The installer copies chosen
components into an OpenCode folder and records exactly what it wrote.

## Components

| Type in `registry.json` | Selected as | Installs to |
| --- | --- | --- |
| `plugins` | `plugin:core` | `plugins/bazinga/` |
| `agents` | `agent:<id>` | `agents/` |
| `skills` | `skill:<id>` | `skills/<id>/` |
| `commands` | `command:<id>` | `commands/` |

Today the registry holds `plugin:core` and three agents: `agent:ceo`,
`agent:01-manager` and `agent:worker`. The skill and command slots are empty in
this skeleton; the installer already handles them.

| Agent | Role | What it may do |
| --- | --- | --- |
| `ceo` | Primary. Plans, arbitrates, the only one that talks to you | Launch `01-manager` only |
| `01-manager` | Subagent. Owns one task, splits it into worker jobs | Launch `worker`; keep its plan in OpenCode's to-do list (`todowrite`) |
| `worker` | Subagent. One narrow job, minimal report | Read, search and edit files. No commands, no launching, no secret files |

Each agent is a single Markdown file, and installing one on its own copies
`agents/<id>.md` and nothing else: no plugin and no `opencode.json` change. They
are meant to be used together: the CEO launches `01-manager` and the manager
launches `worker`, so installing the CEO without the other two leaves it nobody
to delegate to. `agent:01-manager` and `agent:ceo` also need a raised
`experimental.subagent_depth` (next sections).

## Quick start

From a checkout, interactively:

```bash
bun install            # once, for the prompt library
node bin/bazinga.js    # asks destination, components, config, then confirms
```

Or with flags, which never prompt:

```bash
node bin/bazinga.js list
node bin/bazinga.js install --global --all --dry-run
node bin/bazinga.js install --global --all
```

`--dry-run` prints every path and config change and writes nothing.

After the package is published, the same commands are
`npx bazinga-opencode <command>`.

## Destinations

Exactly one is required:

| Flag | Writes to |
| --- | --- |
| `--global` | `$XDG_CONFIG_HOME/opencode`, normally `~/.config/opencode` |
| `--project` | `./.opencode` in the current directory |
| `--target <path>` | that directory; must be absolute |

```bash
node bin/bazinga.js install --project --only plugin:core
node bin/bazinga.js install --target /tmp/opencode-test --only plugin:core
```

For a project install, `opencode.json` lives at the project root and the
components go under `.opencode/`.

## Selecting components

```bash
node bin/bazinga.js install --global --all
node bin/bazinga.js install --global --profile full
node bin/bazinga.js install --global --only plugin:core
node bin/bazinga.js install --global --only plugin:core,skill:base-contract
```

Selection can be repeated and combined. Profiles are declared in
`registry.json`.

## What touches opencode.json

Only a component with a `register` field does — in this skeleton, `plugin:core`.
The installer appends its path to the `plugins` array and backs the file up
first as `opencode.json.bak-bazinga-<timestamp>`.

Installing `agent:*`, `skill:*` or `command:*` does not register anything in
`opencode.json`. A component can still declare a **setting** it needs, such as
`agent:ceo` needing `experimental.subagent_depth` (next section). The installer
changes a setting only when you say so: a yes in the interactive prompt, or
`--settings` on the command line. It never lowers a number. A flag is set to the
value the component needs; if you had switched it off, the prompt shows that and
uninstall puts your value back.

Passing `--no-config` stops both the plugin registration and any settings change.

## Subagent depth

The CEO launches managers, and managers launch workers. OpenCode allows one
level of subagents by default, so without a setting the manager is refused with:

```
Subagent depth limit reached (1). Increase "experimental.subagent_depth" to allow nested subagents.
```

The number counts levels of subagents: 2 allows CEO → manager → worker, and 3
leaves one more level of headroom. Which agent may launch which is still decided
by each agent's `subagent` permission rules, not by this number.

**The installer can set it for you.** `agent:ceo` asks for at least 3 and
`agent:01-manager` for at least 2. When you select either and the config does not
already satisfy it, the interactive installer shows the current value and asks.
Selecting both sets it once, to 3. On the command line:

```bash
node bin/bazinga.js install --project --only agent:ceo,agent:01-manager,agent:worker --settings
```

- The `opencode.json` it changes is the one for the chosen destination (the
  project root for `--project`, the config folder for `--global`).
- A value already at or above 3 is left alone. A lower value is raised, after a
  backup (`opencode.json.bak-bazinga-<timestamp>`). A value that is not a number
  is refused, and nothing is installed.
- Without `--settings` the install still completes and prints a note saying what
  is missing, so nothing changes silently.
- Uninstall puts the previous value back, or removes the key if the installer
  created it, but only if the value is still the one the installer wrote. A value
  you changed since is left alone.

To set it yourself instead, add this to the `opencode.json` that applies:

```json
{ "experimental": { "subagent_depth": 3 } }
```

This repository's own `opencode.json` sets it.

## To-do tool

The manager keeps its plan in OpenCode's to-do list, the `todowrite` tool. In
OpenCode 2.1 that tool is experimental and off by default, so without the flag an
agent allowed `todowrite` simply has no such tool. Turn it on with:

```json
{ "experimental": { "todo": true } }
```

`agent:01-manager` declares this setting, so the installer asks about it the same
way it asks about the depth: a yes in the interactive prompt, or `--settings`.
The flag only makes the tool exist. Each agent's own `permissions` still decide
who may call it, and here only the manager is allowed: the CEO and the worker deny
everything not listed.

If the flag is off, the manager's prompt tells it to write the plan out in plain
text instead and not to pretend it used a tool.

## Plugin only, without the installer

```bash
opencode plugin add github:parteekmalik/bazinga-opencode
```

OpenCode writes the `plugins` entry to the global config itself. For a project:

```json
{ "plugins": ["github:parteekmalik/bazinga-opencode"] }
```

## From this repository

Opening this directory needs no configuration. OpenCode 2 discovers
`.opencode/plugins/index.ts` on its own:

```bash
opencode plugin list
```

## Choosing the target

The plugin writes `plugin-loaded.log` to OpenCode's config directory by default.
Pass `options.target` to change that:

```json
{
  "plugins": [
    {
      "package": "./plugins/bazinga",
      "options": { "target": "cwd" }
    }
  ]
}
```

| `target` | Writes to |
| --- | --- |
| omitted, or `"default"` | `$XDG_CONFIG_HOME/opencode`, normally `~/.config/opencode` |
| `"cwd"` | the project directory holding `opencode.json` |
| an absolute path | exactly that directory |

Anything relative is rejected, because it would resolve against the background
server's working directory. The plugin falls back to the default and records the
rejected value in the log.

## Uninstall

```bash
node bin/bazinga.js uninstall --global
```

The receipt at `<destination>/.bazinga-install.json` lists every path and config
entry the installer added. Uninstall removes those and nothing else. It also
works with `--dry-run`.

For a `opencode plugin add` install, use `opencode plugin remove
bazinga-opencode` instead.
