/**
 * Implementation Team Run State Store
 *
 * Lightweight persistent run-state storage for pipeline id, current round,
 * attempt refs, reviewer refs, aggregate refs, escalation status, and terminal
 * outcome. Ensures recovery is deterministic after interruption.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { RunState } from "./state-machine"

const STATE_DIR = ".sisyphus/impl-team"

function getRunFilePath(runId: string): string {
  return join(STATE_DIR, `${runId}.json`)
}

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

export function saveRunState(runId: string, state: RunState): void {
  ensureStateDir()
  const filePath = getRunFilePath(runId)
  const json = JSON.stringify(state, null, 2)
  writeFileSync(filePath, json, "utf-8")
}

export function loadRunState(runId: string): RunState | null {
  const filePath = getRunFilePath(runId)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    // Validate required fields are present
    if (typeof parsed.runId !== "string") {
      return null
    }
    if (typeof parsed.state !== "string") {
      return null
    }
    if (typeof parsed.round !== "number") {
      return null
    }

    return parsed as RunState
  } catch {
    return null
  }
}

export function deleteRunState(runId: string): void {
  const filePath = getRunFilePath(runId)

  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export function listRunStates(): string[] {
  if (!existsSync(STATE_DIR)) {
    return []
  }

  try {
    const files = readdirSync(STATE_DIR)
    return files
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => f.replace(/\.json$/, ""))
      .sort()
  } catch {
    return []
  }
}