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

    return {
      component,
      source,
      installed,
      entry,
      configPath: entry ? join(destination.configRoot, "opencode.json") : undefined,
    }
  })
}

function relativeEntry(configRoot, installed) {
  const rel = relative(configRoot, installed).split(sep).join("/")
  return rel.startsWith("./") || rel.startsWith("../") ? rel : `./${rel}`
}

export function applyPlan(plan, { force = false, config = true } = {}) {
  for (const item of plan) {
    if (existsSync(item.installed) && !force) {
      throw new Error(`${item.installed} already exists — use --force to overwrite`)
    }
  }

  const paths = []
  const configs = []

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

  return { paths, configs }
}

export function mergeConfig(configPath, key, value) {
  const existed = existsSync(configPath)
  const config = existed
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : { "$schema": "https://opencode.ai/config.json" }

  const list = Array.isArray(config[key]) ? config[key] : []
  const present = list.some((item) =>
    typeof item === "string" ? item === value : item && item.package === value,
  )
  if (present) return { changed: false }

  list.push(value)
  config[key] = list

  let backup
  if (existed) {
    backup = `${configPath}.bak-bazinga-${Date.now()}`
    copyFileSync(configPath, backup)
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
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
}
