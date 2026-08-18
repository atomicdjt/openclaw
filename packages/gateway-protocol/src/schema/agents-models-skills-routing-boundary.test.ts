import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SkillsProposalInspectResultSchema } from "./agents-models-skills.js";

describe("Skill Workshop routing provenance boundary", () => {
  it("rejects internal routingDescription on a public proposal record", () => {
    const record = {
      schema: "openclaw.skill-workshop.proposal.v1",
      id: "proposal-routing-boundary",
      kind: "update",
      status: "pending",
      title: "Update routing boundary",
      description: "Update the implementation body",
      routingDescription: "Route this skill for durable scheduling and recovery workflows.",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
      createdBy: "gateway",
      proposedVersion: "v1",
      draftFile: "PROPOSAL.md",
      draftHash: "a".repeat(64),
      target: {
        skillName: "routing-boundary",
        skillKey: "routing-boundary",
        skillDir: "/tmp/workspace/skills/routing-boundary",
        skillFile: "/tmp/workspace/skills/routing-boundary/SKILL.md",
      },
      scan: {
        state: "clean",
        scannedAt: "2026-08-18T00:00:00.000Z",
        critical: 0,
        warn: 0,
        info: 0,
        findings: [],
      },
    };

    expect(
      Value.Check(SkillsProposalInspectResultSchema, {
        record,
        revisionHash: "b".repeat(64),
        content: "# Routing Boundary\n",
      }),
    ).toBe(false);
  });
});
