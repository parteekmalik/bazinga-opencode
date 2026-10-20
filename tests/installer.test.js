import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  applyPlan,
  buildPlan,
  mergeConfig,
  removeConfigEntry,
  resolveDestination,
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

test("the registry exposes the plugin component", () => {
  const components = listComponents(registry)
  assert.deepEqual(components.map((component) => component.key), ["plugin:core"])
  assert.equal(components[0].source, ".opencode/plugins")
  assert.equal(components[0].register, "plugins")
})

test("--all selects every component", () => {
  assert.deepEqual(
    resolveSelection(registry, { all: true }).map((component) => component.key),
    ["plugin:core"],
  )
})

test("--profile selects a declared bundle", () => {
  assert.deepEqual(
    resolveSelection(registry, { profile: "full" }).map((component) => component.key),
    ["plugin:core"],
  )
})

test("--all, --profile and --only are unioned without duplicates", () => {
  const selected = resolveSelection(registry, {
    all: true,
    profile: "plugin",
    only: ["plugin:core"],
  })
  assert.equal(selected.length, 1)
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
