/**
 * Implementation Team Delegate Routing
 *
 * Resolves executor/reviewer categories and models from config for routing
 * through delegate-task. Provides validation of routing configuration.
 */

import type {
  ResolvedImplementationTeamConfig,
  ResolvedRole,
  ResolvedReviewer,
} from "./config-resolver"

// ============================================================================
// Routing Result Types
// ============================================================================

export interface RoutingValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// Executor Routing
// ============================================================================

/**
 * Resolves the executor category from implementation team config.
 * Returns executor's category or falls back to "unspecified-high" default.
 */
export function resolveExecutorCategory(
  config: ResolvedImplementationTeamConfig,
): string {
  return config.executor.category || "unspecified-high"
}

// ============================================================================
// Reviewer Routing
// ============================================================================

/**
 * Resolves reviewer category by roleId and reviewer index.
 * Returns the reviewer's category if defined, otherwise undefined.
 * The category is used for category-based routing through delegate-task.
 */
export function resolveReviewerCategory(
  config: ResolvedImplementationTeamConfig,
  roleId: string,
  reviewerIndex: number,
): string | undefined {
  const role = config.roles.find((r) => r.id === roleId)
  if (!role) {
    return undefined
  }
  if (reviewerIndex < 0 || reviewerIndex >= role.reviewers.length) {
    return undefined
  }
  return role.reviewers[reviewerIndex].category
}

/**
 * Resolves reviewer model string by roleId and reviewer index.
 * Returns the model string for direct model routing.
 * Throws if role or reviewer not found.
 */
export function resolveReviewerModel(
  config: ResolvedImplementationTeamConfig,
  roleId: string,
  reviewerIndex: number,
): string {
  const role = config.roles.find((r) => r.id === roleId)
  if (!role) {
    throw new Error(`Role not found: "${roleId}"`)
  }
  if (reviewerIndex < 0 || reviewerIndex >= role.reviewers.length) {
    throw new Error(
      `Reviewer index ${reviewerIndex} out of bounds for role "${roleId}" (has ${role.reviewers.length} reviewers)`,
    )
  }
  return role.reviewers[reviewerIndex].model
}

// ============================================================================
// Role Lookup Helpers
// ============================================================================

/**
 * Finds a role by its ID in the config.
 * Returns undefined if not found.
 */
export function findRoleById(
  config: ResolvedImplementationTeamConfig,
  roleId: string,
): ResolvedRole | undefined {
  return config.roles.find((r) => r.id === roleId)
}

/**
 * Gets a specific reviewer by roleId and reviewerIndex.
 * Returns undefined if not found.
 */
export function getReviewer(
  config: ResolvedImplementationTeamConfig,
  roleId: string,
  reviewerIndex: number,
): ResolvedReviewer | undefined {
  const role = findRoleById(config, roleId)
  if (!role) {
    return undefined
  }
  if (reviewerIndex < 0 || reviewerIndex >= role.reviewers.length) {
    return undefined
  }
  return role.reviewers[reviewerIndex]
}

// ============================================================================
// Routing Validation
// ============================================================================

/**
 * Validates routing configuration before spawning executor and reviewers.
 * Checks:
 * - executor has at least category or model defined
 * - each role has at least one reviewer
 * - each reviewer has a model defined
 *
 * Returns validation result with any errors found.
 */
export function validateRoutingConfig(
  config: ResolvedImplementationTeamConfig,
): RoutingValidationResult {
  const errors: string[] = []

  // Check executor has category or model
  const executor = config.executor
  if (!executor.category && !executor.model) {
    errors.push(
      "Executor must have at least one of: category, model. Currently executor has neither.",
    )
  }

  // Check each role has at least one reviewer and each reviewer has model
  for (const role of config.roles) {
    if (role.reviewers.length === 0) {
      errors.push(`Role "${role.id}" has no reviewers defined`)
      continue // skip model checks since there are no reviewers
    }

    for (let i = 0; i < role.reviewers.length; i++) {
      const reviewer = role.reviewers[i]
      if (!reviewer.model) {
        errors.push(
          `Role "${role.id}" reviewer at index ${i} has no model defined`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}