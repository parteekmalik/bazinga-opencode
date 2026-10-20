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

The agent, skill and command slots are empty in this skeleton. The installer
already handles them.

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

Installing `agent:*`, `skill:*` or `command:*` never reads or writes
`opencode.json`. Passing `--no-config` also stops the plugin component from
registering itself.

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
