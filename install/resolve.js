import { readFileSync } from "node:fs"
import { join } from "node:path"

// The four things this repo can place into an OpenCode folder. The registry key
// is plural, the selection key is singular: `plugins` in registry.json is picked
// with `plugin:core`.
export const TYPES = ["plugin", "agent", "skill", "command"]

const REGISTRY_KEYS = {
  plugin: "plugins",
  agent: "agents",
  skill: "skills",
  command: "commands",
}

export function loadRegistry(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "registry.json"), "utf8"))
}

export function listComponents(registry) {
  const components = []

  for (const type of TYPES) {
    for (const component of registry.components?.[REGISTRY_KEYS[type]] ?? []) {
      components.push({ ...component, type, key: `${type}:${component.id}` })
    }
  }

  return components
}

export function resolveSelection(registry, { all = false, profile, only = [] } = {}) {
  const available = listComponents(registry)
  const wanted = new Set()

  if (all) for (const component of available) wanted.add(component.key)

  if (profile) {
    const keys = registry.profiles?.[profile]
    if (!keys) throw new Error(`unknown profile "${profile}"`)
    for (const key of keys) wanted.add(key)
  }

  for (const key of only) wanted.add(key)

  if (wanted.size === 0) {
    throw new Error("nothing selected — use --all, --profile <name>, or --only <type:id>")
  }

  const byKey = new Map(available.map((component) => [component.key, component]))
  const missing = [...wanted].filter((key) => !byKey.has(key))
  if (missing.length > 0) {
    throw new Error(`unknown component(s): ${missing.join(", ")}`)
  }

  return [...wanted].map((key) => byKey.get(key))
}
