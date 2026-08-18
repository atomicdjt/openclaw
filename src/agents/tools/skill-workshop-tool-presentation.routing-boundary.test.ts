import { describe, expect, it } from "vitest";
import type { SkillProposalReadResult } from "../../skills/workshop/types.js";
import { formatProposalInspect } from "./skill-workshop-tool-presentation.js";

describe("Skill Workshop inspect routing boundary", () => {
  it("bounds model-facing proposal inspection text", () => {
    const proposal = {
      record: {
        id: "proposal-routing-boundary",
        status: "pending",
        kind: "update",
        proposedVersion: "v1",
        target: { skillKey: "routing-boundary" },
        scan: { state: "clean" },
      },
      content: `---\ndescription: ${JSON.stringify("route ".repeat(5_000))}\n---\n\n# Routing Boundary\n`,
    } as SkillProposalReadResult;

    const text = formatProposalInspect(proposal);

    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain("[truncated: proposal inspect exceeds the model projection limit]");
  });
});
