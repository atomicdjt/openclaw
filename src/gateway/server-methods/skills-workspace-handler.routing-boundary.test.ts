import { describe, expect, it } from "vitest";
import { projectSkillProposalGatewayResult } from "./skills-workspace-handler.js";

describe("Skill Workshop Gateway routing provenance", () => {
  it("removes internal routingDescription from proposal-record responses", () => {
    const result = projectSkillProposalGatewayResult({
      record: {
        schema: "openclaw.skill-workshop.proposal.v1",
        id: "proposal-routing-boundary",
        routingDescription: "Route this skill for durable scheduling and recovery workflows.",
      },
      content: "# Routing Boundary\n",
    });

    expect(result).toEqual({
      record: {
        schema: "openclaw.skill-workshop.proposal.v1",
        id: "proposal-routing-boundary",
      },
      content: "# Routing Boundary\n",
    });
  });
});
