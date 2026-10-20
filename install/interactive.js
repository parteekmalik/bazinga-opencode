import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import * as p from "@clack/prompts"

import {
  applyPlan,
  buildPlan,
  describeTarget,
  pendingSettings,
  resolveDestination,
  targetOf,
  uninstall,
} from "./apply.js"
import { readReceipt, receiptPath, removeReceipt, writeReceipt } from "./receipt.js"
import { listComponents, resolveSelection } from "./resolve.js"

// Prompts only ask for what the flags left open, so `--global` alone still asks
// what to install, and a fully specified command never prompts.

export function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

class Cancelled extends Error {}

function answer(value) {
  if (p.isCancel(value)) throw new Cancelled()
  return value
}

function hasDestination(flags) {
  return flags.global || flags.project || Boolean(flags.target)
}

function hasSelection(flags) {
  return flags.all || Boolean(flags.profile) || flags.only.length > 0
}

async function askDestination(flags, verb) {
  if (hasDestination(flags)) return resolveDestination(flags)

  const mode = answer(
    await p.select({
      message: `Where should it ${verb}?`,
      options: [
        { value: "global", label: "Global", hint: resolveDestination({ global: true }).destination },
        { value: "project", label: "This project", hint: resolveDestination({ project: true }).destination },
        { value: "target", label: "Custom folder", hint: "an absolute path" },
      ],
    }),
  )

  if (mode !== "target") return resolveDestination({ [mode]: true })

  const target = answer(
    await p.text({
      message: "Folder path?",
      placeholder: "/absolute/path/to/opencode",
      validate: (value) => {
        if (!value) return "A path is required"
        if (!isAbsolute(value)) return "Use an absolute path — relative paths are rejected"
        return undefined
      },
    }),
  )

  return resolveDestination({ target })
}

async function askComponents(registry, flags) {
  if (hasSelection(flags)) return resolveSelection(registry, flags)

  const available = listComponents(registry)
  const profiles = Object.entries(registry.profiles ?? {})

  const how = answer(
    await p.select({
      message: "What do you want to install?",
      options: [
        { value: "all", label: "Everything", hint: `${available.length} component(s)` },
        ...(profiles.length > 0 ? [{ value: "profile", label: "A profile" }] : []),
        { value: "pick", label: "Let me pick" },
      ],
    }),
  )

  if (how === "all") return resolveSelection(registry, { all: true })

  if (how === "profile") {
    const profile = answer(
      await p.select({
        message: "Which profile?",
        options: profiles.map(([name, keys]) => ({ value: name, label: name, hint: keys.join(", ") })),
      }),
    )
    return resolveSelection(registry, { profile })
  }

  const only = answer(
    await p.multiselect({
      message: "Pick components (space to toggle, enter to confirm)",
      options: available.map((component) => ({
        value: component.key,
        label: `${component.type.padEnd(8)} ${component.id}`,
        hint: component.description ?? component.source,
      })),
      required: true,
    }),
  )
  return resolveSelection(registry, { only })
}

async function askConfig(components, flags) {
  if (flags.configExplicit) return flags.config
  if (!components.some((component) => component.register)) return true

  return answer(
    await p.confirm({
      message: "Register the plugin in opencode.json? (backed up first)",
      initialValue: true,
    }),
  )
}

// Settings a selected component needs that opencode.json does not yet satisfy.
// Asked separately from registering the plugin: they are different changes to
// the same file, so each gets its own yes or no.
async function askSettings(plan, flags, config) {
  if (flags.configExplicit && !config) return false // --no-config

  const pending = pendingSettings(plan)
  if (pending.length === 0) return false
  if (flags.settings) return true

  const lines = pending.map(
    (setting) =>
      `${setting.key} → ${describeTarget(setting)}  (now ${setting.current ?? "unset"}) in ${setting.configPath}\n  ${setting.reason}`,
  )
  p.note(lines.join("\n\n"), "Settings these components need")

  return answer(
    await p.confirm({
      message: "Update them? (backed up first, never lowered)",
      initialValue: true,
    }),
  )
}

function describePlan(plan, config, settings) {
  const lines = []
  for (const item of plan) {
    lines.push(`+ ${item.installed}`)
    if (item.entry && config) {
      lines.push(`~ ${item.configPath} → ${item.component.register}: ${item.entry}`)
    }
  }
  if (config && settings) {
    for (const setting of pendingSettings(plan)) {
      lines.push(`~ ${setting.configPath} → ${setting.key}: ${targetOf(setting)}`)
    }
  }
  return lines.join("\n")
}

export async function interactiveInstall({ repoRoot, registry, flags }) {
  p.intro(" bazinga — install ")

  try {
    const destination = await askDestination(flags, "install")
    const components = await askComponents(registry, flags)
    const config = await askConfig(components, flags)
    const plan = buildPlan(repoRoot, components, destination)
    const settings = await askSettings(plan, flags, config)

    p.note(describePlan(plan, config, settings), `Plan — ${destination.mode}`)

    if (flags.dryRun) {
      p.outro("Dry run — nothing written")
      return
    }

    let force = flags.force
    const existing = plan.filter((item) => existsSync(item.installed))
    if (existing.length > 0 && !force) {
      force = answer(
        await p.confirm({
          message: `${existing.length} component(s) already installed. Replace them?`,
          initialValue: false,
        }),
      )
      if (!force) throw new Cancelled()
    }

    if (!answer(await p.confirm({ message: "Proceed?", initialValue: true }))) {
      throw new Cancelled()
    }

    const spinner = p.spinner()
    spinner.start("Installing")
    const { paths, configs, settings: applied } = applyPlan(plan, { force, config, settings })
    writeReceipt(destination.destination, {
      version: 1,
      installedAt: new Date().toISOString(),
      mode: destination.mode,
      destination: destination.destination,
      paths,
      configs,
      settings: applied,
    })
    spinner.stop(`Installed ${components.length} component(s)`)

    p.log.info(`Receipt: ${receiptPath(destination.destination)}`)
    p.outro(`Undo with: bazinga uninstall --${destination.mode === "target" ? `target ${destination.destination}` : destination.mode}`)
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Cancelled — nothing written")
      return
    }
    throw error
  }
}

export async function interactiveUninstall({ flags }) {
  p.intro(" bazinga — uninstall ")

  try {
    const destination = await askDestination(flags, "uninstall from")
    const receipt = readReceipt(destination.destination)

    const lines = [
      ...(receipt.paths ?? []).map((path) => `- ${path}`),
      ...(receipt.configs ?? []).map((c) => `~ ${c.path} → remove ${c.key}: ${c.value}`),
      ...(receipt.settings ?? []).map(
        (s) => `~ ${s.path} → ${s.key}: ${s.previous === null ? "remove" : `back to ${s.previous}`}`,
      ),
    ]
    p.note(lines.join("\n") || "(nothing recorded)", "Will remove")

    if (flags.dryRun) {
      p.outro("Dry run — nothing removed")
      return
    }

    if (!answer(await p.confirm({ message: "Remove these?", initialValue: false }))) {
      throw new Cancelled()
    }

    uninstall(receipt)
    removeReceipt(destination.destination)
    p.outro(`Removed ${(receipt.paths ?? []).length} path(s)`)
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Cancelled — nothing removed")
      return
    }
    throw error
  }
}
