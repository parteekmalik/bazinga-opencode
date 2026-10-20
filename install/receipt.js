import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const NAME = ".bazinga-install.json"

export function receiptPath(destination) {
  return join(destination, NAME)
}

export function readReceipt(destination) {
  const path = receiptPath(destination)
  if (!existsSync(path)) throw new Error(`no install receipt at ${path}`)
  return JSON.parse(readFileSync(path, "utf8"))
}

export function writeReceipt(destination, receipt) {
  writeFileSync(receiptPath(destination), `${JSON.stringify(receipt, null, 2)}\n`)
}

export function removeReceipt(destination) {
  rmSync(receiptPath(destination), { force: true })
}
