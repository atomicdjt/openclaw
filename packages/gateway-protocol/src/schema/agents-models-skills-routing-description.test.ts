import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SkillsProposalInspectResultSchema } from "./agents-models-skills.js";

function proposalRecord() {
  return {
    schema: "openclaw.skill-workshop.proposal.v1",
    id: "proposal-routing-1",
    kind: "update",
    status: "pending",
    title: "Update cron guard",
    description: "Correct dead-man secret storage path",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    createdBy: "gateway",
    proposedVersion: "v1",
    draftFile: "PROPOSAL.md",
    draftHash: "a".repeat(64),
    target: {
      skillName: "cron-guard",
      skillKey: "cron-guard",
      skillDir: "/tmp/workspace/skills/cron-guard",
      skillFile: "/tmp/workspace/skills/cron-guard/SKILL.md",
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
}

describe("Skill Workshop routing description protocol", () => {
  it("keeps internal routingDescription out of public proposal records", () => {
    const baseResult = {
      record: proposalRecord(),
      revisionHash: "b".repeat(64),
      content: "# Cron Guard\n",
    };

    expect(Value.Check(SkillsProposalInspectResultSchema, baseResult)).toBe(true);
    expect(
      Value.Check(SkillsProposalInspectResultSchema, {
        ...baseResult,
        record: {
          ...baseResult.record,
          routingDescription:
            "Route cron-guard for cron safety, dry-run planning, alerts, digest review, rollback, and recovery workflows.",
        },
      }),
    ).toBe(false);
  });
});
