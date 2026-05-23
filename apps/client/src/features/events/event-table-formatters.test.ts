import type { EventOccurrence } from "@web-scada/shared";
import { describe, expect, it } from "vitest";
import { getEventCellText } from "./event-table-formatters";

function makeOccurrence(patch: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: "occ_1",
    eventDefinitionId: "evt_1",
    occurredAt: "2026-05-24T10:00:00.000Z",
    state: "active",
    ...patch,
  };
}

describe("event-table-formatters ack column", () => {
  it("returns only acknowledge datetime without acknowledgedBy text", () => {
    const item = makeOccurrence({
      acknowledgedAt: "2026-05-24T10:04:07.000Z",
      acknowledgedBy: "8727a5f2-a79e-4aee-a9c7-441d81b890cb",
    });
    const cellText = getEventCellText("ack", item);
    expect(cellText).toContain("24.05.2026");
    expect(cellText).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(cellText).not.toContain("8727a5f2-a79e-4aee-a9c7-441d81b890cb");
    expect(cellText).not.toContain("|");
  });
});
