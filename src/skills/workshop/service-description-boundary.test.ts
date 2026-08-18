import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../test-utils/openclaw-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { parseSkillFrontmatter } from "../loading/frontmatter.js";
import { writeSkill } from "../test-support/e2e-test-helpers.js";
import { applySkillProposal, proposeUpdateSkill, reviseSkillProposal } from "./service.js";
import { hashSkillProposalContent, replaceSkillProposalDraft } from "./store.js";
import type { SkillProposalReadResult, SkillProposalRecord } from "./types.js";

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

async function rewriteAsLegacyPendingUpdate(params: {
  proposal: SkillProposalReadResult;
  liveDescription: string;
  proposalSummary: string;
}): Promise<void> {
  const legacyContent = params.proposal.content.replace(
    `description: ${JSON.stringify(params.liveDescription)}`,
    `description: ${JSON.stringify(params.proposalSummary)}`,
  );
  expect(legacyContent).not.toBe(params.proposal.content);
  const legacyRecord = {
    ...params.proposal.record,
    draftHash: hashSkillProposalContent(legacyContent),
  } as SkillProposalRecord & { routingDescription?: string };
  delete legacyRecord.routingDescription;
  await replaceSkillProposalDraft({
    record: legacyRecord,
    content: legacyContent,
  });
}

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
    expect(proposal.record.routingDescription).toBe(liveDescription);
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
    expect(revised.record.routingDescription).toBe(liveDescription);
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
    expect(replacement.record.routingDescription).toBe(replacementDescription);
    expect(replacement.content).toContain(`description: ${JSON.stringify(replacementDescription)}`);
    expect(replacement.content).not.toContain(`description: ${JSON.stringify(replacementSummary)}`);

    await applySkillProposal({
      workspaceDir,
      proposalId: replacement.record.id,
      expectedRevisionHash: replacement.revisionHash,
    });
    await expect(fs.readFile(activeSkillFile, "utf8")).resolves.toContain(
      `description: ${JSON.stringify(replacementDescription)}`,
    );
  });

  it("requires a legacy pending update to be redrafted before revision", async () => {
    const workspaceDir = await tempDirs.make("openclaw-skill-description-legacy-revise-");
    const skillDir = path.join(workspaceDir, "skills", "legacy-revise");
    const liveDescription = "Route legacy-revise for durable scheduling and recovery workflows.";
    const proposalSummary = "Adjust one legacy behavior.";
    await writeSkill({
      dir: skillDir,
      name: "legacy-revise",
      description: liveDescription,
      body: "# Legacy Revise\n\nExisting behavior.\n",
    });
    const proposal = await proposeUpdateSkill({
      workspaceDir,
      skillName: "legacy-revise",
      description: proposalSummary,
      content: "# Legacy Revise\n\nUpdated behavior.\n",
    });
    await rewriteAsLegacyPendingUpdate({ proposal, liveDescription, proposalSummary });

    await expect(
      reviseSkillProposal({
        workspaceDir,
        proposalId: proposal.record.id,
        description: "Revise the legacy proposal summary.",
      }),
    ).rejects.toThrow(/redraft/i);
  });

  it("requires a legacy pending update to be redrafted before apply", async () => {
    const workspaceDir = await tempDirs.make("openclaw-skill-description-legacy-apply-");
    const skillDir = path.join(workspaceDir, "skills", "legacy-apply");
    const activeSkillFile = path.join(skillDir, "SKILL.md");
    const liveDescription = "Route legacy-apply for durable scheduling and recovery workflows.";
    const proposalSummary = "Adjust one legacy behavior.";
    await writeSkill({
      dir: skillDir,
      name: "legacy-apply",
      description: liveDescription,
      body: "# Legacy Apply\n\nExisting behavior.\n",
    });
    const proposal = await proposeUpdateSkill({
      workspaceDir,
      skillName: "legacy-apply",
      description: proposalSummary,
      content: "# Legacy Apply\n\nUpdated behavior.\n",
    });
    await rewriteAsLegacyPendingUpdate({ proposal, liveDescription, proposalSummary });

    await expect(
      applySkillProposal({
        workspaceDir,
        proposalId: proposal.record.id,
      }),
    ).rejects.toThrow(/redraft/i);
    const unchangedSkill = await fs.readFile(activeSkillFile, "utf8");
    expect(parseSkillFrontmatter(unchangedSkill).description).toBe(liveDescription);
  });
});
