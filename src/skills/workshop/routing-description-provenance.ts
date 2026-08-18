import { Buffer } from "node:buffer";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { parseSkillFrontmatter } from "../loading/frontmatter.js";
import { resolveUpdateProposalDescription } from "./proposal-draft.js";
import type { SkillProposalRecord } from "./types.js";

export const LEGACY_UPDATE_REDRAFT_MESSAGE =
  "This pending skill update predates routing-description provenance. Redraft the update before revising or applying it.";

const MAX_SKILL_ROUTING_DESCRIPTION_BYTES = 4_000;

type DescriptionFields = {
  draft: { description: string; skillDescription?: string };
  record: { description: string; routingDescription?: string };
};

function requireBoundedRoutingDescription(description: string): string {
  const sizeBytes = Buffer.byteLength(description, "utf8");
  if (sizeBytes > MAX_SKILL_ROUTING_DESCRIPTION_BYTES) {
    throw new Error(
      `Skill routing description is too large (${sizeBytes} bytes, max ${MAX_SKILL_ROUTING_DESCRIPTION_BYTES}).`,
    );
  }
  return description;
}

export function requireUpdateRoutingDescription(
  record: Pick<SkillProposalRecord, "kind" | "routingDescription">,
): string | undefined {
  if (record.kind !== "update") {
    return undefined;
  }
  if (record.routingDescription === undefined) {
    throw new Error(LEGACY_UPDATE_REDRAFT_MESSAGE);
  }
  return requireBoundedRoutingDescription(record.routingDescription);
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
  const routingDescription = requireBoundedRoutingDescription(
    normalizeOptionalString(parseSkillFrontmatter(content).description) ?? fallbackRoutingDescription,
  );
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
      : requireBoundedRoutingDescription(
          normalizeOptionalString(parseSkillFrontmatter(content).description) ??
            existingRoutingDescription,
        );
  return {
    draft: { description, skillDescription: routingDescription },
    record: { description, routingDescription },
  };
}