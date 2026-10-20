import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  applyPlan,
  buildPlan,
  ensureSetting,
  mergeConfig,
  pendingSettings,
  readSetting,
  removeConfigEntry,
  resolveDestination,
  restoreSetting,
  uninstall,
} from "../install/apply.js"
import { readReceipt, removeReceipt, writeReceipt } from "../install/receipt.js"
import { listComponents, loadRegistry, resolveSelection } from "../install/resolve.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const registry = loadRegistry(repoRoot)

function tempDir(t) {
  const directory = mkdtempSync(join(tmpdir(), "bazinga-install-"))
  t.after(() => {
    if (process.env.BAZINGA_KEEP_TESTS === "1") return
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function pluginSelection() {
  return resolveSelection(registry, { only: ["plugin:core"] })
}

function installInto(root, options) {
  const destination = resolveDestination({ target: root })
  const plan = buildPlan(repoRoot, pluginSelection(), destination)
  const result = applyPlan(plan, options)
  return { destination, plan, ...result }
}

// --- registry and selection ------------------------------------------------

const EVERYTHING = ["plugin:core", "agent:ceo", "agent:01-manager", "agent:worker"]

test("the registry exposes the plugin and the three agents", () => {
  const components = listComponents(registry)
  assert.deepEqual(components.map((component) => component.key), EVERYTHING)

  const plugin = components[0]
  assert.equal(plugin.source, ".opencode/plugins")
  assert.equal(plugin.register, "plugins")

  const ceo = components[1]
  assert.equal(ceo.source, ".opencode/agents/ceo.md")
  assert.equal(ceo.destination, "agents/ceo.md")
  assert.equal(ceo.register, undefined)
})

test("--all selects every component", () => {
  assert.deepEqual(
    resolveSelection(registry, { all: true }).map((component) => component.key),
    EVERYTHING,
  )
})

test("--profile selects a declared bundle", () => {
  assert.deepEqual(
    resolveSelection(registry, { profile: "full" }).map((component) => component.key),
    EVERYTHING,
  )
  assert.deepEqual(
    resolveSelection(registry, { profile: "plugin" }).map((component) => component.key),
    ["plugin:core"],
  )
})

test("--all, --profile and --only are unioned without duplicates", () => {
  const selected = resolveSelection(registry, {
    all: true,
    profile: "plugin",
    only: ["plugin:core"],
  })
  assert.equal(selected.length, EVERYTHING.length)
})

test("an unknown component is rejected", () => {
  assert.throws(
    () => resolveSelection(registry, { only: ["skill:nope"] }),
    /unknown component/,
  )
})

test("an unknown profile is rejected", () => {
  assert.throws(() => resolveSelection(registry, { profile: "nope" }), /unknown profile/)
})

test("an empty selection is rejected", () => {
  assert.throws(() => resolveSelection(registry, {}), /nothing selected/)
})

// --- destinations ----------------------------------------------------------

test("--global resolves beside XDG_CONFIG_HOME", (t) => {
  const root = tempDir(t)
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = root
  t.after(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  })

  const destination = resolveDestination({ global: true })
  assert.equal(destination.destination, join(root, "opencode"))
  assert.equal(destination.configRoot, join(root, "opencode"))
})

test("--project puts components under .opencode and config at the project root", () => {
  const cwd = join(tmpdir(), "fake-project")
  const destination = resolveDestination({ project: true, cwd })
  assert.equal(destination.destination, join(cwd, ".opencode"))
  assert.equal(destination.configRoot, cwd)
})

test("--target uses an absolute path unchanged", () => {
  const target = join(tmpdir(), "custom-opencode")
  const destination = resolveDestination({ target })
  assert.equal(destination.destination, target)
  assert.equal(destination.configRoot, target)
})

test("a relative --target is rejected", () => {
  assert.throws(() => resolveDestination({ target: "./relative" }), /absolute path/)
})

test("more than one destination is rejected", () => {
  assert.throws(() => resolveDestination({ global: true, project: true }), /only one of/)
})

test("no destination is rejected", () => {
  assert.throws(() => resolveDestination({}), /choose a destination/)
})

// --- install ---------------------------------------------------------------

test("install copies the plugin and registers it", (t) => {
  const root = tempDir(t)
  const { paths, configs } = installInto(root)

  const installed = join(root, "plugins", "bazinga")
  assert.deepEqual(paths, [installed])
  assert.ok(existsSync(join(installed, "index.ts")))

  const config = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))
  assert.deepEqual(config.plugins, ["./plugins/bazinga"])
  assert.deepEqual(configs, [
    { path: join(root, "opencode.json"), key: "plugins", value: "./plugins/bazinga" },
  ])
})

test("install refuses to overwrite without force", (t) => {
  const root = tempDir(t)
  installInto(root)

  const destination = resolveDestination({ target: root })
  const plan = buildPlan(repoRoot, pluginSelection(), destination)
  assert.throws(() => applyPlan(plan), /already exists/)
})

test("force replaces an existing install", (t) => {
  const root = tempDir(t)
  installInto(root)

  const installed = join(root, "plugins", "bazinga", "index.ts")
  writeFileSync(installed, "// changed\n")

  installInto(root, { force: true })
  assert.match(readFileSync(installed, "utf8"), /Plugin\.define/)
})

test("config can be skipped", (t) => {
  const root = tempDir(t)
  const { configs } = installInto(root, { config: false })

  assert.deepEqual(configs, [])
  assert.equal(existsSync(join(root, "opencode.json")), false)
  assert.ok(existsSync(join(root, "plugins", "bazinga", "index.ts")))
})

test("a project install registers the path relative to the project root", (t) => {
  const root = tempDir(t)
  const destination = resolveDestination({ project: true, cwd: root })
  const plan = buildPlan(repoRoot, pluginSelection(), destination)
  applyPlan(plan)

  assert.ok(existsSync(join(root, ".opencode", "plugins", "bazinga", "index.ts")))
  const config = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))
  assert.deepEqual(config.plugins, ["./.opencode/plugins/bazinga"])
})

// --- the ceo agent ---------------------------------------------------------

function installCeo(root) {
  const destination = resolveDestination({ target: root })
  const plan = buildPlan(repoRoot, resolveSelection(registry, { only: ["agent:ceo"] }), destination)
  return applyPlan(plan)
}

test("the agent installs on its own, without the plugin or any config change", (t) => {
  const root = tempDir(t)
  const { paths, configs } = installCeo(root)

  assert.deepEqual(paths, [join(root, "agents", "ceo.md")])
  assert.deepEqual(configs, [])
  assert.equal(existsSync(join(root, "opencode.json")), false)
  assert.equal(existsSync(join(root, "plugins")), false)
})

test("the installed agent is the shipped file, and uninstall removes only it", (t) => {
  const root = tempDir(t)
  const { paths, configs } = installCeo(root)
  const installed = join(root, "agents", "ceo.md")

  assert.equal(
    readFileSync(installed, "utf8"),
    readFileSync(join(repoRoot, ".opencode", "agents", "ceo.md"), "utf8"),
  )

  writeReceipt(root, {
    version: 1,
    installedAt: new Date().toISOString(),
    mode: "target",
    destination: root,
    paths,
    configs,
  })
  const unrelated = join(root, "agents", "mine.md")
  writeFileSync(unrelated, "keep\n")

  uninstall(readReceipt(root))

  assert.equal(existsSync(installed), false)
  assert.equal(existsSync(unrelated), true)
})

// An agent file as OpenCode reads it: frontmatter fields, the permission rules in
// order (the last matching rule wins), and the prompt body.
function readAgent(id) {
  const source = readFileSync(join(repoRoot, ".opencode", "agents", `${id}.md`), "utf8")
  const [, frontmatter, ...body] = source.split("---")

  const rules = [
    ...frontmatter.matchAll(/action: "?([^"\n]+)"?\n\s+resource: "?([^"\n]+)"?\n\s+effect: (\w+)/g),
  ].map(([, action, resource, effect]) => ({ action, resource, effect }))

  return {
    mode: frontmatter.match(/^mode: (\w+)$/m)?.[1],
    description: frontmatter.match(/^description: (.+)$/m)?.[1],
    rules,
    body: body.join("---").trim(),
  }
}

const allowed = (agent) =>
  agent.rules.filter((rule) => rule.effect === "allow").map((rule) => `${rule.action}:${rule.resource}`)

// The CEO is tool-less by design. If this list changes, change it on purpose.
test("the ceo is a primary agent that denies everything except launching 01-manager", () => {
  const ceo = readAgent("ceo")

  assert.ok(ceo.description)
  assert.equal(ceo.mode, "primary")
  assert.deepEqual(ceo.rules, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "subagent", resource: "01-manager", effect: "allow" },
  ])
  assert.ok(ceo.body.length > 0, "the prompt body must not be empty")
})

// The manager works only through workers. It has no way to read, edit or run.
test("the manager is a subagent that may launch workers and keep a to-do list, nothing else", () => {
  const manager = readAgent("01-manager")

  assert.ok(manager.description)
  assert.equal(manager.mode, "subagent")
  assert.deepEqual(manager.rules[0], { action: "*", resource: "*", effect: "deny" })
  assert.deepEqual(allowed(manager), ["subagent:worker", "todowrite:*"])
  assert.ok(manager.body.length > 0)
})

// The worker is a leaf: it cannot run commands, ask, or launch anything.
test("the worker is a leaf that can read, search and edit but never run or launch", () => {
  const worker = readAgent("worker")

  assert.ok(worker.description)
  assert.equal(worker.mode, "subagent")
  assert.deepEqual(worker.rules[0], { action: "*", resource: "*", effect: "deny" })

  const actions = new Set(worker.rules.filter((rule) => rule.effect === "allow").map((rule) => rule.action))
  assert.deepEqual([...actions].sort(), ["edit", "glob", "grep", "read"])
  assert.ok(worker.body.length > 0)
})

// Rules are appended after the global defaults and the last match wins, so a
// broad allow would re-open files the defaults protect unless a deny follows it.
test("the worker re-denies secret files after its broad read and edit allows", () => {
  const { rules } = readAgent("worker")
  const lastIndex = (action, resource, effect) =>
    rules.findLastIndex((rule) => rule.action === action && rule.resource === resource && rule.effect === effect)

  for (const action of ["read", "edit"]) {
    const broadAllow = lastIndex(action, "*", "allow")
    assert.ok(broadAllow >= 0)
    assert.ok(lastIndex(action, ".env*", "deny") > broadAllow, `${action} .env* must be denied after the allow`)
    assert.ok(lastIndex(action, "**/.env*", "deny") > broadAllow, `${action} **/.env* must be denied after the allow`)
  }
})

test("every agent an agent may launch is a registered agent", () => {
  const registered = new Set(
    listComponents(registry)
      .filter((component) => component.type === "agent")
      .map((component) => component.id),
  )

  for (const id of registered) {
    const agent = readAgent(id)
    for (const rule of agent.rules) {
      if (rule.action === "subagent" && rule.effect === "allow") {
        assert.ok(registered.has(rule.resource), `${id} may launch "${rule.resource}", which is not registered`)
      }
    }
  }
})

test("every registered agent ships a file with the declared source and destination", () => {
  for (const component of listComponents(registry).filter((c) => c.type === "agent")) {
    assert.equal(component.source, `.opencode/agents/${component.id}.md`)
    assert.equal(component.destination, `agents/${component.id}.md`)
    assert.ok(existsSync(join(repoRoot, component.source)))
  }
})

// --- settings --------------------------------------------------------------

const DEPTH = "experimental.subagent_depth"

function ceoPlan(root) {
  const destination = resolveDestination({ target: root })
  return buildPlan(repoRoot, resolveSelection(registry, { only: ["agent:ceo"] }), destination)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

test("the ceo declares the subagent depth it needs", () => {
  const ceo = listComponents(registry).find((component) => component.key === "agent:ceo")
  assert.equal(ceo.settings.length, 1)
  assert.equal(ceo.settings[0].key, DEPTH)
  assert.ok(ceo.settings[0].min >= 2, "CEO -> manager -> worker needs at least two levels")
  assert.ok(ceo.settings[0].reason)
})

function planFor(root, keys) {
  const destination = resolveDestination({ target: root })
  return buildPlan(repoRoot, resolveSelection(registry, { only: keys }), destination)
}

test("the manager alone needs two levels; the worker needs none", (t) => {
  const root = tempDir(t)

  const manager = pendingSettings(planFor(root, ["agent:01-manager"]))
  assert.equal(manager.length, 1)
  assert.equal(manager[0].min, 2)

  assert.deepEqual(pendingSettings(planFor(root, ["agent:worker"])), [])
})

test("with the ceo and the manager the depth is set once, at the higher minimum", (t) => {
  const root = tempDir(t)
  const plan = planFor(root, ["agent:01-manager", "agent:ceo", "agent:worker"])

  const result = applyPlan(plan, { settings: true })

  assert.deepEqual(result.settings, [
    { path: join(root, "opencode.json"), key: DEPTH, value: 3, previous: null },
  ])
  assert.equal(readSetting(join(root, "opencode.json"), DEPTH), 3)

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))
  assert.equal(readJson(join(root, "opencode.json")).experimental, undefined)
})

test("the manager alone writes 2, and leaves a higher existing value alone", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")

  applyPlan(planFor(root, ["agent:01-manager"]), { settings: true })
  assert.equal(readSetting(configPath, DEPTH), 2)

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 4 } }))
  const again = applyPlan(planFor(root, ["agent:01-manager"]), { force: true, settings: true })
  assert.deepEqual(again.settings, [])
  assert.equal(readSetting(configPath, DEPTH), 4)
})

test("ensureSetting creates the nested key and the config when none exists", (t) => {
  const configPath = join(tempDir(t), "opencode.json")

  const result = ensureSetting(configPath, DEPTH, 3)

  assert.equal(result.changed, true)
  assert.equal(result.previous, null)
  assert.equal(result.backup, undefined)
  assert.deepEqual(readJson(configPath).experimental, { subagent_depth: 3 })
  assert.match(readJson(configPath).$schema, /opencode\.ai/)
})

test("ensureSetting raises a lower value, keeps the rest, and backs up", (t) => {
  const configPath = join(tempDir(t), "opencode.json")
  writeFileSync(
    configPath,
    JSON.stringify({ model: "a/b", experimental: { subagent_depth: 1, other: true } }),
  )

  const result = ensureSetting(configPath, DEPTH, 3)

  assert.equal(result.changed, true)
  assert.equal(result.previous, 1)
  assert.ok(existsSync(result.backup))
  assert.deepEqual(readJson(configPath), {
    model: "a/b",
    experimental: { subagent_depth: 3, other: true },
  })
})

test("ensureSetting never lowers a value", (t) => {
  const configPath = join(tempDir(t), "opencode.json")
  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 5 } }))
  const before = readFileSync(configPath, "utf8")

  assert.equal(ensureSetting(configPath, DEPTH, 3).changed, false)
  assert.equal(ensureSetting(configPath, DEPTH, 5).changed, false)
  assert.equal(readFileSync(configPath, "utf8"), before)
})

test("a value that is not a number, or a parent that is not an object, is refused untouched", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: "deep" } }))
  assert.throws(() => ensureSetting(configPath, DEPTH, 3), /not a number/)

  writeFileSync(configPath, JSON.stringify({ experimental: true }))
  assert.throws(() => ensureSetting(configPath, DEPTH, 3), /not an object/)
  assert.deepEqual(readJson(configPath), { experimental: true })
})

test("two edits to one config get two distinct backups", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ model: "a/b" }))

  const first = mergeConfig(configPath, "plugins", "./a")
  const second = ensureSetting(configPath, DEPTH, 3)

  assert.notEqual(first.backup, second.backup)
  assert.deepEqual(readJson(first.backup), { model: "a/b" })
  assert.deepEqual(readJson(second.backup).plugins, ["./a"])
})

test("a component's settings are not applied unless asked for", (t) => {
  const root = tempDir(t)
  const result = applyPlan(ceoPlan(root))

  assert.deepEqual(result.settings, [])
  assert.equal(existsSync(join(root, "opencode.json")), false)
})

test("settings apply when asked, and are recorded with the previous value", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ experimental: { subagent_depth: 1 } }))

  const result = applyPlan(ceoPlan(root), { settings: true })

  assert.deepEqual(result.settings, [
    { path: join(root, "opencode.json"), key: DEPTH, value: 3, previous: 1 },
  ])
  assert.equal(readSetting(join(root, "opencode.json"), DEPTH), 3)
})

test("--no-config also blocks settings", (t) => {
  const root = tempDir(t)
  const result = applyPlan(ceoPlan(root), { config: false, settings: true })

  assert.deepEqual(result.settings, [])
  assert.equal(existsSync(join(root, "opencode.json")), false)
})

test("an unusable setting stops the install before anything is copied", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ experimental: { subagent_depth: "x" } }))

  assert.throws(() => applyPlan(ceoPlan(root), { settings: true }), /not a number/)
  assert.equal(existsSync(join(root, "agents", "ceo.md")), false)
})

test("pendingSettings lists only what the config does not already satisfy", (t) => {
  const root = tempDir(t)
  const plan = ceoPlan(root)
  const configPath = join(root, "opencode.json")

  assert.equal(pendingSettings(plan).length, 1)
  assert.equal(pendingSettings(plan)[0].current, undefined)

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 2 } }))
  assert.equal(pendingSettings(plan)[0].current, 2)

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 3 } }))
  assert.deepEqual(pendingSettings(plan), [])
})

test("uninstall puts a raised setting back to its previous value", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ model: "a/b", experimental: { subagent_depth: 1, other: true } }))

  const result = applyPlan(ceoPlan(root), { settings: true })
  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))

  assert.deepEqual(readJson(configPath), {
    model: "a/b",
    experimental: { subagent_depth: 1, other: true },
  })
})

test("uninstall removes a setting it created, and the empty parent with it", (t) => {
  const root = tempDir(t)
  const result = applyPlan(ceoPlan(root), { settings: true })
  writeReceipt(root, { version: 1, destination: root, ...result })

  uninstall(readReceipt(root))

  assert.equal(readJson(join(root, "opencode.json")).experimental, undefined)
})

test("uninstall leaves a setting the user changed since", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  const result = applyPlan(ceoPlan(root), { settings: true })
  writeReceipt(root, { version: 1, destination: root, ...result })

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 7 } }))
  uninstall(readReceipt(root))

  assert.equal(readSetting(configPath, DEPTH), 7)
})

test("restoreSetting does nothing without a config", (t) => {
  assert.equal(restoreSetting(join(tempDir(t), "opencode.json"), DEPTH, 3, null), false)
})

test("a setting already satisfied is not recorded, so uninstall leaves it alone", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 4 } }))

  const result = applyPlan(ceoPlan(root), { settings: true })
  assert.deepEqual(result.settings, [])

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))
  assert.equal(readSetting(configPath, DEPTH), 4)
})

test("buildPlan rejects a registry entry with a missing source", () => {
  const destination = resolveDestination({ target: join(tmpdir(), "unused") })
  const component = {
    id: "gone",
    type: "plugin",
    source: ".opencode/gone",
    destination: "plugins/gone",
    key: "plugin:gone",
  }

  assert.throws(() => buildPlan(repoRoot, [component], destination), /missing path/)
})

// --- config merge ----------------------------------------------------------

test("mergeConfig appends to an existing file and backs it up", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(
    configPath,
    `${JSON.stringify({ model: "test/model", plugins: ["./a"] }, null, 2)}\n`,
  )

  const result = mergeConfig(configPath, "plugins", "./b")
  assert.equal(result.changed, true)
  assert.ok(result.backup)
  assert.ok(existsSync(result.backup))

  const config = JSON.parse(readFileSync(configPath, "utf8"))
  assert.equal(config.model, "test/model")
  assert.deepEqual(config.plugins, ["./a", "./b"])
})

test("mergeConfig is idempotent", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")

  mergeConfig(configPath, "plugins", "./b")
  const before = readFileSync(configPath, "utf8")
  const result = mergeConfig(configPath, "plugins", "./b")

  assert.equal(result.changed, false)
  assert.equal(readFileSync(configPath, "utf8"), before)
})

test("mergeConfig recognises the object form", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(
    configPath,
    JSON.stringify({ plugins: [{ package: "./b", options: { target: "cwd" } }] }),
  )

  const result = mergeConfig(configPath, "plugins", "./b")
  assert.equal(result.changed, false)
})

test("removeConfigEntry removes only the matching value", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ plugins: ["./a", "./b"] }))

  assert.equal(removeConfigEntry(configPath, "plugins", "./b"), true)
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugins, ["./a"])
})

test("removeConfigEntry deletes the key when it becomes empty", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ plugins: ["./b"], model: "x" }))

  removeConfigEntry(configPath, "plugins", "./b")
  const config = JSON.parse(readFileSync(configPath, "utf8"))
  assert.equal(config.plugins, undefined)
  assert.equal(config.model, "x")
})

// --- receipt and uninstall -------------------------------------------------

test("receipt roundtrip and uninstall remove exactly what was recorded", (t) => {
  const root = tempDir(t)
  const { paths, configs } = installInto(root)
  writeReceipt(root, {
    version: 1,
    installedAt: new Date().toISOString(),
    mode: "target",
    destination: root,
    paths,
    configs,
  })

  const unrelated = join(root, "keep.txt")
  writeFileSync(unrelated, "keep\n")

  uninstall(readReceipt(root))

  assert.equal(existsSync(join(root, "plugins", "bazinga")), false)
  assert.equal(existsSync(unrelated), true)
  const config = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))
  assert.equal(config.plugins, undefined)

  removeReceipt(root)
  assert.throws(() => readReceipt(root), /no install receipt/)
})

test("readReceipt rejects a destination without one", (t) => {
  const root = tempDir(t)
  assert.throws(() => readReceipt(root), /no install receipt/)
})
