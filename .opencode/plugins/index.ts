import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

// Where the plugin writes, chosen by `options.target`:
//
//   "default"        OpenCode's own config directory      (the default)
//   "cwd"            the project directory being opened
//   "/abs/path"      that exact directory, which must be absolute
//
// Relative paths are rejected. They would resolve against the server process's
// working directory, which is not the project and differs per invocation.
const DEFAULT = "default"
const CWD = "cwd"

type PluginOptions = { target?: string }
type Resolved = { target: string; rejected?: string }

// Keep plugin state beside OpenCode's config, as other plugins do.
function opencodeConfigDirectory(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(base, "opencode")
}

function projectDirectory(ctx: unknown): string | undefined {
  return (ctx as { location?: { directory?: string } } | undefined)?.location?.directory
}

function resolveTarget(ctx: unknown): Resolved {
  const options = ((ctx as { options?: PluginOptions } | undefined)?.options ?? {}) as PluginOptions
  const value = options.target

  if (!value || value === DEFAULT) return { target: opencodeConfigDirectory() }
  if (value === CWD) return { target: projectDirectory(ctx) ?? opencodeConfigDirectory() }

  if (!isAbsolute(value)) return { target: opencodeConfigDirectory(), rejected: value }
  return { target: value }
}

function note(target: string, event: string) {
  // A load proof must never break the host.
  try {
    mkdirSync(target, { recursive: true })
    appendFileSync(
      join(target, "plugin-loaded.log"),
      `${new Date().toISOString()} pid=${process.pid} ${event}\n`,
    )
  } catch {
    // Unwritable target: absence of the file is the signal.
  }
}

// The only plugin-shaped export in this package. OpenCode 2 loads this file on
// its own when the repository is opened, and npm/git consumers reach it through
// package.json exports.
export default Plugin.define({
  id: "cinder",

  async setup(ctx) {
    const { target, rejected } = resolveTarget(ctx)

    if (rejected !== undefined) {
      note(target, `target "${rejected}" rejected — use "default", "cwd", or an absolute path`)
    }

    note(target, "loaded")
    return () => note(target, "unloaded")
  },
})
