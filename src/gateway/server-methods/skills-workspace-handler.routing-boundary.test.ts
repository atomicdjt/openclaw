import { describe, expect, it } from "vitest";
import { runSkillsProposalWorkspaceHandler } from "./skills-workspace-handler.js";

describe("Skill Workshop Gateway routing provenance", () => {
  it("removes internal routingDescription from proposal-record responses", async () => {
    const responses: unknown[] = [];
    const respond = ((ok: boolean, payload: unknown) => {
      if (ok) {
        responses.push(payload);
      }
    }) as unknown as Parameters<typeof runSkillsProposalWorkspaceHandler>[0]["respond"];
    const validate = (() => true) as unknown as Parameters<
      typeof runSkillsProposalWorkspaceHandler
    >[0]["validate"];
    const context = {
      getRuntimeConfig: () => ({}),
    } as unknown as Parameters<typeof runSkillsProposalWorkspaceHandler>[0]["context"];

    await runSkillsProposalWorkspaceHandler({
      method: "skills.proposals.inspect",
      rawParams: {},
      respond,
      context,
      validate,
      run: async () => ({
        record: {
          schema: "openclaw.skill-workshop.proposal.v1",
          id: "proposal-routing-boundary",
          routingDescription: "Route this skill for durable scheduling and recovery workflows.",
        },
        content: "# Routing Boundary\n",
      }),
    });

    expect(responses).toEqual([
      {
        record: {
          schema: "openclaw.skill-workshop.proposal.v1",
          id: "proposal-routing-boundary",
        },
        content: "# Routing Boundary\n",
      },
    ]);
  });
});
