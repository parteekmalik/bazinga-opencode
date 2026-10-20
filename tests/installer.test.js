import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  applyPlan,
  buildPlan,
  commandExists,
  configStatus,
  describeServer,
  ensureSetting,
  mergeConfig,
  mergeServer,
  missingRuntimes,
  needsConfig,
  pendingSettings,
  readSetting,
  removeConfigEntry,
  removeServer,
  resolveDestination,
  restoreSetting,
  serverStates,
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

const TEAM = ["plugin:core", "agent:ceo", "agent:general-manager", "agent:workers/general", "agent:workers/setup"]
const MCPS = ["mcp:git", "mcp:fetch", "mcp:context7", "mcp:serena"]
const EVERYTHING = [...TEAM, ...MCPS]

test("the registry exposes the plugin, the four agents and the MCP servers", () => {
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
    TEAM,
  )
  assert.deepEqual(
    resolveSelection(registry, { profile: "mcp" }).map((component) => component.key),
    MCPS,
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
test("the ceo is a primary agent that denies everything except launching general-manager", () => {
  const ceo = readAgent("ceo")

  assert.ok(ceo.description)
  assert.equal(ceo.mode, "primary")
  assert.deepEqual(ceo.rules, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "subagent", resource: "general-manager", effect: "allow" },
  ])
  assert.ok(ceo.body.length > 0, "the prompt body must not be empty")
})

// The manager works only through workers. It has no way to read, edit or run;
// its one extra reach is Code Mode, for exactly the three worktree tools.
test("the manager may launch workers, keep a to-do list and use only the worktree tools", () => {
  const manager = readAgent("general-manager")

  assert.ok(manager.description)
  assert.equal(manager.mode, "subagent")
  assert.deepEqual(manager.rules[0], { action: "*", resource: "*", effect: "deny" })
  assert.deepEqual(allowed(manager), [
    "subagent:workers/*",
    "todowrite:*",
    "execute:*",
    "opencode_worktree_list:*",
    "opencode_worktree_create:*",
    "opencode_session_move:*",
  ])
  assert.ok(manager.body.length > 0)
})

// Checked against OpenCode: with only `execute` allowed the opencode namespace was
// "Unknown tool"; each opencode_<tool> permission is what makes it visible.
test("every worktree tool the manager's prompt tells it to call has a permission", () => {
  const manager = readAgent("general-manager")
  const called = [...manager.body.matchAll(/tools\.opencode\.(\w+)\(/g)].map((match) => match[1])

  assert.deepEqual([...new Set(called)].sort(), ["session_move", "worktree_create", "worktree_list"])
  for (const tool of called) {
    assert.ok(
      manager.rules.some((rule) => rule.action === `opencode_${tool}` && rule.effect === "allow"),
      `opencode_${tool} must be allowed`,
    )
  }
})

test("the manager never gets the tool that removes a worktree, so cleanup stays with the user", () => {
  const manager = readAgent("general-manager")
  assert.equal(manager.rules.some((rule) => /worktree_remove/.test(rule.action)), false)
  assert.doesNotMatch(manager.body, /tools\.opencode\.worktree_remove/)
})

test("the manager's prompt makes the worktree its first action and hands setup to workers/setup", () => {
  const { body } = readAgent("general-manager")
  assert.match(body, /## Your first action/)
  assert.ok(body.indexOf("## Your first action") < body.indexOf("## Working"))
  assert.match(body, /workers\/setup/)
  assert.match(body, /work\/<slug>/)
})

// The setup worker needs a shell, because project setup is commands. What it
// must not do is reach out: no launching, no pushing, no new remotes, no sudo.
test("the setup worker may run commands but not push, add remotes, sudo or launch", () => {
  const setup = readAgent("workers/setup")

  assert.ok(setup.description)
  assert.equal(setup.mode, "subagent")
  assert.deepEqual(setup.rules[0], { action: "*", resource: "*", effect: "deny" })

  const actions = new Set(setup.rules.filter((rule) => rule.effect === "allow").map((rule) => rule.action))
  assert.deepEqual([...actions].sort(), ["edit", "glob", "grep", "read", "shell"])

  const lastIndex = (resource, effect) =>
    setup.rules.findLastIndex((rule) => rule.action === "shell" && rule.resource === resource && rule.effect === effect)
  const broadAllow = lastIndex("*", "allow")
  for (const resource of ["git push *", "git remote *", "sudo *"]) {
    assert.ok(lastIndex(resource, "deny") > broadAllow, `${resource} must be denied after the broad shell allow`)
  }
})

test("the setup worker's prompt covers the guidance file, the branch and never printing secrets", () => {
  const { body } = readAgent("workers/setup")
  assert.match(body, /\.opencode\/worktree-setup\.md/)
  assert.match(body, /git switch -c/)
  assert.match(body, /detached HEAD/)
  assert.match(body, /Never put a secret value/)
  assert.match(body, /at most twice/)
})

// The worker is a leaf: it cannot run commands, ask, or launch anything.
test("the worker is a leaf that can read, search and edit but never run or launch", () => {
  const worker = readAgent("workers/general")

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
  const { rules } = readAgent("workers/general")
  const lastIndex = (action, resource, effect) =>
    rules.findLastIndex((rule) => rule.action === action && rule.resource === resource && rule.effect === effect)

  for (const action of ["read", "edit"]) {
    const broadAllow = lastIndex(action, "*", "allow")
    assert.ok(broadAllow >= 0)
    assert.ok(lastIndex(action, ".env*", "deny") > broadAllow, `${action} .env* must be denied after the allow`)
    assert.ok(lastIndex(action, "**/.env*", "deny") > broadAllow, `${action} **/.env* must be denied after the allow`)
  }
})

// A permission resource is a glob where * matches anything, slashes included
// (checked against OpenCode: "workers/*" allowed workers/alpha, refused "other").
const globMatches = (pattern, value) =>
  new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value)

const registeredAgents = () =>
  listComponents(registry)
    .filter((component) => component.type === "agent")
    .map((component) => component.id)

// Which registered agents an agent's allow rules for `subagent` let it launch.
const launchable = (agent) =>
  registeredAgents().filter((id) =>
    agent.rules.some((rule) => rule.action === "subagent" && rule.effect === "allow" && globMatches(rule.resource, id)),
  )

test("every subagent rule that allows something matches at least one registered agent", () => {
  for (const id of registeredAgents()) {
    for (const rule of readAgent(id).rules) {
      if (rule.action === "subagent" && rule.effect === "allow") {
        const matches = registeredAgents().filter((other) => globMatches(rule.resource, other))
        assert.ok(matches.length > 0, `${id} may launch "${rule.resource}", which matches no registered agent`)
      }
    }
  }
})

test("the manager can launch every worker, and the ceo can launch none of them", () => {
  const workers = registeredAgents().filter((id) => id.startsWith("workers/"))
  assert.ok(workers.length > 0)

  assert.deepEqual(launchable(readAgent("general-manager")), workers)
  assert.deepEqual(launchable(readAgent("ceo")), ["general-manager"])
  for (const worker of workers) assert.deepEqual(launchable(readAgent(worker)), [], `${worker} must launch nothing`)
})

test("the glob matcher treats * as anything, slashes included, and nothing else as special", () => {
  assert.equal(globMatches("workers/*", "workers/general"), true)
  assert.equal(globMatches("workers/*", "workers/deep/er"), true)
  assert.equal(globMatches("workers/*", "general-manager"), false)
  assert.equal(globMatches("workers/*", "other/workers/general"), false)
  assert.equal(globMatches("a.b", "aXb"), false)
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

const TODO = "experimental.todo"

test("the manager alone needs two levels and the to-do flag; the worker needs nothing", (t) => {
  const root = tempDir(t)

  const manager = pendingSettings(planFor(root, ["agent:general-manager"]))
  assert.deepEqual(
    manager.map((setting) => [setting.key, setting.min ?? setting.value]),
    [[DEPTH, 2], [TODO, true]],
  )

  assert.deepEqual(pendingSettings(planFor(root, ["agent:workers/general"])), [])
})

test("with the ceo and the manager the depth is set once, at the higher minimum", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  const plan = planFor(root, ["agent:general-manager", "agent:ceo", "agent:workers/general"])

  const result = applyPlan(plan, { settings: true })

  assert.deepEqual(result.settings, [
    { path: configPath, key: DEPTH, value: 3, previous: null },
    { path: configPath, key: TODO, value: true, previous: null },
  ])
  assert.equal(readSetting(configPath, DEPTH), 3)
  assert.equal(readSetting(configPath, TODO, "boolean"), true)

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))
  assert.equal(readJson(configPath).experimental, undefined)
})

test("the manager alone writes 2, and leaves a higher existing value alone", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")

  applyPlan(planFor(root, ["agent:general-manager"]), { settings: true })
  assert.equal(readSetting(configPath, DEPTH), 2)

  writeFileSync(configPath, JSON.stringify({ experimental: { subagent_depth: 4, todo: true } }))
  const again = applyPlan(planFor(root, ["agent:general-manager"]), { force: true, settings: true })
  assert.deepEqual(again.settings, [])
  assert.equal(readSetting(configPath, DEPTH), 4)
})

test("a flag is set when missing and left alone when already on", (t) => {
  const configPath = join(tempDir(t), "opencode.json")

  const first = ensureSetting(configPath, TODO, true)
  assert.deepEqual([first.changed, first.previous], [true, null])
  assert.equal(readSetting(configPath, TODO, "boolean"), true)

  assert.equal(ensureSetting(configPath, TODO, true).changed, false)
})

test("a flag the user turned off is switched on only through an explicit setting, and restored", (t) => {
  const root = tempDir(t)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({ experimental: { todo: false, other: 1 } }))

  const result = applyPlan(planFor(root, ["agent:general-manager"]), { settings: true })
  const todo = result.settings.find((setting) => setting.key === TODO)
  assert.deepEqual([todo.value, todo.previous], [true, false])
  assert.equal(readSetting(configPath, TODO, "boolean"), true)

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))
  assert.deepEqual(readJson(configPath).experimental, { todo: false, other: 1 })
})

test("a flag of the wrong type is refused untouched", (t) => {
  const configPath = join(tempDir(t), "opencode.json")
  writeFileSync(configPath, JSON.stringify({ experimental: { todo: "yes" } }))

  assert.throws(() => ensureSetting(configPath, TODO, true), /not a boolean/)
  assert.deepEqual(readJson(configPath), { experimental: { todo: "yes" } })
})

test("the manager's to-do rule matches a tool the flag actually enables", () => {
  const manager = listComponents(registry).find((component) => component.key === "agent:general-manager")
  assert.ok(manager.settings.some((setting) => setting.key === TODO && setting.value === true))
  assert.ok(readAgent("general-manager").rules.some((rule) => rule.action === "todowrite" && rule.effect === "allow"))
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

test("uninstall removes the folders it created for a nested agent, but not the destination", (t) => {
  const root = tempDir(t)
  const destination = resolveDestination({ target: root })
  const plan = buildPlan(repoRoot, resolveSelection(registry, { only: ["agent:workers/general"] }), destination)
  const result = applyPlan(plan)
  assert.ok(existsSync(join(root, "agents", "workers", "general.md")))

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))

  assert.equal(existsSync(join(root, "agents")), false, "empty agents/ should be gone")
  assert.equal(existsSync(root), true, "the destination itself stays")
})

test("uninstall keeps a folder that still holds someone else's file", (t) => {
  const root = tempDir(t)
  const destination = resolveDestination({ target: root })
  const plan = buildPlan(repoRoot, resolveSelection(registry, { only: ["agent:workers/general"] }), destination)
  const result = applyPlan(plan)

  const mine = join(root, "agents", "workers", "mine.md")
  writeFileSync(mine, "keep\n")
  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))

  assert.equal(existsSync(mine), true)
  assert.equal(existsSync(join(root, "agents", "workers", "general.md")), false)
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

// --- is there a config to change? -----------------------------------------

test("configStatus reports a folder with no opencode.json", (t) => {
  const root = tempDir(t)
  const status = configStatus(resolveDestination({ target: root }))

  assert.equal(status.path, join(root, "opencode.json"))
  assert.equal(status.exists, false)
  assert.equal(status.jsonc, false)
})

test("configStatus sees an existing opencode.json", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.json"), "{}")

  assert.equal(configStatus(resolveDestination({ target: root })).exists, true)
})

test("configStatus notices an opencode.jsonc without treating it as editable", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.jsonc"), "{ // comment\n}")
  const status = configStatus(resolveDestination({ target: root }))

  assert.equal(status.exists, false)
  assert.equal(status.jsonc, true)
})

test("for a project, the config is checked at the project root, not in .opencode", (t) => {
  const root = tempDir(t)
  const destination = resolveDestination({ project: true, cwd: root })

  assert.equal(configStatus(destination).path, join(root, "opencode.json"))
})

test("only components that register or declare settings need the config", () => {
  const pick = (...keys) => resolveSelection(registry, { only: keys })

  assert.equal(needsConfig(pick("plugin:core")), true)
  assert.equal(needsConfig(pick("agent:ceo")), true)
  assert.equal(needsConfig(pick("agent:workers/general")), false)
})

test("--no-config means the config is never needed", () => {
  const everything = resolveSelection(registry, { all: true })

  assert.equal(needsConfig(everything), true)
  assert.equal(needsConfig(everything, { config: false }), false)
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

// --- MCP servers -----------------------------------------------------------

const GIT = { type: "local", command: ["uvx", "mcp-server-git"] }

function mcpPlan(root, keys = MCPS) {
  return planFor(root, keys)
}

test("every mcp entry is a config-only component with a local command or a remote url", () => {
  const mcps = listComponents(registry).filter((component) => component.type === "mcp")
  assert.deepEqual(mcps.map((component) => component.key), MCPS)

  for (const mcp of mcps) {
    assert.equal(mcp.source, undefined, `${mcp.key} must not copy files`)
    assert.ok(mcp.description)
    if (mcp.server.type === "remote") assert.match(mcp.server.url, /^https:\/\//)
    else {
      assert.equal(mcp.server.type, "local")
      assert.ok(mcp.server.command.length > 0)
      assert.ok(mcp.requires?.includes(mcp.server.command[0]), `${mcp.key} must declare the program it runs`)
    }
  }
})

test("mergeServer creates the config and the mcp.servers path", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")

  assert.deepEqual(mergeServer(path, "git", GIT), { changed: true, backup: undefined })
  assert.deepEqual(readJson(path).mcp.servers.git, GIT)
})

test("mergeServer keeps everything else in the config, and backs up an existing file", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")
  writeFileSync(path, JSON.stringify({ model: "x", mcp: { servers: { other: { type: "remote", url: "https://a" } } } }))

  const result = mergeServer(path, "git", GIT)

  assert.equal(result.changed, true)
  assert.ok(existsSync(result.backup))
  const config = readJson(path)
  assert.equal(config.model, "x")
  assert.deepEqual(Object.keys(config.mcp.servers), ["other", "git"])
})

test("mergeServer never replaces a server that already has that name", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")
  writeFileSync(path, JSON.stringify({ mcp: { servers: { git: { type: "local", command: ["mine"] } } } }))
  const before = readFileSync(path, "utf8")

  assert.deepEqual(mergeServer(path, "git", GIT), { changed: false })
  assert.equal(readFileSync(path, "utf8"), before, "the file must be untouched")
})

test("a config whose mcp section has the wrong shape is refused, not overwritten", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")

  for (const bad of [{ mcp: "nope" }, { mcp: { servers: [] } }]) {
    writeFileSync(path, JSON.stringify(bad))
    assert.throws(() => mergeServer(path, "git", GIT), /is not an object/)
    assert.throws(() => applyPlan(mcpPlan(root, ["mcp:git"])), /is not an object/)
    assert.deepEqual(readJson(path), bad)
  }
})

test("removeServer removes only an entry that is still what was written, and prunes empties", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")
  mergeServer(path, "git", GIT)

  assert.equal(removeServer(path, "git", GIT), true)
  assert.equal(readJson(path).mcp, undefined, "empty mcp.servers and mcp are pruned")
  assert.equal(removeServer(path, "git", GIT), false, "nothing left to remove")
})

test("removeServer leaves a server the user edited, and its siblings", (t) => {
  const root = tempDir(t)
  const path = join(root, "opencode.json")
  const fetch = { type: "local", command: ["uvx", "mcp-server-fetch"] }
  mergeServer(path, "git", GIT)
  mergeServer(path, "fetch", fetch)

  const config = readJson(path)
  config.mcp.servers.git.command.push("--changed")
  writeFileSync(path, JSON.stringify(config))

  assert.equal(removeServer(path, "git", GIT), false)
  assert.equal(removeServer(path, "fetch", fetch), true)
  assert.deepEqual(Object.keys(readJson(path).mcp.servers), ["git"])
})

test("serverStates tells new servers from configured ones", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { git: { type: "local", command: ["mine"] } } } }))

  const states = serverStates(mcpPlan(root, ["mcp:git", "mcp:fetch"]))
  assert.deepEqual(states.map((state) => [state.name, state.present]), [["git", true], ["fetch", false]])
  assert.deepEqual(states[0].existing, { type: "local", command: ["mine"] })
})

test("installing mcp servers adds new ones, skips existing ones, and records only what it added", (t) => {
  const root = tempDir(t)
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { git: { type: "local", command: ["mine"] } } } }))

  const result = applyPlan(mcpPlan(root, ["mcp:git", "mcp:fetch"]))

  assert.deepEqual(result.servers.map((server) => server.name), ["fetch"])
  assert.deepEqual(result.skipped.map((item) => [item.name, item.reason]), [["git", "already configured"]])
  assert.deepEqual(result.paths, [])
  assert.deepEqual(readJson(join(root, "opencode.json")).mcp.servers.git, { type: "local", command: ["mine"] })

  writeReceipt(root, { version: 1, destination: root, ...result })
  uninstall(readReceipt(root))

  assert.deepEqual(Object.keys(readJson(join(root, "opencode.json")).mcp.servers), ["git"])
})

test("mcp servers are config-only: no files copied, and --no-config skips them", (t) => {
  const root = tempDir(t)
  const plan = mcpPlan(root, ["mcp:git"])
  assert.equal(needsConfig(plan.map((item) => item.component)), true)
  assert.equal(needsConfig(plan.map((item) => item.component), { config: false }), false)

  const result = applyPlan(plan, { config: false })
  assert.deepEqual(result.servers, [])
  assert.deepEqual(result.skipped.map((item) => item.reason), ["config changes are off"])
  assert.equal(existsSync(join(root, "opencode.json")), false)
})

test("choosing a server is its own consent: servers: true works with config: false", (t) => {
  const root = tempDir(t)
  const result = applyPlan(mcpPlan(root, ["mcp:git"]), { config: false, servers: true })

  assert.deepEqual(result.servers.map((server) => server.name), ["git"])
  assert.deepEqual(readJson(join(root, "opencode.json")).mcp.servers.git, GIT)
})

test("an mcp install and a plugin install share one config without clobbering each other", (t) => {
  const root = tempDir(t)
  const result = applyPlan(planFor(root, ["plugin:core", "mcp:git"]))

  const config = readJson(join(root, "opencode.json"))
  assert.equal(result.servers.length, 1)
  assert.equal(result.configs.length, 1)
  assert.equal(config.plugins.length, 1)
  assert.deepEqual(config.mcp.servers.git, GIT)
})

test("commandExists looks through PATH, and accepts an explicit path", (t) => {
  const root = tempDir(t)
  const program = join(root, "tool")
  writeFileSync(program, "#!/bin/sh\n", { mode: 0o755 })
  writeFileSync(join(root, "plain"), "x", { mode: 0o644 })

  assert.equal(commandExists("tool", { PATH: root }), true)
  assert.equal(commandExists("plain", { PATH: root }), false, "not executable")
  assert.equal(commandExists("nothing", { PATH: root }), false)
  assert.equal(commandExists("tool", {}), false)
  assert.equal(commandExists(program, {}), true)
})

test("missingRuntimes names what is absent, and ignores servers that are already configured", (t) => {
  const root = tempDir(t)
  const saved = process.env.PATH
  process.env.PATH = root
  t.after(() => {
    process.env.PATH = saved
  })

  const missing = missingRuntimes(mcpPlan(root))
  assert.deepEqual(missing.map((item) => [item.name, item.command]), [["git", "uvx"], ["fetch", "uvx"], ["serena", "serena"]])
  assert.ok(missing.every((item) => item.hint))

  writeFileSync(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { git: {}, fetch: {} } } }))
  assert.deepEqual(missingRuntimes(mcpPlan(root)).map((item) => item.name), ["serena"])
})

test("describeServer gives one line for either kind", () => {
  assert.equal(describeServer(GIT), "uvx mcp-server-git")
  assert.equal(describeServer({ type: "remote", url: "https://x/mcp" }), "https://x/mcp")
})
