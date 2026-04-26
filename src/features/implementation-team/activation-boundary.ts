/**
 * Activation boundary for implementation-team.
 * Defines which intents enter implementation-team by default and which must bypass it.
 */

import type { ResolvedImplementationTeamConfig } from "./config-resolver"

// ============================================================================
// Intent Types
// ============================================================================

export type ImplementationIntent =
  | "implementation"
  | "fix"
  | "build"
  | "refactor"
  | "optimization"
  | "docs"
  | "research"
  | "planning"
  | "evaluation"
  | "explanation"
  | "investigation"

/**
 * Intents that should ALWAYS bypass the implementation-team.
 * These represent non-production work: research, planning, documentation, evaluation.
 */
export const BYPASS_INTENTS = [
  "docs",
  "research",
  "planning",
  "evaluation",
  "explanation",
  "investigation",
] as const

export type BypassIntent = (typeof BYPASS_INTENTS)[number]

// ============================================================================
// Declarative Sets
// ============================================================================

/**
 * Intents that should ALWAYS activate the implementation-team.
 * These represent concrete code production work.
 */
export const ALWAYS_ACTIVATE: Set<ImplementationIntent> = new Set([
  "implementation",
  "fix",
  "build",
  "refactor",
  "optimization",
] as const)

/**
 * Intents that should ALWAYS bypass the implementation-team.
 * These represent non-production work: research, planning, documentation, evaluation.
 */
export const ALWAYS_BYPASS: Set<ImplementationIntent> = new Set(BYPASS_INTENTS)

// ============================================================================
// Activation Logic
// ============================================================================

/**
 * Configuration for activation boundary.
 * Used to override default behavior via config.
 */
export interface ActivationBoundaryConfig {
  enabled: boolean
}

/**
 * V1: implementation-only routing, no research/docs/planning
 *
 * Determines whether an intent should activate the implementation-team.
 *
 * @param intent - The classified intent from IntentGate
 * @param config - Optional config override; if config.enabled === false, always returns false
 * @returns true if the intent qualifies for implementation-team, false otherwise
 */
export function shouldActivateImplementationTeam(
  intent: ImplementationIntent,
  config?: ActivationBoundaryConfig | ResolvedImplementationTeamConfig,
): boolean {
  // Config override: if explicitly disabled, bypass everything
  if (config && "enabled" in config && config.enabled === false) {
    return false
  }

  // Check declarative sets
  if (ALWAYS_ACTIVATE.has(intent)) {
    return true
  }

  // investigation is special: only activates if paired with a fix intent
  // (which would be a different intent value)
  // Standalone investigation should bypass
  return false
}

/**
 * Returns a human-readable reason why an intent bypasses implementation-team,
 * or null if the intent should activate.
 *
 * @param intent - The classified intent from IntentGate
 * @returns null if should activate, or a reason string if bypassed
 */
export function getBypassReason(intent: ImplementationIntent): string | null {
  if (!ALWAYS_BYPASS.has(intent)) {
    return null
  }

  const reasons: Record<BypassIntent, string> = {
    docs: "Documentation-only work does not require implementation-team review",
    research: "Research and exploration does not require implementation-team review",
    planning: "Planning and architecture design does not require implementation-team review",
    evaluation: "Evaluation and assessment does not require implementation-team review",
    explanation: "Pure explanation and teaching does not require implementation-team review",
    investigation: "Investigation and debugging does not require implementation-team review",
  }
  return reasons[intent as BypassIntent]
}