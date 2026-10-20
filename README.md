# bazinga-opencode

A frame, not a ruleset. Two roles — a tool-less CEO and a tool-ful manager — one
contract between them, and halt rules that outrank completion.

OpenCode 2 only.

## Status

**Skeleton plus a first team.** The installer and the load-proof plugin work,
and three agents ship: `ceo` (tool-less coordinator), `01-manager` (splits one
task into worker jobs) and `worker` (one narrow job, read/search/edit only).
The skill and command slots are empty. Install any agent alone, for example
`--only agent:worker`. The team needs two config values: `experimental.subagent_depth`
raised so the CEO can launch managers that launch workers, and `experimental.todo`
so managers have OpenCode's to-do tool. The installer offers to set both. See
[SKELETON.md](SKELETON.md) for the scaffold and [PLAN.md](PLAN.md) for the build.

## Install

`registry.json` lists what this repo can place into an OpenCode folder. The
installer copies only what you select and records what it wrote.

Run it with no arguments and it asks where to install and what to install,
using arrow keys, space and enter:

```bash
node bin/bazinga.js              # interactive install
node bin/bazinga.js uninstall    # interactive uninstall
```

Flags skip the questions they answer. A fully specified command never prompts,
and without a terminal (scripts, CI) the installer uses flags only:

```bash
node bin/bazinga.js list
node bin/bazinga.js install --global --dry-run --all
node bin/bazinga.js install --global --only plugin:core
node bin/bazinga.js install --project --only plugin:core
node bin/bazinga.js uninstall --global
```

| Selection | Installs |
| --- | --- |
| `--all` | every component |
| `--profile <name>` | a bundle declared in `registry.json` |
| `--only plugin:core,skill:foo` | just those |

Destinations: `--global` (`~/.config/opencode`), `--project` (`./.opencode`), or
`--target <absolute path>`. Full details, including what does and does not touch
`opencode.json`, are in [INSTALL.md](INSTALL.md).

Opening this directory needs no install step: OpenCode 2 discovers
`.opencode/plugins/index.ts` on its own.

## Where it writes

A plugin's `console.log` is not captured anywhere, so the load proof is a file.
The plugin appends to `plugin-loaded.log` in the directory chosen by
`options.target`:

| `target` | Writes to |
| --- | --- |
| omitted, or `"default"` | OpenCode's config directory — `$XDG_CONFIG_HOME/opencode`, normally `~/.config/opencode` |
| `"cwd"` | the project directory being opened |
| an absolute path | exactly that directory |

Relative paths are rejected. They would resolve against the background server's
working directory, which is not the project, so the plugin falls back to the
default and records the rejected value in the log.

## Tests

```bash
node --test tests/
```

57 tests covering selection, destinations, install, config merge, uninstall, the
three agents' permissions and the config settings they need.
No test dependency: Node's built-in runner.

## License

[MIT](LICENSE) © 2026 Parteek malik

