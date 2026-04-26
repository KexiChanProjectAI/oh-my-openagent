/**
 * Implementation Team Global Aggregator
 *
 * Aggregates multiple role verdicts into a single global verdict.
 * Global pass occurs only when ALL roles pass.
 */

import type {
  RoleAggregateVerdict,
  GlobalAggregateVerdict,
  ExecutorPatchBrief,
  Finding,
} from "./schemas"

/**
 * Aggregates multiple role verdicts into a single global verdict.
 * Global pass occurs only when ALL roles pass.
 */
export function aggregateGlobal(
  round: number,
  roleVerdicts: RoleAggregateVerdict[],
): GlobalAggregateVerdict {
  // Collect failed roles
  const failedRoles = roleVerdicts
    .filter((rv) => !rv.pass || rv.malformed_count > 0)
    .map((rv) => rv.role)

  // Global pass requires ALL roles to pass with no malformed verdicts
  const globalPass = failedRoles.length === 0

  // Build executor patch brief from BLOCKER findings in failed roles
  const executorPatchBrief = buildExecutorPatchBrief(round, roleVerdicts, failedRoles)

  return {
    pass: globalPass,
    round,
    failed_roles: failedRoles,
    role_aggregates: roleVerdicts,
    executor_patch_brief: executorPatchBrief,
  }
}

/**
 * Builds an ExecutorPatchBrief containing all BLOCKER findings from failed roles,
 * deduplicated by finding.id.
 */
function buildExecutorPatchBrief(
  round: number,
  roleVerdicts: RoleAggregateVerdict[],
  failedRoles: string[],
): ExecutorPatchBrief {
  // Collect all BLOCKER findings from failed roles
  const blockerFindings: Finding[] = []

  for (const rv of roleVerdicts) {
    if (failedRoles.includes(rv.role)) {
      for (const finding of rv.deduped_findings) {
        if (finding.severity === "BLOCKER") {
          blockerFindings.push(finding)
        }
      }
    }
  }

  // Dedupe by finding.id
  const seenIds = new Set<string>()
  const dedupedBlockers: Finding[] = []

  for (const finding of blockerFindings) {
    if (!seenIds.has(finding.id)) {
      seenIds.add(finding.id)
      dedupedBlockers.push(finding)
    }
  }

  return {
    unresolved_blockers: dedupedBlockers,
    failed_role_ids: failedRoles,
    execution_round: round,
  }
}