import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { qualificationFields } from "@/lib/membership-v2";
it("previews record conversion without credentials or writes", () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/membership-migrate.mjs",
        "--input",
        "__tests__/fixtures/membership-migration.json",
        "--now",
        "2026-10-28T01:00:00Z",
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.mode).toBe("dry-run");
  expect(result.records[0]).toMatchObject({
    status: "free",
    reviewDueAt: null,
  });
  expect(result.records[1].needsReview).toBe(true);
});
it("previews additive schema preserving legacy options", () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "scripts/membership-schema.mjs",
        "--input",
        "__tests__/fixtures/membership-schema.json",
      ],
      { encoding: "utf8" },
    ),
  );
  for (const [name, type] of Object.values(qualificationFields))
    expect(result.properties[name]).toHaveProperty(type);
  expect(
    result.properties.Status.select.options.map((o: any) => o.name),
  ).toEqual(
    expect.arrayContaining([
      "trial_active",
      "free",
      "active_volume",
      "suspended",
    ]),
  );
});
