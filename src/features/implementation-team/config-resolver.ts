/**
 * Implementation Team Config Resolver
 *
 * Resolves and validates raw configuration into typed ResolvedImplementationTeamConfig.
 * Handles defaults, role normalization, and validation against resource caps.
 */

import { ImplementationTeamConfigSchema } from "../../config/schema/impl-team"
import type { FallbackModelObject } from "../../config/schema/fallback-models"

// ============================================================================
// Resolved Config Types
// ============================================================================

export interface ResolvedExecutorConfig {
  category: string
  model?: string
  fallbackModels?: (string | FallbackModelObject)[]
}

export interface ResolvedReviewer {
  model: string
  category?: string
}

export interface ResolvedRole {
  id: string
  name: string
  description?: string
  reviewers: ResolvedReviewer[]
  blockerPolicy: string
}

export interface ResolvedEscalationConfig {
  enabled: boolean
  model?: string
  category?: string
  fallbackModels?: (string | FallbackModelObject)[]
}

export interface ResourceCaps {
  maxTotalSpawnedTasks: number
  maxReviewersPerRole: number
  maxRoles: number
}

export interface ResolvedPassPolicy {
  requireAllRolesPass: boolean
}

export interface ResolvedBlockerPolicy {
  anyBlockerFailsRole: boolean
}

export interface ResolvedImplementationTeamConfig {
  enabled: boolean
  executor: ResolvedExecutorConfig
  roles: ResolvedRole[]
  maxOrdinaryRounds: number
  escalation: ResolvedEscalationConfig
  resourceCaps: ResourceCaps
  passPolicy: ResolvedPassPolicy
  blockerPolicy: ResolvedBlockerPolicy
  defaultRoles: boolean
}

// ============================================================================
// Default Roles
// ============================================================================

export function getDefaultRoles(): ResolvedRole[] {
  return [
    {
      id: "spec-fidelity",
      name: "Spec Fidelity",
      description: "Checks implementation against specification",
      reviewers: [{ model: "default" }],
      blockerPolicy: "any_blocker_fails_role",
    },
    {
      id: "code-quality",
      name: "Code Quality",
      description: "Reviews code quality and maintainability",
      reviewers: [{ model: "default" }],
      blockerPolicy: "any_blocker_fails_role",
    },
    {
      id: "risk-regression",
      name: "Risk & Regression",
      description: "Checks for risk, regression, and edge cases",
      reviewers: [{ model: "default" }],
      blockerPolicy: "any_blocker_fails_role",
    },
  ]
}

// ============================================================================
// Validation Errors
// ============================================================================

export class ImplementationTeamConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImplementationTeamConfigError"
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateRoleDefinitions(roles: ResolvedRole[], caps: ResourceCaps): void {
  // Check for duplicate role IDs
  const seenIds = new Set<string>()
  for (const role of roles) {
    if (seenIds.has(role.id)) {
      throw new ImplementationTeamConfigError(`Duplicate role ID: "${role.id}"`)
    }
    seenIds.add(role.id)
  }

  // Check max roles
  if (roles.length > caps.maxRoles) {
    throw new ImplementationTeamConfigError(
      `Too many roles: ${roles.length} roles defined but maxRoles is ${caps.maxRoles}`,
    )
  }

  // Check max reviewers per role and no empty reviewer arrays
  for (const role of roles) {
    if (role.reviewers.length === 0) {
      throw new ImplementationTeamConfigError(`Role "${role.id}" has no reviewers defined`)
    }
    if (role.reviewers.length > caps.maxReviewersPerRole) {
      throw new ImplementationTeamConfigError(
        `Role "${role.id}" has ${role.reviewers.length} reviewers but maxReviewersPerRole is ${caps.maxReviewersPerRole}`,
      )
    }
  }
}

// ============================================================================
// Config Resolver
// ============================================================================

export function resolveImplementationTeamConfig(raw: unknown): ResolvedImplementationTeamConfig {
  // Step 1: Parse against schema (use safeParse to handle undefined gracefully)
  // Treat undefined as empty object (all fields have defaults), but null is a validation error
  const parseResult = ImplementationTeamConfigSchema.safeParse(
    raw === undefined ? {} : raw,
  )
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new ImplementationTeamConfigError(`Invalid implementation-team config:\n${issues}`)
  }
  const parsed = parseResult.data

  // Step 2: Fill defaults for optional fields
  const enabled = parsed.enabled ?? true
  const maxOrdinaryRounds = parsed.max_ordinary_rounds ?? 2

  // Step 3: Resolve executor config
  const executor: ResolvedExecutorConfig = parsed.executor
    ? {
        category: parsed.executor.category,
        model: parsed.executor.model,
        fallbackModels: parsed.executor.fallback_models as
          | (string | FallbackModelObject)[]
          | undefined,
      }
    : {
        // Default executor category when not specified
        category: "unspecified-high",
      }

  // Step 4: Resolve roles
  let defaultRoles = false
  let roles: ResolvedRole[]

  if (!parsed.roles || parsed.roles.length === 0) {
    // Use default roles
    defaultRoles = true
    roles = getDefaultRoles()
  } else {
    // Normalize user-provided roles
    roles = parsed.roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      reviewers: r.reviewers.map((rev) => ({
        model: rev.model,
        category: rev.category,
      })),
      blockerPolicy: r.blocker_policy ?? "any_blocker_fails_role",
    }))
  }

  // Step 5: Resolve escalation config
  const escalation: ResolvedEscalationConfig = parsed.escalation
    ? {
        enabled: parsed.escalation.enabled ?? true,
        model: parsed.escalation.model,
        category: parsed.escalation.category,
        fallbackModels: parsed.escalation.fallback_models as
          | (string | FallbackModelObject)[]
          | undefined,
      }
    : {
        enabled: true,
      }

  // Step 6: Resolve resource caps
  const resourceCaps: ResourceCaps = parsed.resource_caps
    ? {
        maxTotalSpawnedTasks: parsed.resource_caps.max_total_spawned_tasks ?? 50,
        maxReviewersPerRole: parsed.resource_caps.max_reviewers_per_role ?? 5,
        maxRoles: parsed.resource_caps.max_roles ?? 3,
      }
    : {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      }

  // Step 7: Resolve pass policy
  const passPolicy: ResolvedPassPolicy = parsed.pass_policy
    ? {
        requireAllRolesPass: parsed.pass_policy.require_all_roles_pass ?? true,
      }
    : {
        requireAllRolesPass: true,
      }

  // Step 8: Resolve blocker policy
  const blockerPolicy: ResolvedBlockerPolicy = parsed.blocker_policy
    ? {
        anyBlockerFailsRole: parsed.blocker_policy.any_blocker_fails_role ?? true,
      }
    : {
        anyBlockerFailsRole: true,
      }

  // Step 9: Validate role definitions against caps
  validateRoleDefinitions(roles, resourceCaps)

  // Step 10: Validate maxOrdinaryRounds
  if (maxOrdinaryRounds < 1 || maxOrdinaryRounds > 5) {
    throw new ImplementationTeamConfigError(
      `maxOrdinaryRounds must be between 1 and 5, got ${maxOrdinaryRounds}`,
    )
  }

  return {
    enabled,
    executor,
    roles,
    maxOrdinaryRounds,
    escalation,
    resourceCaps,
    passPolicy,
    blockerPolicy,
    defaultRoles,
  }
}
