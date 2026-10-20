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
`agent:general-manager` and `agent:workers/general`. The skill and command slots
are empty in this skeleton; the installer already handles them.

| Agent | Role | What it may do |
| --- | --- | --- |
| `ceo` | Primary. Plans, arbitrates, the only one that talks to you | Launch `general-manager` only |
| `general-manager` | Subagent. Owns one task, splits it into worker jobs | Launch any agent in `workers/`; keep its plan in OpenCode's to-do list (`todowrite`) |
| `workers/general` | Subagent. One narrow job, minimal report | Read, search and edit files. No commands, no launching, no secret files |

**Workers live in their own folder.** In OpenCode a nested path becomes part of the
agent id, so `agents/workers/general.md` is the agent `workers/general`. The manager
is allowed to launch `workers/*`, which means a worker added to that folder later
(find references, web search, review) can be launched without editing the manager.
The CEO cannot launch workers; it goes through a manager.

Renamed from earlier versions, which left files an ordinary reinstall will not
remove: the manager was `01-manager` and the worker was `worker`. If you installed
those, run `uninstall` for that destination first, then install again. Otherwise the
old `agents/01-manager.md` and `agents/worker.md` stay behind next to the new files.

Each agent is a single Markdown file, and installing one on its own copies
`agents/<id>.md` and nothing else: no plugin and no `opencode.json` change. They
are meant to be used together: the CEO launches `general-manager` and the manager
launches a worker, so installing the CEO without the other two leaves it nobody
to delegate to. `agent:general-manager` and `agent:ceo` also need a raised
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
`registry.json`. `--all` selects everything, MCP servers included; the `full`
profile is the plugin and the agent team only.

## MCP servers

Four MCP servers can be installed as components of type `mcp`:

| Id | Runs | Needs |
| --- | --- | --- |
| `mcp:git` | `uvx mcp-server-git` | `uvx` ([uv](https://docs.astral.sh/uv/)) |
| `mcp:fetch` | `uvx mcp-server-fetch` | `uvx` |
| `mcp:context7` | remote, `https://mcp.context7.com/mcp` | nothing |
| `mcp:serena` | `serena start-mcp-server --context agent --open-web-dashboard false` | `serena` on PATH: `uv tool install -p 3.13 serena-agent` |

```bash
node bin/bazinga.js install --global --profile mcp        # all four
node bin/bazinga.js install --project --only mcp:git,mcp:fetch
```

In the interactive picker they are listed after the plugin and agents ("Let me
pick"), each with a one-line description.

An MCP server is not a file. Installing one adds `mcp.servers.<id>` to
`opencode.json` (the V2 shape) and copies nothing. What that means:

- **An existing server is never overwritten.** If `mcp.servers.git` is already in
  the config, whatever it points at, it is left alone and reported as "already
  configured". Your own setup always wins.
- **Choosing a server is its own consent.** It does not need `--settings`. Only
  `--no-config` stops it (the server is then reported as not added).
- **Missing programs are a warning, not an error.** If `uvx` or `serena` is not on
  PATH, the install still writes the entry and tells you what to install. The
  check uses the installer's PATH; OpenCode's background service can have a
  different one, so if Serena is installed but not found at startup, put its
  absolute path in the entry.
- **Uninstall removes only what was added**, and only if the entry is still
  exactly what the installer wrote. A server you edited since stays. Empty
  `mcp.servers` and `mcp` sections are removed.
- Remote servers use OAuth by default in OpenCode; sign in from `/mcps` if the
  list says "needs authentication".

The agent team does not use these servers. `ceo`, `general-manager` and
`workers/general` deny everything they are not explicitly given, so the MCP tools
are available to your other agents only.

## What touches opencode.json

A component with a `register` field does — in this skeleton, `plugin:core`: the
installer appends its path to the `plugins` array. An `mcp:*` component does too
(see above). The file is backed up first as `opencode.json.bak-bazinga-<timestamp>`.

Installing `agent:*`, `skill:*` or `command:*` does not register anything in
`opencode.json`. A component can still declare a **setting** it needs, such as
`agent:ceo` needing `experimental.subagent_depth` (next section). The installer
changes a setting only when you say so: a yes in the interactive prompt, or
`--settings` on the command line. It never lowers a number. A flag is set to the
value the component needs; if you had switched it off, the prompt shows that and
uninstall puts your value back.

Passing `--no-config` stops the plugin registration, any settings change and MCP
servers.

### When the folder has no opencode.json

A folder with no config is often the wrong folder, so the installer checks. It
looks for `opencode.json` where it would make the change: the project root for
`--project` or "This project", OpenCode's config folder for global, or the folder
you typed. It only checks when something you selected would edit the config (the
plugin, an MCP server, or an agent that declares a setting) and `--no-config` was not given.

- **Interactive:** it says "This directory doesn't contain a config file
  (opencode.json)" with the path, then asks whether to **create opencode.json
  here** or **choose a different folder**. Choosing a different folder asks for the
  destination again and re-checks it. The plan then shows a new config as `+` and
  an existing one as `~`.
- **Command line:** flags never prompt, so the install goes ahead as before and
  prints a note that no config existed and one was created (or, with `--dry-run`,
  would be). If that is the wrong directory, pick another destination.
- **`opencode.jsonc`:** OpenCode also reads this, but the installer does not edit
  it because of its comments. If that is all the folder has, the message says so.

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
`agent:general-manager` for at least 2. When you select either and the config does not
already satisfy it, the interactive installer shows the current value and asks.
Selecting both sets it once, to 3. On the command line:

```bash
node bin/bazinga.js install --project --only agent:ceo,agent:general-manager,agent:workers/general --settings
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

`agent:general-manager` declares this setting, so the installer asks about it the same
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
