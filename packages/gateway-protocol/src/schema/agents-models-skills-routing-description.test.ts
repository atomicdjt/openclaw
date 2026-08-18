import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SkillsProposalInspectResultSchema } from "./agents-models-skills.js";

function buildRecord(routingDescription: string) {
  return {
    schema: "openclaw.skill-workshop.proposal.v1",
    id: "proposal-routing-1",
    kind: "update",
    status: "pending",
    title: "Update cron guard",
    description: "Correct dead-man secret storage path",
    routingDescription,
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
  it("accepts routingDescription on returned update proposal records", () => {
    const record = buildRecord(
      "Route cron-guard for cron safety, dry-run planning, alerts, digest review, rollback, and recovery workflows.",
    );

    expect(
      Value.Check(SkillsProposalInspectResultSchema, {
        record,
        revisionHash: "b".repeat(64),
        content: "# Cron Guard\n",
      }),
    ).toBe(true);
  });

  it("bounds routingDescription in the public proposal record schema", () => {
    const check = (routingDescription: string) =>
      Value.Check(SkillsProposalInspectResultSchema, {
        record: buildRecord(routingDescription),
        revisionHash: "b".repeat(64),
        content: "# Cron Guard\n",
      });

    expect(check("r".repeat(4_000))).toBe(true);
    expect(check("r".repeat(4_001))).toBe(false);
  });
});