import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v2Statuses } from "@/lib/membership-v2";

const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), update: vi.fn() }));
vi.mock("@notionhq/client", () => ({
  Client: class { dataSources = mocks; },
}));

async function preview(properties: Record<string, unknown>) {
  mocks.retrieve.mockResolvedValue({ properties });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  // A variable path keeps this CLI-only .mjs out of TypeScript's declaration resolution.
  const script = "../scripts/ensure-notion-schema.mjs";
  await import(script);
  const output = log.mock.calls.find(([value]) => typeof value === "string" && value.startsWith("{"));
  expect(output).toBeDefined();
  return JSON.parse(output![0] as string);
}

describe("renewal schema Status options", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NOTION_API_KEY", "test-only-no-network");
    vi.stubEnv("NOTION_DATA_SOURCE_ID", "test-source");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Schema tests must not use the network"); }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not recreate legacy choices in an already-cleaned seven-Status schema", async () => {
    const result = await preview({ Status: { type: "select", select: { options: v2Statuses.map((name) => ({ name, color: "default" })) } } });
    expect(result.properties.Status).toBeUndefined();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("initializes only the seven membership statuses while retaining payment workflow options", async () => {
    const result = await preview({});
    expect(result.properties.Status.select.options.map((o: any) => o.name)).toEqual([...v2Statuses]);
    expect(result.properties["Renewal Step"].select.options.map((o: any) => o.name)).toContain("payment_pending");
  });

  it("keeps existing legacy records safe without adding any other legacy choice", async () => {
    const result = await preview({ Status: { type: "select", select: { options: [{ name: "expired", color: "red" }] } } });
    expect(result.properties.Status.select.options.map((o: any) => o.name)).toEqual(["expired", ...v2Statuses]);
  });
});
