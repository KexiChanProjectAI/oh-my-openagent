/**
 * Sisyphus routing directive for implementation-team.
 * Returns routing instructions that Sisyphus can inject into its prompt,
 * or null if the intent should bypass implementation-team.
 */

import type { ImplementationIntent } from "./activation-boundary"
import { shouldActivateImplementationTeam } from "./activation-boundary"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"

// ============================================================================
// Routing Directive Template
// ============================================================================

/**
 * Template for the routing directive injected into Sisyphus prompts.
 * Follows Sisyphus's instructional style: imperative, declarative, concise.
 *
 * The directive tells Sisyphus to use the implementation-team workflow
 * for qualifying intents, routing through executor-reviewer-judge cycle.
 */
export const ROUTING_DIRECTIVE_TEMPLATE = `## Implementation Team Workflow

For implementation work, use the implementation-team workflow:
- Delegate to the executor for code implementation
- Reviewers check spec-fidelity, code-quality, risk-regression
- Escalation judge arbitrates if consensus is not reached
- Maximum 2 ordinary review rounds before escalation`

// ============================================================================
// Routing Directive Function
// ============================================================================

/**
 * Activates and returns the routing directive for implementation-team.
 *
 * This function determines whether a given intent qualifies for the
 * implementation-team workflow and returns the routing instruction string
 * to inject into Sisyphus's prompt.
 *
 * @param intent - The classified intent from IntentGate
 * @param config - The resolved implementation-team configuration
 * @returns Routing directive string if intent qualifies, null if should bypass
 */
export function activateImplementationTeamRoutingDirective(
  intent: ImplementationIntent,
  config: ResolvedImplementationTeamConfig,
): string | null {
  // If implementation-team is disabled, bypass all intents
  if (config.enabled === false) {
    return null
  }

  // Check if intent qualifies for implementation-team
  if (!shouldActivateImplementationTeam(intent)) {
    return null
  }

  return ROUTING_DIRECTIVE_TEMPLATE
}

/**
 * Gets the routing directive for implementation-team.
 *
 * Alias for activateImplementationTeamRoutingDirective for consumers
 * who prefer getter-style naming.
 *
 * @param intent - The classified intent from IntentGate
 * @param config - The resolved implementation-team configuration
 * @returns Routing directive string if intent qualifies, null if should bypass
 */
export function getImplementationTeamRoutingDirective(
  intent: ImplementationIntent,
  config: ResolvedImplementationTeamConfig,
): string | null {
  return activateImplementationTeamRoutingDirective(intent, config)
}