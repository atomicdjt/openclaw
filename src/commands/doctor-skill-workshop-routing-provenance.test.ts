import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderProposalMarkdown } from "../skills/workshop/frontmatter.js";
import {
  applySkillProposal,
  inspectSkillProposal,
  listSkillProposals,
  reviseSkillProposal,
} from "../skills/workshop/service.js";
import {
  hashSkillProposalContent,
  readSkillProposalRecord,
  readSkillProposalRollback,
  writeSkillProposal,
} from "../skills/workshop/store.js";
import { writeSkillProposalRollback } from "../skills/workshop/store-sqlite-rollback.js";
import {
  SKILL_WORKSHOP_ROLLBACK_SCHEMA,
  SKILL_WORKSHOP_SCHEMA,
  type SkillProposalRecord,
  type SkillProposalRollback,
} from "../skills/workshop/types.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../test-utils/openclaw-test-state.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { migrateLegacySkillWorkshopProposals } from "./doctor-skill-workshop-sqlite.js";

const LEGACY_UPDATE_REDRAFT_REASON =
  "This pending skill update predates routing-description provenance. Redraft the update before revising or applying it.";

const tempDirs = createTrackedTempDirs();
let testState: OpenClawTestState;

beforeEach(async () => {
  testState = await createOpenClawTestState({
    layout: "state-only",
    prefix: "openclaw-doctor-workshop-routing-provenance-",
  });
});

afterEach(async () => {
  await testState.cleanup();
  await tempDirs.cleanup();
});

function legacyPendingUpdate(params: {
  proposalId: string;
  targetDir: string;
  content: string;
  description: string;
  now: string;
  currentContentHash?: string;
}): SkillProposalRecord {
  return {
    schema: SKILL_WORKSHOP_SCHEMA,
    id: params.proposalId,
    kind: "update",
    status: "pending",
    title: `Update ${path.basename(params.targetDir)}`,
    description: params.description,
    createdAt: params.now,
    updatedAt: params.now,
    createdBy: "skill-workshop",
    origin: {
      agentId: "main",
      sessionKey: `agent:main:${path.basename(params.targetDir)}`,
      runId: `${path.basename(params.targetDir)}-run`,
    },
    originRunIds: [`${path.basename(params.targetDir)}-run`],
    originRunMutationCounts: { [`${path.basename(params.targetDir)}-run`]: 1 },
    proposedVersion: "v1",
    draftFile: "PROPOSAL.md",
    draftHash: hashSkillProposalContent(params.content),
    target: {
      skillName: path.basename(params.targetDir),
      skillKey: path.basename(params.targetDir),
      skillDir: params.targetDir,
      skillFile: path.join(params.targetDir, "SKILL.md"),
      source: "openclaw-workspace",
      ...(params.currentContentHash ? { currentContentHash: params.currentContentHash } : {}),
    },
    scan: {
      state: "clean",
      scannedAt: params.now,
      critical: 0,
      warn: 0,
      info: 0,
      findings: [],
    },
  };
}

function doctorConfig(workspaceDir: string) {
  return {
    agents: {
      entries: {
        main: { default: true, workspace: workspaceDir },
      },
    },
  };
}

describe("doctor Skill Workshop routing provenance migration", () => {
  it("marks legacy pending update proposals stale and requires a redraft", async () => {
    const workspaceDir = await tempDirs.make("openclaw-workshop-legacy-routing-");
    const proposalId = "legacy-routing-update-20260818-1234567890";
    const proposalDir = path.join(
      testState.stateDir,
      "skill-workshop",
      "proposals",
      proposalId,
    );
    const targetDir = path.join(workspaceDir, "skills", "legacy-routing-update");
    const now = "2026-08-18T00:00:00.000Z";
    const content = renderProposalMarkdown({
      name: "legacy-routing-update",
      description: "Adjust legacy update behavior",
      content: "# Legacy Routing Update\n\nPending update body.\n",
      date: now,
    });
    const record = legacyPendingUpdate({
      proposalId,
      targetDir,
      content,
      description: "Adjust legacy update behavior",
      now,
    });

    await fs.mkdir(proposalDir, { recursive: true });
    await fs.writeFile(
      path.join(proposalDir, "proposal.json"),
      JSON.stringify(record),
      "utf8",
    );
    await fs.writeFile(path.join(proposalDir, "PROPOSAL.md"), content, "utf8");

    await expect(
      migrateLegacySkillWorkshopProposals({ config: doctorConfig(workspaceDir) }),
    ).resolves.toMatchObject({ detected: 1, migrated: 1, warnings: [] });

    const inspected = await inspectSkillProposal(proposalId, {
      agentId: "main",
      workspaceDir,
    });
    if (!inspected) {
      throw new Error(`Expected migrated proposal: ${proposalId}`);
    }
    expect(inspected.record).toMatchObject({
      id: proposalId,
      kind: "update",
      status: "stale",
      statusReason: LEGACY_UPDATE_REDRAFT_REASON,
      staleAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(inspected.record.updatedAt).toBe(inspected.record.staleAt);

    await expect(listSkillProposals({ agentId: "main", workspaceDir })).resolves.toMatchObject({
      proposals: [expect.objectContaining({ id: proposalId, status: "stale" })],
    });

    await expect(
      reviseSkillProposal({
        workspaceDir,
        agentId: "main",
        proposalId,
        content: "# Legacy Routing Update\n\nAttempted revision.\n",
      }),
    ).rejects.toThrow("Current status: stale");
    await expect(
      applySkillProposal({ workspaceDir, agentId: "main", proposalId }),
    ).rejects.toThrow("Current status: stale");
  });

  it("reconciles an interrupted legacy update before marking it stale", async () => {
    const workspaceDir = await tempDirs.make("openclaw-workshop-legacy-routing-recovery-");
    const proposalId = "legacy-routing-recovery-20260818-1234567890";
    const proposalDir = path.join(
      testState.stateDir,
      "skill-workshop",
      "proposals",
      proposalId,
    );
    const targetDir = path.join(workspaceDir, "skills", "legacy-routing-recovery");
    const targetSkillFile = path.join(targetDir, "SKILL.md");
    const now = "2026-08-18T00:00:00.000Z";
    const previousContent =
      "---\nname: legacy-routing-recovery\ndescription: Preserve this live routing description\n---\n\n# Legacy Routing Recovery\n\nOriginal live body.\n";
    const content = renderProposalMarkdown({
      name: "legacy-routing-recovery",
      description: "Adjust recovery behavior",
      content: "# Legacy Routing Recovery\n\nProposed update body.\n",
      date: now,
    });
    const record = legacyPendingUpdate({
      proposalId,
      targetDir,
      content,
      description: "Adjust recovery behavior",
      now,
      currentContentHash: hashSkillProposalContent(previousContent),
    });
    const rollback: SkillProposalRollback = {
      schema: SKILL_WORKSHOP_ROLLBACK_SCHEMA,
      proposalId,
      writtenAt: now,
      targetSkillFile,
      action: "update",
      previousContentHash: hashSkillProposalContent(previousContent),
      previousContent,
    };

    await fs.mkdir(proposalDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetSkillFile, previousContent, "utf8");
    await fs.writeFile(
      path.join(proposalDir, "proposal.json"),
      JSON.stringify(record),
      "utf8",
    );
    await fs.writeFile(path.join(proposalDir, "PROPOSAL.md"), content, "utf8");
    await fs.writeFile(
      path.join(proposalDir, "rollback.json"),
      JSON.stringify(rollback),
      "utf8",
    );

    await expect(
      migrateLegacySkillWorkshopProposals({ config: doctorConfig(workspaceDir) }),
    ).resolves.toMatchObject({ detected: 1, migrated: 1, warnings: [] });

    await expect(readSkillProposalRollback(proposalId)).resolves.toBeNull();
    await expect(fs.readFile(targetSkillFile, "utf8")).resolves.toBe(previousContent);

    const inspected = await inspectSkillProposal(proposalId, {
      agentId: "main",
      workspaceDir,
    });
    if (!inspected) {
      throw new Error(`Expected migrated proposal: ${proposalId}`);
    }
    expect(inspected.record).toMatchObject({
      id: proposalId,
      status: "stale",
      statusReason: LEGACY_UPDATE_REDRAFT_REASON,
      staleAt: expect.any(String),
    });
  });

  it("normalizes pending legacy updates already stored in SQLite", async () => {
    const workspaceDir = await tempDirs.make("openclaw-workshop-sqlite-routing-");
    const proposalId = "sqlite-routing-update-20260818-1234567890";
    const targetDir = path.join(workspaceDir, "skills", "sqlite-routing-update");
    const targetSkillFile = path.join(targetDir, "SKILL.md");
    const now = "2026-08-18T00:00:00.000Z";
    const liveContent =
      "---\nname: sqlite-routing-update\ndescription: Preserve this live routing description\n---\n\n# SQLite Routing Update\n\nOriginal live body.\n";
    const content = renderProposalMarkdown({
      name: "sqlite-routing-update",
      description: "Adjust persisted SQLite update behavior",
      content: "# SQLite Routing Update\n\nProposed update body.\n",
      date: now,
    });
    const record = legacyPendingUpdate({
      proposalId,
      targetDir,
      content,
      description: "Adjust persisted SQLite update behavior",
      now,
      currentContentHash: hashSkillProposalContent(liveContent),
    });

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetSkillFile, liveContent, "utf8");
    await writeSkillProposal({
      record,
      content,
      workspaceDir,
      ownerAgentId: "main",
      maxPending: 10,
      store: { env: testState.env },
    });

    await expect(
      inspectSkillProposal(proposalId, {
        agentId: "main",
        workspaceDir,
        env: testState.env,
      }),
    ).resolves.toMatchObject({ record: { id: proposalId, status: "pending" } });

    await expect(
      migrateLegacySkillWorkshopProposals({
        config: doctorConfig(workspaceDir),
        env: testState.env,
      }),
    ).resolves.toMatchObject({ warnings: [] });

    const inspected = await inspectSkillProposal(proposalId, {
      agentId: "main",
      workspaceDir,
      env: testState.env,
    });
    if (!inspected) {
      throw new Error(`Expected stored proposal: ${proposalId}`);
    }
    expect(inspected.record).toMatchObject({
      id: proposalId,
      kind: "update",
      status: "stale",
      statusReason: LEGACY_UPDATE_REDRAFT_REASON,
      staleAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(inspected.record.updatedAt).toBe(inspected.record.staleAt);
    await expect(fs.readFile(targetSkillFile, "utf8")).resolves.toBe(liveContent);
  });

  it("reconciles rollback facts for pending legacy updates already stored in SQLite", async () => {
    const workspaceDir = await tempDirs.make("openclaw-workshop-sqlite-routing-recovery-");
    const proposalId = "sqlite-routing-recovery-20260818-1234567890";
    const targetDir = path.join(workspaceDir, "skills", "sqlite-routing-recovery");
    const targetSkillFile = path.join(targetDir, "SKILL.md");
    const now = "2026-08-18T00:00:00.000Z";
    const liveContent =
      "---\nname: sqlite-routing-recovery\ndescription: Preserve stored SQLite routing\n---\n\n# SQLite Routing Recovery\n\nOriginal live body.\n";
    const content = renderProposalMarkdown({
      name: "sqlite-routing-recovery",
      description: "Recover persisted SQLite update",
      content: "# SQLite Routing Recovery\n\nProposed update body.\n",
      date: now,
    });
    const record = legacyPendingUpdate({
      proposalId,
      targetDir,
      content,
      description: "Recover persisted SQLite update",
      now,
      currentContentHash: hashSkillProposalContent(liveContent),
    });
    const rollback: SkillProposalRollback = {
      schema: SKILL_WORKSHOP_ROLLBACK_SCHEMA,
      proposalId,
      writtenAt: now,
      targetSkillFile,
      action: "update",
      previousContentHash: hashSkillProposalContent(liveContent),
      previousContent: liveContent,
    };

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetSkillFile, liveContent, "utf8");
    await writeSkillProposal({
      record,
      content,
      workspaceDir,
      ownerAgentId: "main",
      maxPending: 10,
      store: { env: testState.env },
    });
    await writeSkillProposalRollback({
      proposalId,
      rollback,
      store: { env: testState.env },
    });

    await expect(readSkillProposalRollback(proposalId, { env: testState.env })).resolves.toMatchObject(
      rollback,
    );

    await expect(
      migrateLegacySkillWorkshopProposals({
        config: doctorConfig(workspaceDir),
        env: testState.env,
      }),
    ).resolves.toMatchObject({ warnings: [] });

    await expect(readSkillProposalRollback(proposalId, { env: testState.env })).resolves.toBeNull();
    await expect(fs.readFile(targetSkillFile, "utf8")).resolves.toBe(liveContent);
    await expect(
      readSkillProposalRecord(proposalId, { env: testState.env }, {}, { reconcile: false }),
    ).resolves.toMatchObject({
      id: proposalId,
      status: "stale",
      statusReason: LEGACY_UPDATE_REDRAFT_REASON,
    });
  });

  it("warns and preserves a stored legacy update when its draft is missing", async () => {
    const workspaceDir = await tempDirs.make("openclaw-workshop-sqlite-routing-missing-draft-");
    const proposalId = "sqlite-routing-missing-draft-20260818-1234567890";
    const targetDir = path.join(workspaceDir, "skills", "sqlite-routing-missing-draft");
    const now = "2026-08-18T00:00:00.000Z";
    const content = renderProposalMarkdown({
      name: "sqlite-routing-missing-draft",
      description: "Preserve degraded persisted state",
      content: "# SQLite Routing Missing Draft\n\nProposed update body.\n",
      date: now,
    });
    const record = legacyPendingUpdate({
      proposalId,
      targetDir,
      content,
      description: "Preserve degraded persisted state",
      now,
    });

    await writeSkillProposal({
      record,
      content,
      workspaceDir,
      ownerAgentId: "main",
      maxPending: 10,
      store: { env: testState.env },
    });
    await fs.rm(path.join(testState.stateDir, "skill-workshop", "proposals"), {
      recursive: true,
      force: true,
    });

    const result = await migrateLegacySkillWorkshopProposals({
      config: doctorConfig(workspaceDir),
      env: testState.env,
    });
    expect(result.warnings).toEqual([
      expect.stringContaining(`Failed to normalize stored Skill Workshop proposal ${proposalId}`),
    ]);

    await expect(
      readSkillProposalRecord(proposalId, { env: testState.env }, {}, { reconcile: false }),
    ).resolves.toMatchObject({
      id: proposalId,
      kind: "update",
      status: "pending",
    });
  });
});
