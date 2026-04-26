/**
 * Implementation Team Resource Caps
 *
 * Hard limits and validation for resource usage: max roles, reviewers per role,
 * ordinary rounds, escalation judge runs, and total spawned tasks.
 */

import type { ResolvedImplementationTeamConfig } from "./config-resolver"

// ============================================================================
// Hard Limits
// ============================================================================

export const MAX_ROLES = 5
export const MAX_REVIEWERS_PER_ROLE = 3
export const MAX_ORDINARY_ROUNDS = 2
export const MAX_ESCALATION_JUDGE_RUNS = 1
export const MAX_TOTAL_SPAWNED_TASKS = 20

// ============================================================================
// Types
// ============================================================================

export interface ResourceCapError {
  field: string
  message: string
  actual: number
  maxAllowed: number
}

export interface ResourceCapsResult {
  valid: boolean
  errors: ResourceCapError[]
}

export interface SpawnLimitResult {
  allowed: boolean
  current: number
  max: number
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates resource caps against hard limits.
 * Returns all errors (not just the first one) for comprehensive feedback.
 * Skips validation if config.enabled === false.
 */
export function validateResourceCaps(
  config: ResolvedImplementationTeamConfig,
): ResourceCapsResult {
  const errors: ResourceCapError[] = []

  // Skip validation if feature is disabled
  if (config.enabled === false) {
    return { valid: true, errors: [] }
  }

  // Check max roles
  if (config.roles.length > MAX_ROLES) {
    errors.push({
      field: "roles",
      message: `Too many roles (${config.roles.length}). Maximum is ${MAX_ROLES}.`,
      actual: config.roles.length,
      maxAllowed: MAX_ROLES,
    })
  }

  // Check max reviewers per role
  for (const role of config.roles) {
    if (role.reviewers.length > MAX_REVIEWERS_PER_ROLE) {
      errors.push({
        field: `roles.${role.id}.reviewers`,
        message: `Too many reviewers in role "${role.id}" (${role.reviewers.length}). Maximum is ${MAX_REVIEWERS_PER_ROLE}.`,
        actual: role.reviewers.length,
        maxAllowed: MAX_REVIEWERS_PER_ROLE,
      })
    }
  }

  // Check max ordinary rounds
  if (config.maxOrdinaryRounds > MAX_ORDINARY_ROUNDS) {
    errors.push({
      field: "maxOrdinaryRounds",
      message: `Too many ordinary rounds (${config.maxOrdinaryRounds}). Maximum is ${MAX_ORDINARY_ROUNDS}.`,
      actual: config.maxOrdinaryRounds,
      maxAllowed: MAX_ORDINARY_ROUNDS,
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Checks if spawning more tasks would exceed the total spawn cap.
 * Used at runtime when fanning out tasks.
 */
export function checkSpawnLimit(
  currentCount: number,
  maxAllowed: number,
): SpawnLimitResult {
  return {
    allowed: currentCount < maxAllowed,
    current: currentCount,
    max: maxAllowed,
  }
}
