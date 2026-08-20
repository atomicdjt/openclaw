import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { parseSkillFrontmatter } from "../loading/frontmatter.js";
import { resolveUpdateProposalDescription } from "./proposal-draft.js";
import type { SkillProposalRecord } from "./types.js";

export const LEGACY_UPDATE_REDRAFT_MESSAGE =
  "This pending skill update predates routing-description provenance. Redraft the update before revising or applying it.";

type DescriptionFields = {
  draft: { description: string; skillDescription?: string };
  record: { description: string; routingDescription?: string };
};

export function requireUpdateRoutingDescription(
  record: Pick<SkillProposalRecord, "kind" | "routingDescription">,
): string | undefined {
  if (record.kind !== "update") {
    return undefined;
  }
  if (record.routingDescription === undefined) {
    throw new Error(LEGACY_UPDATE_REDRAFT_MESSAGE);
  }
  return record.routingDescription;
}

export function resolveForUpdate(
  requestedDescription: string | undefined,
  content: string,
  fallbackRoutingDescription: string,
): DescriptionFields {
  const description = resolveUpdateProposalDescription(
    requestedDescription,
    fallbackRoutingDescription,
  );
  const routingDescription =
    normalizeOptionalString(parseSkillFrontmatter(content).description) ??
    fallbackRoutingDescription;
  return {
    draft: { description, skillDescription: routingDescription },
    record: { description, routingDescription },
  };
}

export function resolveForRevision(
  record: Pick<SkillProposalRecord, "kind" | "description" | "routingDescription">,
  requestedDescription: string | undefined,
  content: string | undefined,
): DescriptionFields {
  const description = normalizeOptionalString(requestedDescription) ?? record.description;
  if (record.kind !== "update") {
    return { draft: { description }, record: { description } };
  }
  const existingRoutingDescription = requireUpdateRoutingDescription(record);
  const routingDescription =
    content === undefined
      ? existingRoutingDescription
      : (normalizeOptionalString(parseSkillFrontmatter(content).description) ??
        existingRoutingDescription);
  return {
    draft: { description, skillDescription: routingDescription },
    record: { description, routingDescription },
  };
}
