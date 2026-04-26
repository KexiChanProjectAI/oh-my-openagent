/**
 * Implementation Team Review Swarm Runner
 *
 * Fans out reviewer tasks by role and configured reviewer model list.
 * Each reviewer receives: current implementation attempt reference, exact role
 * contract, unresolved findings, and schema-constrained verdict instructions.
 */

import type { DelegateTaskArgs } from "../../tools/delegate-task/types"
import type { Finding } from "./schemas"
import type { ResolvedImplementationTeamConfig, ResolvedRole } from "./config-resolver"
import { getRoundEvidencePath } from "./evidence"

// ============================================================================
// Input/Output Types
// ============================================================================

export interface ReviewerTaskInput {
  runId: string
  round: number
  role: ResolvedRole
  reviewerModel: string
  reviewerIndex: number
  executorOutputRef: string
  taskDescription: string
  unresolvedFindings?: Finding[]
}

export interface ReviewerTaskResult {
  taskId: string
  reviewerId: string
  roleId: string
  modelId: string
  evidencePath: string
  sessionId: string
}

// ============================================================================
// Role Contracts
// ============================================================================

/**
 * Get role-specific review contract instructions.
 *
 * V1 DESIGN DECISION: Role prompts are hardcoded string templates.
 * Config-driven role prompt overrides (e.g., per-role `prompt` or `contract`
 * fields in ImplementationTeamConfigSchema) are DEFERRED to a follow-up task.
 * In V1, prompt refinement is done by editing the strings in this function directly.
 * No config schema expansion is needed for role prompt customization in this pass.
 */
export function getRoleContract(roleId: string): string {
  switch (roleId) {
    case "spec-fidelity":
      return `## SPEC-FIDELITY REVIEWER

You are SPEC-FIDELITY REVIEWER. Your ONLY job is to verify implementation matches spec. You are NOT a general code reviewer. Your core duty is to verify that the implementation faithfully adheres to the provided specification.

## In-Scope (MUST Review)

- Correct interpretation of requirements
- Spec conformance: Implementation matches every spec requirement
- Requirement adherence: All specified behaviors are correctly implemented
- Interface correctness: Public APIs, function signatures, data structures match spec
- Expected behavior: Outputs, return values, side effects match spec-defined behavior
- Spec-defined edge cases: Edge cases explicitly defined in the spec are handled correctly
- Data structure alignment: Fields, types, and shapes match spec definitions
- Behavioral equivalence: Logic and algorithms produce spec-equivalent results
- Spec-required validation: Input validation specified in spec is implemented

## Evidence Rule for FAIL

You MUST identify a SPECIFIC spec requirement that is violated. Every FAIL finding must cite:
1. Which spec requirement is violated
2. What the implementation does differently
3. File location where the mismatch occurs

## PASS Rule

If the implementation faithfully implements all spec requirements, your verdict is PASS. Do not invent concerns outside the spec.

## Out-of-Scope (MUST NOT Review)

- Code style, formatting, naming conventions
- Maintainability, modularity, code organization
- Error handling quality (unless spec mandates specific error behavior)
- Performance, algorithmic efficiency (unless spec-required)
- Security posture
- Race conditions, concurrency correctness
- Regression risk, backward compatibility
- Edge cases beyond spec
- General engineering best practices

## Severity Guidelines

- BLOCKER: Core spec requirement missing or wrong
- MAJOR: Significant spec deviation
- MINOR: Minor deviation from spec
- NONE: No issues found`

    case "code-quality":
      return `## Code Quality Review Contract

## Role Identity

You are CODE-QUALITY REVIEWER. Your job is to assess the code's internal quality as a software artifact — its organization, clarity, and fitness for long-term maintenance. You are NOT a spec reviewer, risk assessor, or security auditor.

## In-Scope (MUST Review)

- Code organization and modularity (modules, files, classes are logically decomposed)
- Naming clarity and consistency (identifiers are descriptive and follow project conventions)
- readability (code is clear and understandable)
- Error handling completeness (errors are caught, handled, and resources cleaned up)
- Resource management (memory, connections, file handles are properly managed)
- Test quality (tests are meaningful, cover important paths, are maintainable)
- Local correctness risks (bugs apparent from code structure, not runtime behavior)
- Type safety and appropriate type usage (no unsafe casts, proper generics)
- Dependency usage correctness (dependencies used as intended, no obvious misuse)

## Evidence Rule for FAIL

Every FAIL finding MUST point to specific code: file location, pattern, or structure that creates a maintainability problem or correctness risk. "This could be cleaner" is NOT sufficient evidence. Cite the actual code.

## PASS Rule

If the code meets acceptable engineering quality standards for production maintenance, your verdict is PASS. Do not invent concerns beyond code quality.

## Out-of-Scope (MUST NOT Review)

- Spec conformance or requirement adherence (belongs to spec-fidelity)
- Broad security posture or vulnerability assessment (belongs to risk-regression)
- Concurrency correctness (belongs to risk-regression — only flag structural patterns that predispose to races)
- Deployment risk or backward compatibility (belongs to risk-regression)
- Edge cases beyond the specified requirements (belongs to risk-regression)
- Performance regression risk (belongs to risk-regression — unless pathologically bad)
- Scaling concerns (belongs to risk-regression)
- Dependency vulnerabilities (belongs to risk-regression)
- Style-only nitpicks (formatting, whitespace, cosmetic preferences — do not flag these)

## Severity Guidelines

- BLOCKER: Critical bugs or fundamental structural issues that will cause failures or severe maintenance problems
- MAJOR: Significant code smells, poor error handling patterns, or major modularity issues
- MINOR: Minor quality improvements that would help maintenance but do not cause correctness risks
- NONE: No code quality issues found`

    case "risk-regression":
      return `## Risk & Regression Review Contract

## Role Identity

You are RISK & REGRESSION REVIEWER. Your job is to identify risks that could cause failures, regressions, or degradation in production. You are a pre-merge risk assessor. You are NOT a code-quality reviewer, style checker, or spec compliance auditor.

## In-Scope (MUST Review)

- Breakage risk: changes that could break existing functionality
- Backward compatibility: API/behavior changes breaking existing consumers
- Edge cases and boundary conditions (edge cases beyond spec): inputs or conditions outside spec boundaries
- Failure modes: what happens when things go wrong
- Integration hazards: risks from external system interactions
- Concurrency risks: race condition, deadlock, timing dependencies
- Data safety: data loss, corruption, or leak possibilities
- Dependency vulnerabilities: known CVEs, outdated vulnerable dependencies
- Operational regressions: behavior changes affecting production operations

## Evidence Rule for FAIL

Every FAIL finding must describe a CREDIBLE breakage or operational-risk path. You must identify: (1) what could fail, (2) under what conditions, (3) what the production impact would be. "This feels risky" is NOT sufficient evidence.

## PASS Rule

If no credible breakage, regression, or operational risk paths exist, your verdict is PASS. Do not invent risks.

## Out-of-Scope (MUST NOT Review)

- Code style, formatting, naming conventions
- Code organization or modularity (unless it creates production risk)
- Spec conformance or spec completeness
- General maintainability (unless it produces risk)
- Style-only nitpicks or cosmetic code quality concerns
- Local correctness bugs (belongs to code-quality)

## Severity Guidelines

- BLOCKER: Critical risk that could cause data loss, security breach, or system failure
- MAJOR: Significant risk that would cause production problems
- MINOR: Minor or theoretical risk with limited production impact
- NONE: No credible risks identified`

    default:
      return `## Generic Review Contract

Your role is REVIEWER for role: ${roleId}.

## Review Focus
- General code and specification review
- Issue identification and reporting

## Verdict Criteria
- PASS: Implementation meets standards
- FAIL: Issues found that should be addressed

## Severity Guidelines
- BLOCKER: Critical issues must be fixed
- MAJOR: Significant issues should be addressed
- MINOR: Minor issues or improvements
- NONE: No issues found`
  }
}

// ============================================================================
// Schema Definition (for embedding in prompts)
// ============================================================================

// Zod schema doesn't have .json property, so we define the schema structure here
// for embedding in prompts. This must match ReviewerVerdictSchema exactly.
const REVIEWER_VERDICT_SCHEMA = {
  schema_version: "1.0",
  run_id: "string",
  round: "number (positive integer)",
  role: "string",
  reviewer_id: "string",
  model_id: "string",
  verdict: "enum: PASS | FAIL",
  severity: "enum: BLOCKER | MAJOR | MINOR | NONE",
  blocker_count: "number (non-negative integer)",
  findings: [
    {
      id: "string",
      description: "string",
      severity: "enum: BLOCKER | MAJOR | MINOR",
      file_ref: "string (optional)",
      category: "enum: correctness | maintainability | risk | performance | security",
    },
  ],
  summary: "string",
  timestamp: "string (ISO 8601)",
}

// ============================================================================
// Shared Reviewer Rules (used by all roles)
// ============================================================================

/**
 * Returns shared reviewer rules that apply to ALL reviewer roles.
 * These rules establish evidence requirements, approval bias, bounded output,
 * JSON-only output expectations, and anti-noise rules.
 */
export function getSharedReviewerRules(): string {
  return `## Shared Reviewer Rules

### Approval Bias
PASS is the default. Only issue FAIL when you have concrete, specific evidence of a problem.

### Evidence Threshold
Every FAIL finding MUST cite specific code patterns, line references, or behavior that demonstrates the problem. File references (file_ref) are strongly encouraged.

### Output Cap
Maximum 10 findings per review. Prioritize highest-severity findings. Drop low-value duplicates.

### JSON-Only Output
Your ENTIRE response must be valid JSON matching the schema. No markdown, no explanation, no prose. Raw JSON only.

### Anti-Noise
Do NOT flag: style preferences (formatting, naming taste), speculative failures ("could possibly..."), duplicate findings already noted, or issues outside your role contract.`
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the reviewer prompt with role-specific contract and schema.
 *
 * V1 NOTE: Prompt composition is hardcoded in this function and getRoleContract().
 * In V1, changing prompts requires editing these functions directly.
 * Config-driven prompt customization is deferred to a follow-up task.
 */
export function buildReviewerPrompt(input: ReviewerTaskInput): string {
  const contract = getRoleContract(input.role.id)
  const schemaJson = JSON.stringify(REVIEWER_VERDICT_SCHEMA, null, 2)
  const sharedRules = getSharedReviewerRules()

  let prompt = `# Review Task

## 1. Task Context
${input.taskDescription}

## 2. Implementation Reference
${input.executorOutputRef}

${sharedRules}

${contract}

## 5. Previous Unresolved Findings
${
  input.unresolvedFindings && input.unresolvedFindings.length > 0
    ? input.unresolvedFindings
        .map(
          (f) =>
            `- [${f.severity}] ${f.category}: ${f.description}${f.file_ref ? ` (ref: ${f.file_ref})` : ""}`,
        )
        .join("\n")
    : "No unresolved findings from previous rounds."
}

## 6. Required Output Format
Your ENTIRE response must be valid JSON matching this schema. No other text. No markdown, no explanation, no prose — just the raw JSON object.

\`\`\`json
${schemaJson}
\`\`\`

## 7. Final Instructions
1. Review the implementation referenced in Section 2
2. Apply the shared rules from Section 3 and your role contract from Section 4
3. Consider any unresolved findings from Section 5
4. Produce a verdict following the exact JSON schema in Section 6
5. Output ONLY valid JSON — no markdown, no explanation, no prose, just the raw JSON`

  return prompt
}

// ============================================================================
// Task Args Building
// ============================================================================

/**
 * Build task args for delegate-task tool
 */
export function buildReviewerTaskArgs(input: ReviewerTaskInput): DelegateTaskArgs {
  const reviewerId = `${input.role.id}-reviewer-${input.reviewerIndex}`
  const prompt = buildReviewerPrompt(input)

  // Use category if available, otherwise undefined (subagent_type will be used with model)
  const category = input.role.reviewers[input.reviewerIndex]?.category

  return {
    description: `[Reviewer: ${input.role.name}] Round ${input.round} review for run ${input.runId}`,
    prompt,
    category,
    subagent_type: input.reviewerModel,
    run_in_background: true,
    task_id: reviewerId,
    load_skills: [],
  }
}

// ============================================================================
// Main Swarm Creation
// ============================================================================

/**
 * V1: reviewers are isolated, no cross-talk between reviewers
 *
 * Create a review swarm by fanning out reviewer tasks for all roles.
 *
 * For EACH role in config.roles:
 *   For EACH reviewer in role.reviewers:
 *     Creates a separate DelegateTaskArgs with run_in_background: true
 *
 * Returns an array of ReviewerTaskResult with task metadata.
 *
 * @throws Error if executorOutputRef is missing or empty
 */
export function createReviewSwarm(
  runId: string,
  round: number,
  config: ResolvedImplementationTeamConfig,
  executorOutputRef: string,
  taskDescription: string,
  unresolvedFindings?: Finding[],
): ReviewerTaskResult[] {
  if (!executorOutputRef || executorOutputRef.trim() === "") {
    throw new Error("executorOutputRef is required - must reference the implementation attempt")
  }

  // No roles = no reviewers
  if (!config.roles || config.roles.length === 0) {
    return []
  }

  const results: ReviewerTaskResult[] = []

  for (const role of config.roles) {
    for (let reviewerIndex = 0; reviewerIndex < role.reviewers.length; reviewerIndex++) {
      const reviewer = role.reviewers[reviewerIndex]

      const input: ReviewerTaskInput = {
        runId,
        round,
        role,
        reviewerModel: reviewer.model,
        reviewerIndex,
        executorOutputRef,
        taskDescription,
        unresolvedFindings,
      }

      // Validate input by building task args (this will throw on invalid input)
      buildReviewerTaskArgs(input)
      const reviewerId = `${input.role.id}-reviewer-${input.reviewerIndex}`
      const evidencePath = `${getRoundEvidencePath(runId, round)}verdict-${reviewerId}.json`

      results.push({
        taskId: reviewerId,
        reviewerId,
        roleId: role.id,
        modelId: reviewer.model,
        evidencePath,
        sessionId: "", // Will be filled by caller when task is actually spawned
      })
    }
  }

  return results
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all reviewer IDs that would be created for a given config
 */
export function getReviewerIds(config: ResolvedImplementationTeamConfig): string[] {
  const ids: string[] = []
  for (const role of config.roles) {
    for (let reviewerIndex = 0; reviewerIndex < role.reviewers.length; reviewerIndex++) {
      ids.push(`${role.id}-reviewer-${reviewerIndex}`)
    }
  }
  return ids
}

/**
 * Calculate total number of reviewers for a config
 */
export function getTotalReviewerCount(config: ResolvedImplementationTeamConfig): number {
  return config.roles.reduce((total, role) => total + role.reviewers.length, 0)
}
