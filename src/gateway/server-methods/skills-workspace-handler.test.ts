import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  resolveSkillsAgentWorkspace,
  runSkillsProposalWorkspaceHandler,
} from "./skills-workspace-handler.js";
import type { GatewayRequestContext } from "./types.js";

function context(config: OpenClawConfig): GatewayRequestContext {
  return { getRuntimeConfig: () => config } as GatewayRequestContext;
}

describe("resolveSkillsAgentWorkspace", () => {
  const config: OpenClawConfig = {
    agents: {
      ownership: "explicit",
      list: [{ id: "ops" }, { id: "research" }],
    },
  };

  it("returns typed selection-required when an explicit fleet omits agentId", () => {
    const result = resolveSkillsAgentWorkspace({}, context(config));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST", message: expect.stringContaining("agent") },
    });
  });

  it("uses the explicitly selected agent workspace", () => {
    const result = resolveSkillsAgentWorkspace({ agentId: "research" }, context(config));

    expect(result).toMatchObject({ ok: true, agentId: "research" });
  });
});

describe("Skill Workshop Gateway response projection", () => {
  it("removes routing provenance from proposal responses without mutating input", async () => {
    const config: OpenClawConfig = {
      agents: {
        ownership: "explicit",
        list: [{ id: "ops" }],
      },
    };
    const input = {
      record: {
        schema: "openclaw.skill-workshop.proposal.v1",
        id: "proposal-routing-1",
        description: "Correct dead-man secret storage path",
        routingDescription: "Route cron-guard for scheduling and recovery workflows.",
      },
      nested: [
        {
          schema: "openclaw.skill-workshop.proposal.v1",
          id: "proposal-routing-2",
          routingDescription: "Route another skill for durable recovery workflows.",
        },
      ],
      unrelated: {
        schema: "other.v1",
        routingDescription: "This unrelated field is not proposal provenance.",
      },
    };
    let projected: unknown;

    await runSkillsProposalWorkspaceHandler({
      method: "skills.proposals.inspect",
      rawParams: { agentId: "ops" },
      respond: (ok, result, error) => {
        expect(ok).toBe(true);
        expect(error).toBeUndefined();
        projected = result;
      },
      context: context(config),
      validate: (params: unknown): params is { agentId: string } =>
        Boolean(params && typeof params === "object" && "agentId" in params),
      run: async () => input,
    });

    expect(projected).toEqual({
      record: {
        schema: "openclaw.skill-workshop.proposal.v1",
        id: "proposal-routing-1",
        description: "Correct dead-man secret storage path",
      },
      nested: [
        {
          schema: "openclaw.skill-workshop.proposal.v1",
          id: "proposal-routing-2",
        },
      ],
      unrelated: {
        schema: "other.v1",
        routingDescription: "This unrelated field is not proposal provenance.",
      },
    });
    expect(input.record.routingDescription).toBe(
      "Route cron-guard for scheduling and recovery workflows.",
    );
  });
});
