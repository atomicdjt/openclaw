import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../test-utils/openclaw-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { writeSkill } from "../test-support/e2e-test-helpers.js";
import {
  applySkillProposal,
  proposeUpdateSkill,
  reviseSkillProposal,
} from "./service.js";

const tempDirs = createTrackedTempDirs();
let testState: OpenClawTestState;

beforeEach(async () => {
  testState = await createOpenClawTestState({
    layout: "state-only",
    prefix: "openclaw-skill-description-boundary-state-",
  });
});

afterEach(async () => {
  await testState.cleanup();
  await tempDirs.cleanup();
});

describe("Skill Workshop update description boundary", () => {
  it("keeps proposal summaries separate from applied skill routing descriptions", async () => {
    const workspaceDir = await tempDirs.make("openclaw-skill-description-boundary-");
    const skillDir = path.join(workspaceDir, "skills", "cron-guard");
    const liveDescription =
      "Route this skill for cron safety, dry-run planning, alerts, digest review, rollback, and recovery " +
      "when operators need a durable workflow without changing the capability routing contract.";
    const proposalSummary = "Correct dead-man secret storage path.";

    expect(Buffer.byteLength(liveDescription, "utf8")).toBeGreaterThan(160);
    await writeSkill({
      dir: skillDir,
      name: "cron-guard",
      description: liveDescription,
      body: "# Cron Guard\n\nExisting behavior.\n",
    });

    const proposal = await proposeUpdateSkill({
      workspaceDir,
      skillName: "cron-guard",
      description: proposalSummary,
      content: "# Cron Guard\n\nUpdated behavior.\n",
    });

    expect(proposal.record.description).toBe(proposalSummary);
    expect(proposal.content).toContain(`description: ${JSON.stringify(liveDescription)}`);
    expect(proposal.content).not.toContain(`description: ${JSON.stringify(proposalSummary)}`);

    const revisedSummary = "Document the dead-man storage correction.";
    const revised = await reviseSkillProposal({
      workspaceDir,
      proposalId: proposal.record.id,
      expectedRevisionHash: proposal.revisionHash,
      description: revisedSummary,
    });

    expect(revised.record.description).toBe(revisedSummary);
    expect(revised.content).toContain(`description: ${JSON.stringify(liveDescription)}`);
    expect(revised.content).not.toContain(`description: ${JSON.stringify(revisedSummary)}`);

    await applySkillProposal({
      workspaceDir,
      proposalId: revised.record.id,
      expectedRevisionHash: revised.revisionHash,
    });

    const activeSkillFile = path.join(skillDir, "SKILL.md");
    await expect(fs.readFile(activeSkillFile, "utf8")).resolves.toContain(
      `description: ${JSON.stringify(liveDescription)}`,
    );

    const replacementDescription =
      "Route this skill when operators ask to inspect, repair, or verify cron safety workflows.";
    const replacementSummary = "Clarify cron routing triggers.";
    const replacement = await proposeUpdateSkill({
      workspaceDir,
      skillName: "cron-guard",
      description: replacementSummary,
      content: `---
name: cron-guard
description: ${JSON.stringify(replacementDescription)}
---

# Cron Guard

Final behavior.
`,
    });

    expect(replacement.record.description).toBe(replacementSummary);
    expect(replacement.content).toContain(
      `description: ${JSON.stringify(replacementDescription)}`,
    );
    expect(replacement.content).not.toContain(
      `description: ${JSON.stringify(replacementSummary)}`,
    );

    await applySkillProposal({
      workspaceDir,
      proposalId: replacement.record.id,
      expectedRevisionHash: replacement.revisionHash,
    });
    await expect(fs.readFile(activeSkillFile, "utf8")).resolves.toContain(
      `description: ${JSON.stringify(replacementDescription)}`,
    );
  });
});
