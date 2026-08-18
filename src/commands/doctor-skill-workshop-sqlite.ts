/** Doctor-owned migration of Skill Workshop proposal metadata into shared SQLite. */
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isMissingPathError } from "../infra/errors.js";
import { removePathWithinRoot } from "../infra/fs-safe-remove.js";
import { pathExists, root, type Root } from "../infra/fs-safe.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { LEGACY_UPDATE_REDRAFT_MESSAGE } from "../skills/workshop/routing-description-provenance.js";
import {
  hashSkillProposalContent,
  importLegacySkillProposal,
  readSkillProposal,
  readSkillProposalRecord,
  readSkillProposalRollback,
  updateSkillProposalRecord,
  validateSkillProposalRecord,
  validateSkillProposalRollback,
} from "../skills/workshop/store.js";
import { listStoredProposalRecords } from "../skills/workshop/store-sqlite-record.js";
import type { SkillProposalRecord, SkillProposalRollback } from "../skills/workshop/types.js";

const WORKSHOP_DIR = "skill-workshop";
const PROPOSALS_DIR = `${WORKSHOP_DIR}/proposals`;
const MANIFEST_PATH = `${WORKSHOP_DIR}/proposals.json`;
const MAX_RECORD_BYTES = 1024 * 1024;
// Legacy rollback JSON can expand control characters sixfold across 1 MiB of
// SKILL.md plus 64 existing 256 KiB support targets.
const MAX_ROLLBACK_BYTES = 128 * 1024 * 1024;
const PROPOSAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{5,120}$/;

type MigrationResult = {
  changes: string[];
  warnings: string[];
  detected: number;
  migrated: number;
};

async function readJson(rootDir: Root, relativePath: string, maxBytes: number): Promise<unknown> {
  const read = await rootDir.read(relativePath, {
    hardlinks: "reject",
    maxBytes,
    symlinks: "reject",
  });
  return JSON.parse(read.buffer.toString("utf8")) as unknown;
}

function proposalWorkspace(record: SkillProposalRecord): string {
  return path.dirname(path.dirname(path.resolve(record.target.skillDir)));
}

function configuredAgentIds(config: OpenClawConfig): string[] {
  return listAgentIds(config);
}

function inferOwnerAgentId(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  record: SkillProposalRecord;
  workspaceDir: string;
}): string | undefined {
  if (params.record.origin?.agentId) {
    return normalizeAgentId(params.record.origin.agentId);
  }
  if (params.record.origin?.sessionKey) {
    const sessionAgentId = parseAgentSessionKey(params.record.origin.sessionKey)?.agentId;
    if (sessionAgentId) {
      return normalizeAgentId(sessionAgentId);
    }
  }
  const agentIds = configuredAgentIds(params.config);
  const workspaceMatches = agentIds.filter(
    (agentId) =>
      path.resolve(resolveAgentWorkspaceDir(params.config, agentId, params.env)) ===
      path.resolve(params.workspaceDir),
  );
  if (workspaceMatches.length === 1) {
    return workspaceMatches[0];
  }
  return agentIds.length === 1 ? agentIds[0] : undefined;
}

async function readLegacyRollback(
  stateRoot: Root,
  proposalId: string,
): Promise<SkillProposalRollback | undefined> {
  try {
    const rollback = validateSkillProposalRollback(
      await readJson(stateRoot, `${PROPOSALS_DIR}/${proposalId}/rollback.json`, MAX_ROLLBACK_BYTES),
    );
    if (!rollback.ok) {
      throw new Error(rollback.error.message);
    }
    if (rollback.value.proposalId !== proposalId) {
      throw new Error("invalid rollback metadata");
    }
    return rollback.value;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function verifyImportedProposal(params: {
  env: NodeJS.ProcessEnv;
  record: SkillProposalRecord;
  rollback?: SkillProposalRollback;
}): Promise<void> {
  const imported = (
    await readSkillProposal(params.record.id, { env: params.env }, {}, { reconcile: false })
  )?.record;
  if (
    !imported ||
    imported.draftHash !== params.record.draftHash ||
    imported.target.skillFile !== params.record.target.skillFile
  ) {
    throw new Error("SQLite verification failed");
  }
  if (
    params.rollback &&
    !(await readSkillProposalRollback(params.record.id, { env: params.env }))
  ) {
    throw new Error("SQLite rollback verification failed");
  }
}

function requiresLegacyUpdateRedraft(record: SkillProposalRecord): boolean {
  return (
    record.kind === "update" &&
    record.status === "pending" &&
    record.routingDescription === undefined
  );
}

async function normalizeLegacyUpdateProvenance(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  proposalId: string;
}): Promise<boolean> {
  // Inspect only persisted metadata first. Doctor can therefore identify the
  // compatibility case even when a draft is degraded or missing, without
  // reconciling unrelated records as a side effect of enumeration.
  const initial = await readSkillProposalRecord(
    params.proposalId,
    { env: params.env },
    {},
    { reconcile: false },
  );
  if (!initial) {
    throw new Error("SQLite verification failed before legacy update normalization");
  }
  if (!requiresLegacyUpdateRedraft(initial)) {
    return false;
  }

  // A targeted legacy update may have a rollback journal proving that its
  // target is still previous, fully proposed, or partially written. Reconcile
  // that interrupted apply before terminalizing it so recovery facts are not
  // stranded and a partially mutated live skill is never left behind.
  const recovered = await readSkillProposal(
    params.proposalId,
    { env: params.env },
    {},
    { config: params.config },
  );
  if (!recovered) {
    throw new Error("SQLite verification failed after legacy update recovery");
  }
  if (!requiresLegacyUpdateRedraft(recovered.record)) {
    return false;
  }
  if (await readSkillProposalRollback(params.proposalId, { env: params.env })) {
    throw new Error(
      "legacy update rollback could not be reconciled; persisted recovery evidence was retained for manual recovery",
    );
  }

  const now = new Date().toISOString();
  const stale: SkillProposalRecord = {
    ...recovered.record,
    status: "stale",
    updatedAt: now,
    staleAt: now,
    statusReason: LEGACY_UPDATE_REDRAFT_MESSAGE,
  };
  await updateSkillProposalRecord({
    record: stale,
    store: { env: params.env },
  });
  return true;
}

async function normalizeStoredLegacyUpdates(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): Promise<{ normalized: number; warnings: string[] }> {
  let records: SkillProposalRecord[];
  try {
    records = listStoredProposalRecords({ env: params.env });
  } catch (error) {
    return {
      normalized: 0,
      warnings: [`Failed to inspect stored Skill Workshop proposals: ${String(error)}`],
    };
  }

  let normalized = 0;
  const warnings: string[] = [];
  for (const record of records) {
    if (!requiresLegacyUpdateRedraft(record)) {
      continue;
    }
    try {
      if (
        await normalizeLegacyUpdateProvenance({
          config: params.config,
          env: params.env,
          proposalId: record.id,
        })
      ) {
        normalized += 1;
      }
    } catch (error) {
      warnings.push(
        `Failed to normalize stored Skill Workshop proposal ${record.id}: ${String(error)}`,
      );
    }
  }
  return { normalized, warnings };
}

async function migrateProposal(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  proposalId: string;
  stateRoot: Root;
}): Promise<"imported" | "already-imported"> {
  const proposalDir = `${PROPOSALS_DIR}/${params.proposalId}`;
  const record = validateSkillProposalRecord(
    await readJson(params.stateRoot, `${proposalDir}/proposal.json`, MAX_RECORD_BYTES),
  );
  if (!record.ok) {
    throw new Error(record.error.message);
  }
  if (record.value.id !== params.proposalId) {
    throw new Error("invalid proposal metadata");
  }
  const draft = await params.stateRoot.read(`${proposalDir}/PROPOSAL.md`, {
    hardlinks: "reject",
    maxBytes: MAX_RECORD_BYTES,
    symlinks: "reject",
  });
  if (hashSkillProposalContent(draft.buffer.toString("utf8")) !== record.value.draftHash) {
    throw new Error("proposal draft hash does not match proposal metadata");
  }
  const rollback = await readLegacyRollback(params.stateRoot, params.proposalId);
  const workspaceDir = proposalWorkspace(record.value);
  const ownerAgentId = inferOwnerAgentId({
    config: params.config,
    env: params.env,
    record: record.value,
    workspaceDir,
  });
  if (!ownerAgentId) {
    throw new Error(
      "owning agent could not be inferred; legacy metadata was retained for manual recovery",
    );
  }
  const result = importLegacySkillProposal({
    record: record.value,
    rollback,
    ownerAgentId,
    workspaceDir,
    store: { env: params.env },
  });
  await verifyImportedProposal({ env: params.env, record: record.value, rollback });
  if (rollback) {
    await params.stateRoot.remove(`${proposalDir}/rollback.json`);
  }
  await params.stateRoot.remove(`${proposalDir}/proposal.json`);
  return result;
}

/** Import legacy sidecars, then normalize every persisted update lacking provenance. */
export async function migrateLegacySkillWorkshopProposals(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<MigrationResult> {
  const env = params.env ?? process.env;
  const stateDir = resolveStateDir(env);
  const warnings: string[] = [];
  const changes: string[] = [];
  let proposalIds: string[] = [];
  let migrated = 0;

  const hadProposalDir = await pathExists(path.join(stateDir, PROPOSALS_DIR));
  if (hadProposalDir) {
    const stateRoot = await root(stateDir);
    try {
      const entries = await stateRoot.list(PROPOSALS_DIR, { withFileTypes: true });
      proposalIds = entries
        .filter((entry) => entry.isDirectory && PROPOSAL_ID_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .toSorted((left, right) => left.localeCompare(right));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "not-found") {
        warnings.push(`Failed to inspect legacy Skill Workshop proposals: ${String(error)}`);
      }
    }

    for (const proposalId of proposalIds) {
      try {
        await migrateProposal({
          config: params.config,
          env,
          proposalId,
          stateRoot,
        });
        migrated += 1;
      } catch (error) {
        if (isMissingPathError(error)) {
          const stored = await readSkillProposalRecord(proposalId, { env }, {}, { reconcile: false });
          if (stored) {
            // Healthy SQLite-backed proposals intentionally have no legacy
            // proposal.json. The SQLite-wide normalization pass below owns any
            // routing-provenance upgrade that record still needs.
            continue;
          }
        }
        warnings.push(`Failed to migrate Skill Workshop proposal ${proposalId}: ${String(error)}`);
      }
    }
  }

  const hadLegacyManifest = await pathExists(path.join(stateDir, MANIFEST_PATH));
  if (hadLegacyManifest) {
    await removePathWithinRoot({ rootDir: stateDir, relativePath: MANIFEST_PATH }).catch(
      (error: unknown) => {
        if (!isMissingPathError(error)) {
          warnings.push(`Failed to remove legacy Skill Workshop proposal index: ${String(error)}`);
        }
      },
    );
    if (!hadProposalDir) {
      changes.push("Removed the empty legacy Skill Workshop proposal index.");
    }
  }

  const normalized = await normalizeStoredLegacyUpdates({ config: params.config, env });
  warnings.push(...normalized.warnings);

  if (migrated > 0) {
    changes.push(
      `Migrated ${migrated} Skill Workshop proposal${migrated === 1 ? "" : "s"} into shared SQLite.`,
    );
  }
  if (normalized.normalized > 0) {
    changes.push(
      `Marked ${normalized.normalized} stored legacy Skill Workshop update proposal${normalized.normalized === 1 ? "" : "s"} stale for redraft.`,
    );
  }

  return {
    changes,
    warnings,
    detected: proposalIds.length,
    migrated,
  };
}
