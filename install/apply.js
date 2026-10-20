import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

// Where the chosen components land. `configRoot` is the directory holding the
// opencode.json that the plugin entry must be registered in, which is not the
// same as `destination` for a project install.
export function resolveDestination({ global = false, project = false, target, cwd = process.cwd() } = {}) {
  const chosen = [global, project, Boolean(target)].filter(Boolean).length
  if (chosen > 1) throw new Error("choose only one of --global, --project, --target")

  if (target) {
    if (!isAbsolute(target)) throw new Error("--target must be an absolute path")
    return { mode: "target", destination: target, configRoot: target }
  }

  if (project) {
    return { mode: "project", destination: join(cwd, ".opencode"), configRoot: cwd }
  }

  if (global) {
    const root = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    const destination = join(root, "opencode")
    return { mode: "global", destination, configRoot: destination }
  }

  throw new Error("choose a destination: --global, --project, or --target <absolute path>")
}

export function buildPlan(repoRoot, components, destination) {
  return components.map((component) => {
    const source = join(repoRoot, component.source)
    if (!existsSync(source)) {
      throw new Error(`registry entry ${component.key} points at a missing path: ${component.source}`)
    }

    const installed = join(destination.destination, component.destination)
    const entry = component.register ? relativeEntry(destination.configRoot, installed) : undefined

    const configPath = join(destination.configRoot, "opencode.json")

    return {
      component,
      source,
      installed,
      entry,
      configPath: entry ? configPath : undefined,
      // Scalar settings the component needs, each tied to the file it would change.
      settings: (component.settings ?? []).map((setting) => ({ ...setting, configPath })),
    }
  })
}

// A setting a component needs is one of two kinds:
//   { key, min: 3 }      a number, raised to at least 3 and never lowered
//   { key, value: true } a flag, set to that value
export const targetOf = (setting) => (typeof setting.min === "number" ? setting.min : setting.value)

export function describeTarget(setting) {
  return typeof setting.min === "number" ? `at least ${setting.min}` : String(setting.value)
}

const isMet = (target, current) =>
  typeof target === "number" ? typeof current === "number" && current >= target : current === target

// The settings in a plan that the current config does not already satisfy, one
// per key (the highest minimum wins), with the value found today.
export function pendingSettings(plan) {
  const byKey = new Map()

  for (const item of plan) {
    for (const setting of item.settings ?? []) {
      const id = `${setting.configPath}\0${setting.key}`
      const known = byKey.get(id)
      if (!known || (typeof setting.min === "number" && setting.min > targetOf(known))) {
        byKey.set(id, setting)
      }
    }
  }

  return [...byKey.values()]
    .map((setting) => ({
      ...setting,
      current: readSetting(setting.configPath, setting.key, typeof targetOf(setting)),
    }))
    .filter((setting) => !isMet(targetOf(setting), setting.current))
}

function relativeEntry(configRoot, installed) {
  const rel = relative(configRoot, installed).split(sep).join("/")
  return rel.startsWith("./") || rel.startsWith("../") ? rel : `./${rel}`
}

// `settings` is opt-in: a component that needs a config value never changes it
// unless the caller asked, and `config: false` still means "never touch
// opencode.json".
export function applyPlan(plan, { force = false, config = true, settings = false } = {}) {
  for (const item of plan) {
    if (existsSync(item.installed) && !force) {
      throw new Error(`${item.installed} already exists — use --force to overwrite`)
    }
  }

  // Reading the values also rejects an unusable one before anything is copied,
  // not halfway through. Each key is applied once, at the highest minimum any
  // selected component asks for, so the receipt never holds a chain of edits.
  const toApply = config && settings ? pendingSettings(plan) : []

  const paths = []
  const configs = []
  const applied = []

  for (const item of plan) {
    mkdirSync(dirname(item.installed), { recursive: true })

    if (statSync(item.source).isDirectory()) {
      rmSync(item.installed, { recursive: true, force: true })
      cpSync(item.source, item.installed, { recursive: true })
    } else {
      cpSync(item.source, item.installed)
    }
    paths.push(item.installed)

    if (item.entry && item.configPath && config) {
      const result = mergeConfig(item.configPath, item.component.register, item.entry)
      if (result.changed) {
        configs.push({ path: item.configPath, key: item.component.register, value: item.entry })
      }
    }

  }

  for (const setting of toApply) {
    const result = ensureSetting(setting.configPath, setting.key, targetOf(setting))
    if (result.changed) {
      applied.push({
        path: setting.configPath,
        key: setting.key,
        value: targetOf(setting),
        previous: result.previous,
      })
    }
  }

  return { paths, configs, settings: applied }
}

const CONFIG_SCHEMA = "https://opencode.ai/config.json"

// Two edits to one file can land in the same millisecond, and the second
// backup would then overwrite the first with already-modified content.
function backupFile(path) {
  const base = `${path}.bak-bazinga-${Date.now()}`
  let backup = base
  for (let n = 1; existsSync(backup); n += 1) backup = `${base}-${n}`
  copyFileSync(path, backup)
  return backup
}

function readConfig(configPath) {
  return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : undefined
}

function writeConfig(configPath, config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

// Dotted paths: "experimental.subagent_depth" is config.experimental.subagent_depth.
function getPath(object, key) {
  return key.split(".").reduce((node, part) => (isObject(node) ? node[part] : undefined), object)
}

function setPath(object, key, value) {
  const parts = key.split(".")
  const last = parts.pop()
  let node = object

  for (const part of parts) {
    if (node[part] === undefined) node[part] = {}
    else if (!isObject(node[part])) throw new Error(`"${part}" in ${key} is not an object`)
    node = node[part]
  }

  node[last] = value
}

// Removes the key and any parent object it leaves empty.
function deletePath(object, key) {
  const parts = key.split(".")
  const last = parts.pop()
  const chain = [object]

  for (const part of parts) {
    const next = chain[chain.length - 1]?.[part]
    if (!isObject(next)) return
    chain.push(next)
  }

  delete chain[chain.length - 1][last]

  for (let i = chain.length - 1; i > 0; i -= 1) {
    if (Object.keys(chain[i]).length > 0) break
    delete chain[i - 1][parts[i - 1]]
  }
}

// The value stored at `key`, or undefined when absent. A value of another type
// than the setting expects is refused: it is the user's to fix, not ours to
// guess at.
export function readSetting(configPath, key, type = "number") {
  const config = readConfig(configPath)
  if (!config) return undefined

  const value = getPath(config, key)
  if (value !== undefined && typeof value !== type) {
    throw new Error(`${configPath}: ${key} is ${JSON.stringify(value)}, not a ${type} — set it yourself`)
  }

  setPath(structuredClone(config), key, value ?? 0) // throws if a parent is not an object
  return value
}

// Bring `key` to `target`. A number is raised to at least the target and never
// lowered; a flag is set to the target. A value that already meets it is left
// alone.
export function ensureSetting(configPath, key, target) {
  const current = readSetting(configPath, key, typeof target)
  if (isMet(target, current)) return { changed: false, current }

  const existed = existsSync(configPath)
  const config = readConfig(configPath) ?? { $schema: CONFIG_SCHEMA }
  setPath(config, key, target)

  const backup = existed ? backupFile(configPath) : undefined
  writeConfig(configPath, config)
  return { changed: true, previous: current ?? null, backup }
}

// Put back what ensureSetting replaced, but only if the value is still the one
// the installer wrote. A value changed since then belongs to the user.
export function restoreSetting(configPath, key, value, previous) {
  const config = readConfig(configPath)
  if (!config || getPath(config, key) !== value) return false

  if (previous === null || previous === undefined) deletePath(config, key)
  else setPath(config, key, previous)

  writeConfig(configPath, config)
  return true
}

export function mergeConfig(configPath, key, value) {
  const existed = existsSync(configPath)
  const config = readConfig(configPath) ?? { $schema: CONFIG_SCHEMA }

  const list = Array.isArray(config[key]) ? config[key] : []
  const present = list.some((item) =>
    typeof item === "string" ? item === value : item && item.package === value,
  )
  if (present) return { changed: false }

  list.push(value)
  config[key] = list

  const backup = existed ? backupFile(configPath) : undefined

  writeConfig(configPath, config)
  return { changed: true, backup }
}

export function removeConfigEntry(configPath, key, value) {
  if (!existsSync(configPath)) return false

  const config = JSON.parse(readFileSync(configPath, "utf8"))
  const list = Array.isArray(config[key]) ? config[key] : []
  const next = list.filter((item) =>
    typeof item === "string" ? item !== value : !(item && item.package === value),
  )
  if (next.length === list.length) return false

  if (next.length === 0) delete config[key]
  else config[key] = next

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return true
}

// Undo exactly what a receipt records: the installed paths, then the config
// entries that were added for them. Anything else in the destination is left
// untouched.
export function uninstall(receipt) {
  for (const path of receipt.paths ?? []) {
    rmSync(path, { recursive: true, force: true })
  }

  for (const config of receipt.configs ?? []) {
    removeConfigEntry(config.path, config.key, config.value)
  }

  for (const setting of receipt.settings ?? []) {
    restoreSetting(setting.path, setting.key, setting.value, setting.previous)
  }
}
