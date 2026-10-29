import { it, expect, vi, afterEach } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({
    notionApiKey: "unit",
    notionDataSourceId: "source",
  }),
}));
vi.mock("@notionhq/client", () => ({
  Client: class {
    dataSources = { query };
  },
}));
import { listMembers } from "@/lib/notion";
afterEach(() => vi.resetAllMocks());
it("rejects missing pagination cursor rather than treating partial enumeration as complete", async () => {
  query.mockResolvedValue({ results: [], has_more: true, next_cursor: null });
  await expect(listMembers()).rejects.toThrow("pagination");
});
it("rejects repeated cursors", async () => {
  query
    .mockResolvedValueOnce({ results: [], has_more: true, next_cursor: "same" })
    .mockResolvedValueOnce({ results: [], has_more: true, next_cursor: "same" })
    .mockRejectedValue(new Error("test runaway guard"));
  await expect(listMembers()).rejects.toThrow("pagination");
});
