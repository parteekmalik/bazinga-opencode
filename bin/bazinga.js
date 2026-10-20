#!/usr/bin/env node
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  applyPlan,
  buildPlan,
  pendingSettings,
  resolveDestination,
  uninstall as removeInstalled,
} from "../install/apply.js"
import { canPrompt, interactiveInstall, interactiveUninstall } from "../install/interactive.js"
import { readReceipt, removeReceipt, writeReceipt } from "../install/receipt.js"
import { listComponents, loadRegistry, resolveSelection } from "../install/resolve.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const HELP = `bazinga — install selected parts of this repo into an OpenCode folder

Interactive
  bazinga                       asks where and what to install
  bazinga install --global      asks only what is missing (here: what to install)
  bazinga uninstall             asks where to uninstall from

  Prompts appear only in a terminal, and only for what the flags leave open.
  A fully specified command never prompts.

Usage
  bazinga list
  bazinga install <destination> <selection> [--dry-run] [--force] [--no-config]
  bazinga uninstall <destination> [--dry-run]

Destination (exactly one)
  --global            OpenCode's config folder ($XDG_CONFIG_HOME/opencode)
  --project           ./.opencode in the current directory
  --target <path>     an absolute path

Selection (install only)
  --all               every component
  --profile <name>    a bundle declared in registry.json
  --only <type:id>    one or more, comma-separated — for example plugin:core

Other
  --dry-run           print the plan, write nothing
  --force             replace an existing installation
  --no-config         copy files but never touch opencode.json
  --settings          also raise config values the components need (for example
                      experimental.subagent_depth). Never lowers a value; backed up
                      first. Without it, install only prints what is missing

Examples
  node bin/bazinga.js list
  node bin/bazinga.js install --project --only plugin:core --dry-run
  node bin/bazinga.js install --global --all --dry-run
`

function parseArgs(argv) {
  const flags = {
    all: false,
    config: true,
    configExplicit: false,
    dryRun: false,
    force: false,
    global: false,
    only: [],
    project: false,
    settings: false,
    target: undefined,
    profile: undefined,
  }
  const positional = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === "--all") flags.all = true
    else if (arg === "--dry-run") flags.dryRun = true
    else if (arg === "--force") flags.force = true
    else if (arg === "--global") flags.global = true
    else if (arg === "--project") flags.project = true
    else if (arg === "--settings") flags.settings = true
    else if (arg === "--no-config") {
      flags.config = false
      flags.configExplicit = true
    }
    else if (arg === "--target") flags.target = argv[++i]
    else if (arg === "--profile") flags.profile = argv[++i]
    else if (arg === "--only") {
      flags.only.push(...String(argv[++i] ?? "").split(",").map((item) => item.trim()).filter(Boolean))
    } else if (arg === "--help" || arg === "-h") flags.help = true
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`)
    else positional.push(arg)
  }

  return { command: positional[0], flags }
}

function destinationOf(flags) {
  return resolveDestination({
    global: flags.global,
    project: flags.project,
    target: flags.target,
  })
}

function pad(value, width) {
  return String(value).padEnd(width)
}

function list() {
  const registry = loadRegistry(repoRoot)
  const components = listComponents(registry)

  if (components.length === 0) {
    console.log("Nothing to install.")
    return
  }

  const rows = components.map((component) => ({
    type: component.type,
    id: component.id,
    source: component.source,
    registers: component.register ?? "",
  }))

  const width = {
    type: Math.max(4, ...rows.map((row) => row.type.length)),
    id: Math.max(2, ...rows.map((row) => row.id.length)),
    source: Math.max(6, ...rows.map((row) => row.source.length)),
  }

  console.log(`${pad("TYPE", width.type)}  ${pad("ID", width.id)}  ${pad("SOURCE", width.source)}  REGISTERS`)
  for (const row of rows) {
    console.log(
      `${pad(row.type, width.type)}  ${pad(row.id, width.id)}  ${pad(row.source, width.source)}  ${row.registers}`,
    )
  }

  const profiles = Object.entries(registry.profiles ?? {})
  if (profiles.length > 0) {
    console.log("\nProfiles")
    for (const [name, keys] of profiles) {
      console.log(`  ${pad(name, 10)} ${keys.join(", ")}`)
    }
  }
}

// For reporting only: a config value we cannot read is a note, not a failure.
function unmetSettings(plan) {
  try {
    return pendingSettings(plan)
  } catch (error) {
    console.log(`note: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

function install(flags) {
  const registry = loadRegistry(repoRoot)
  const components = resolveSelection(registry, flags)
  const destination = destinationOf(flags)
  const plan = buildPlan(repoRoot, components, destination)

  if (flags.dryRun) {
    console.log("Dry run — nothing written")
    console.log(`Destination: ${destination.destination} (${destination.mode})`)
    for (const item of plan) {
      console.log(`\n  ${item.component.key}`)
      console.log(`    from    ${item.source}`)
      console.log(`    to      ${item.installed}`)
      if (item.entry) {
        console.log(`    config  ${item.configPath} → ${item.component.register}: ${item.entry}`)
      }
    }
    for (const setting of unmetSettings(plan)) {
      const state = flags.settings && flags.config ? "would set" : "needed, not applied without --settings"
      console.log(
        `\n  setting ${setting.configPath} → ${setting.key} >= ${setting.min} (now ${setting.current ?? "unset"}) — ${state}`,
      )
    }
    return
  }

  const { paths, configs, settings } = applyPlan(plan, {
    force: flags.force,
    config: flags.config,
    settings: flags.settings,
  })
  writeReceipt(destination.destination, {
    version: 1,
    installedAt: new Date().toISOString(),
    mode: destination.mode,
    destination: destination.destination,
    paths,
    configs,
    settings,
  })

  console.log(`Installed ${components.length} component(s) into ${destination.destination}`)
  for (const path of paths) console.log(`  + ${path}`)
  for (const config of configs) console.log(`  ~ ${config.path} → ${config.key}: ${config.value}`)
  for (const setting of settings) {
    console.log(`  ~ ${setting.path} → ${setting.key}: ${setting.value} (was ${setting.previous ?? "unset"})`)
  }
  console.log(`  receipt ${join(destination.destination, ".bazinga-install.json")}`)

  // Still unmet: say so, never change it silently.
  for (const setting of unmetSettings(plan)) {
    const fix = flags.config ? "Rerun with --settings, or set it yourself." : "Set it yourself."
    console.log(
      `note: ${setting.key} should be at least ${setting.min} in ${setting.configPath} (now ${setting.current ?? "unset"}). ` +
        `${setting.reason}. ${fix}`,
    )
  }
}

function uninstall(flags) {
  const destination = destinationOf(flags)
  const receipt = readReceipt(destination.destination)

  if (flags.dryRun) {
    console.log("Dry run — nothing removed")
    for (const path of receipt.paths ?? []) console.log(`  - ${path}`)
    for (const config of receipt.configs ?? []) {
      console.log(`  ~ ${config.path} → remove ${config.key}: ${config.value}`)
    }
    for (const setting of receipt.settings ?? []) {
      const action = setting.previous === null ? "remove" : `back to ${setting.previous}`
      console.log(`  ~ ${setting.path} → ${setting.key}: ${action} (only if still ${setting.value})`)
    }
    return
  }

  removeInstalled(receipt)
  removeReceipt(destination.destination)

  console.log(`Removed ${(receipt.paths ?? []).length} path(s) from ${destination.destination}`)
}

function missingInstallInput(flags) {
  const destination = flags.global || flags.project || Boolean(flags.target)
  const selection = flags.all || Boolean(flags.profile) || flags.only.length > 0
  return !destination || !selection
}

function missingDestination(flags) {
  return !(flags.global || flags.project || Boolean(flags.target))
}

try {
  const { command, flags } = parseArgs(process.argv.slice(2))
  const prompt = canPrompt()

  if (flags.help || command === "help") console.log(HELP)
  else if (command === undefined) {
    if (prompt) await interactiveInstall({ repoRoot, registry: loadRegistry(repoRoot), flags })
    else console.log(HELP)
  } else if (command === "list") list()
  else if (command === "install") {
    if (prompt && missingInstallInput(flags)) {
      await interactiveInstall({ repoRoot, registry: loadRegistry(repoRoot), flags })
    } else install(flags)
  } else if (command === "uninstall") {
    if (prompt && missingDestination(flags)) await interactiveUninstall({ flags })
    else uninstall(flags)
  } else throw new Error(`unknown command "${command}" — try "bazinga help"`)
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
