import type { SkillProposalRecord } from "./types.js";

const LEGACY_UPDATE_REDRAFT_MESSAGE =
  "This pending skill update predates routing-description provenance. Redraft the update before revising or applying it.";

/**
 * Returns the canonical routing description for an update proposal.
 * Legacy pending updates intentionally fail closed because their stored
 * description cannot distinguish routing metadata from proposal summary text.
 */
export function requireUpdateRoutingDescription(
  record: Pick<SkillProposalRecord, "kind" | "routingDescription">,
): string | undefined {
  if (record.kind !== "update") return undefined;
  if (record.routingDescription === undefined) throw new Error(LEGACY_UPDATE_REDRAFT_MESSAGE);
  return record.routingDescription;
}
