import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/config", () => ({ getRuntimeConfig: () => ({ notionApiKey: "test-only" }) }));
vi.mock("@notionhq/client", () => ({ Client: class { pages = mocks; } }));
import { updateMember } from "@/lib/notion";
describe("Notion reminder persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockRejectedValueOnce(new Error("missing property")).mockResolvedValue({});
    mocks.retrieve.mockResolvedValue({ properties: { Status: {type:"select"} } });
  });
  it("never reports success after dropping a missing reminder marker", async () => {
    await expect(updateMember("page", { status:"active_paid",renewalReminder3DaySentAt:"2026-10-28T00:00:00Z",renewalReminderDueAt:"2026-10-31T00:00:00Z" })).rejects.toThrow("missing property");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it("keeps backwards compatible filtering for unrelated optional properties", async () => {
    await updateMember("page", {status:"active_paid",lastBotMessage:"test"});
    expect(mocks.update).toHaveBeenLastCalledWith({page_id:"page",properties:{Status:{select:{name:"active_paid"}}}});
  });
});
