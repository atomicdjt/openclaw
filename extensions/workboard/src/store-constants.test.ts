import { describe, expect, it } from "vitest";
import { workboardCardConsumesOwnerSlot } from "./store-constants.js";

const now = 10_000;

describe("workboardCardConsumesOwnerSlot", () => {
  it("does not let a completed legacy card with a running execution occupy its owner's slot", () => {
    const completed = {
      status: "done",
      agentId: "worker",
      execution: { status: "running" },
    } as const;

    expect(workboardCardConsumesOwnerSlot(completed, now)).toBe(false);
  });

  it.each(["ready", "review", "blocked"] as const)(
    "continues to protect a nonterminal %s card with a running execution",
    (status) => {
      expect(
        workboardCardConsumesOwnerSlot(
          { status, agentId: "worker", execution: { status: "running" } },
          now,
        ),
      ).toBe(true);
    },
  );

  it("still reserves an actively running card's slot", () => {
    expect(
      workboardCardConsumesOwnerSlot({ status: "running", agentId: "worker" }, now),
    ).toBe(true);
  });

  it("does not reserve a ready card without a claim or execution", () => {
    expect(workboardCardConsumesOwnerSlot({ status: "ready", agentId: "worker" }, now)).toBe(
      false,
    );
  });
});
