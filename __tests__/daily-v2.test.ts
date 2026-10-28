import { it, expect, vi } from "vitest";
import { runDailyV2, sendV2RenewalReminder } from "@/lib/bot/v2-job";
const now = new Date("2026-10-28T01:00:00Z");
const windowEnd = "2026-10-27T16:00:00Z";
function fixture(extra: Record<string, unknown> = {}) {
  let member = {
    pageId: "p",
    status: "active_paid",
    telegramUserId: "123",
    exchangeName: "Bitget",
    exchangeUid: "123",
    admissionVerifiedAt: "2026-01-01",
    paidAt: "2026-09-01",
    reviewDueAt: "2026-10-28T00:00:00Z",
    volumeQualified: true,
    volumeCheckedAt: now.toISOString(),
    volumeWindowEnd: windowEnd,
    qualificationFieldsAvailable: true,
    reminderFieldsAvailable: true,
    renewalStep: "",
    ...extra,
  } as any;
  let locked = false,
    lockCount = 0;
  const transitions = new Map<string, any>(),
    completed = new Set<string>();
  const outcomes = new Map<string, "sent" | "sending" | "unknown">();
  const effects: Array<{ type: string; locked: boolean; patch?: any }> = [];
  const d = {
    beforeLock: undefined as undefined | ((n: number) => Promise<void> | void),
    change: (patch: Record<string, unknown>) => {
      member = { ...member, ...patch };
    },
    effects,
    transitions,
    completed,
    outcomes,
    list: vi.fn(async () => [{ ...member }]),
    read: vi.fn(async () => ({ ...member })),
    write: vi.fn(async (_id: string, patch: any) => {
      effects.push({ type: "write", locked, patch });
      member = { ...member, ...patch };
    }),
    send: vi.fn(
      async (_chatId: string | number, _text: string, _keyboard?: unknown) => {
        effects.push({ type: "send", locked });
      },
    ),
    store: {
      reserveAccount: async () => {},
      withQualificationLock: async (_id: string, work: any) => {
        await d.beforeLock?.(++lockCount);
        if (locked) throw Error("qualification_in_progress");
        locked = true;
        try {
          return await work(async () => {
            if (!locked) throw Error("qualification_lease_expired");
          });
        } finally {
          locked = false;
        }
      },
      recordDeposits: async () => {},
      depositTotal: async () => "100",
      recordTransition: vi.fn(async (event: any) => {
        if (!transitions.has(event.key))
          transitions.set(event.key, { ...event });
      }),
      pendingTransitions: vi.fn(async (pageId: string) =>
        [...transitions.values()].filter(
          (e) => e.pageId === pageId && !completed.has(e.key),
        ),
      ),
      completeTransition: vi.fn(async (key: string) => {
        completed.add(key);
      }),
      deliverOnce: vi.fn(async (key: string, send: () => Promise<unknown>) => {
        if (outcomes.get(key) === "sent") return "already_sent" as const;
        if (outcomes.has(key)) return "held" as const;
        outcomes.set(key, "sending");
        try {
          await send();
          outcomes.set(key, "sent");
          return "sent" as const;
        } catch (error) {
          outcomes.set(key, "unknown");
          throw error;
        }
      }),
    },
    client: {
      admission: vi.fn(async () => {
        throw Error("unneeded");
      }),
      volume: vi.fn(async (): Promise<{ spot: string; futures: string }> => {
        throw Error("outage");
      }),
    },
  };
  const transition = (
    kind: string,
    fromTier: string,
    toTier: string,
    end: string | null = windowEnd,
  ) => {
    const event = {
      key: `${kind}:p:${end ? Date.parse(end) : "none"}`,
      pageId: "p",
      fromTier,
      toTier,
      windowEnd: end,
      kind,
    };
    transitions.set(event.key, event);
    return event;
  };
  return Object.assign(d, { transition });
}
it("expires paid privileges but retains last successful volume status on API outage", async () => {
  const d = fixture();
  await runDailyV2(now, d as any);
  expect((await d.read()).status).toBe("active_volume");
  expect(d.send).toHaveBeenCalledWith(
    "123",
    expect.stringContaining("交易量會員"),
    expect.anything(),
  );
});
it("deduplicates expiry notices across repeated jobs", async () => {
  const d = fixture();
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
});
it("never sends payment-expiry notice to free members with an old trial deadline", async () => {
  const d = fixture({ status: "free", paidAt: null, volumeQualified: false });
  await runDailyV2(now, d as any);
  expect(d.send).not.toHaveBeenCalled();
});
it("repairs durable reminder markers after an already-delivered message", async () => {
  const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
  d.outcomes.set(
    `reminder:p:${Date.parse("2026-11-02T00:00:00Z")}:7day`,
    "sent",
  );
  await sendV2RenewalReminder(await d.read(), now, "7day", d as any);
  expect(d.send).not.toHaveBeenCalled();
  expect((await d.read()).renewalReminderDueAt).toBe("2026-11-02T00:00:00Z");
  expect((await d.read()).renewalReminderSentAt).toBe(now.toISOString());
});
it("never sends paid expiry notices to non-expiring special members", async () => {
  const d = fixture({ status: "partner" });
  await runDailyV2(now, d as any);
  expect(d.send).not.toHaveBeenCalled();
});
it("does not upgrade ambiguous legacy payments in the job's error fallback", async () => {
  const d = fixture({
    status: "payment_pending",
    paidAt: "2026-01-01",
    reviewDueAt: "2027-01-01",
  });
  await runDailyV2(now, d as any);
  expect((await d.read()).status).toBe("payment_pending");
  expect(d.send).not.toHaveBeenCalled();
});
it.each(["suspended", "active_paid"])(
  "freshly respects %s while qualification-error fallback waits for its lock",
  async (status) => {
    const d = fixture({ exchangeName: "unsupported", volumeQualified: false });
    d.beforeLock = async (n) => {
      if (n === 2)
        d.change({
          status,
          ...(status === "active_paid"
            ? {
                paidAt: now.toISOString(),
                reviewDueAt: "2027-01-01",
                renewalStep: "",
                paymentDeadlineAt: null,
              }
            : {}),
        });
    };
    await runDailyV2(now, d as any);
    expect((await d.read()).status).toBe(status);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.effects.every((e) => e.locked)).toBe(true);
  },
);
it("does not send an obsolete expiry or restore old markers after approval before the notice lock", async () => {
  const d = fixture({
    volumeQualified: false,
    renewalStep: "payment_pending",
    paymentDeadlineAt: "2026-10-27",
  });
  d.beforeLock = async (n) => {
    if (n === 2)
      d.change({
        status: "active_paid",
        paidAt: now.toISOString(),
        reviewDueAt: "2027-01-01",
        renewalStep: "",
        paymentDeadlineAt: null,
        renewalReminderDueAt: null,
        renewalReminderSentAt: null,
      });
  };
  await runDailyV2(now, d as any);
  expect(d.send).not.toHaveBeenCalled();
  expect(await d.read()).toMatchObject({
    status: "active_paid",
    reviewDueAt: "2027-01-01",
    renewalStep: "",
    renewalReminderDueAt: null,
  });
});
it("rechecks complete payment proof before expiring the request", async () => {
  const d = fixture({
    reviewDueAt: "2027-01-01",
    renewalStep: "payment_pending",
    paymentDeadlineAt: "2026-10-27T00:00:00Z",
  });
  d.beforeLock = async (n) => {
    if (n === 2)
      d.change({
        paymentProofFileId: "proof",
        paymentUidLast4: "1234",
        paymentProofSubmittedAt: "2026-10-26T00:00:00Z",
      });
  };
  await runDailyV2(now, d as any);
  expect((await d.read()).renewalStep).toBe("payment_pending");
  expect(d.send).not.toHaveBeenCalled();
});
it.each(["extended", "suspended", "proof"])(
  "rejects stale manual reminder snapshot after fresh %s",
  async (change) => {
    const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
    const snapshot = await d.read();
    d.change(
      change === "extended"
        ? { reviewDueAt: "2027-01-01" }
        : change === "suspended"
          ? { status: "suspended" }
          : {
              renewalStep: "payment_pending",
              paymentDeadlineAt: "2026-11-04",
              paymentProofFileId: "proof",
              paymentUidLast4: "1234",
            },
    );
    await sendV2RenewalReminder(snapshot, now, "7day", d as any);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  },
);
it("uses the private reminder helper without nesting the job lease and preserves both stage markers", async () => {
  const due = "2026-11-02T00:00:00Z",
    d = fixture({ reviewDueAt: due });
  await runDailyV2(now, d as any);
  const later = new Date("2026-10-31T01:00:00Z");
  await sendV2RenewalReminder(await d.read(), later, "3day", d as any);
  await sendV2RenewalReminder(await d.read(), later, "3day", d as any);
  expect(d.send).toHaveBeenCalledTimes(2);
  expect(await d.read()).toMatchObject({
    renewalReminderDueAt: due,
    renewalReminderSentAt: now.toISOString(),
    renewalReminder3DaySentAt: later.toISOString(),
  });
  expect(d.effects.every((e) => e.locked)).toBe(true);
});
it.each([
  ["volume_upgrade", "free", "active_volume", true],
  ["volume_downgrade", "active_volume", "free", false],
] as const)(
  "consumes admin-persisted %s once even after the Status already changed",
  async (kind, from, to, qualified) => {
    const d = fixture({
      status: to,
      paidAt: null,
      reviewDueAt: null,
      volumeQualified: qualified,
    });
    const event = d.transition(kind, from, to);
    await runDailyV2(now, d as any);
    await runDailyV2(now, d as any);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.completed.has(event.key)).toBe(true);
    expect(d.effects.every((e) => e.locked)).toBe(true);
  },
);
it("notifies an actual qualification upgrade once using its durable intent", async () => {
  const d = fixture({
    status: "free",
    paidAt: null,
    reviewDueAt: null,
    volumeQualified: false,
  });
  d.client.volume.mockResolvedValue({ spot: "100000", futures: "100000" });
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.store.recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "volume_upgrade",
      fromTier: "free",
      toTier: "active_volume",
    }),
  );
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.send.mock.calls[0]?.[1]).toContain("達標");
});
it("holds a failed transition send for review and repairs completion after an already-sent receipt", async () => {
  const d = fixture({
    status: "free",
    paidAt: null,
    reviewDueAt: null,
    volumeQualified: false,
  });
  const event = d.transition("volume_downgrade", "active_volume", "free");
  d.send.mockRejectedValueOnce(Error("unknown send outcome"));
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.completed.has(event.key)).toBe(false);
  d.outcomes.set(event.key, "sent");
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.completed.has(event.key)).toBe(true);
});
it("suppresses obsolete intents against a newer confirmed volume window", async () => {
  const later = new Date("2026-10-29T01:00:00Z");
  const d = fixture({
    status: "free",
    paidAt: null,
    reviewDueAt: null,
    volumeQualified: false,
    volumeWindowEnd: "2026-10-28T16:00:00Z",
    volumeCheckedAt: later.toISOString(),
  });
  const event = d.transition("volume_upgrade", "free", "active_volume");
  await runDailyV2(later, d as any);
  expect(d.send).not.toHaveBeenCalled();
  expect(d.completed.has(event.key)).toBe(true);
});
it("retains an unapplied future-window intent until successful facts confirm it", async () => {
  const d = fixture({
    status: "free",
    paidAt: null,
    reviewDueAt: null,
    volumeQualified: false,
    volumeWindowEnd: "2026-10-26T16:00:00Z",
  });
  const event = d.transition("volume_upgrade", "free", "active_volume");
  await runDailyV2(now, d as any);
  expect(d.send).not.toHaveBeenCalled();
  expect(d.completed.has(event.key)).toBe(false);
  d.change({
    status: "active_volume",
    volumeQualified: true,
    volumeWindowEnd: windowEnd,
  });
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.completed.has(event.key)).toBe(true);
});
it("delivers a paid expiry once without a second volume notice for the same expiry", async () => {
  const d = fixture({ status: "free", volumeQualified: false });
  const expiry = d.transition(
    "paid_expiry",
    "active_paid",
    "free",
    "2026-10-28T00:00:00Z",
  );
  const volume = d.transition("volume_downgrade", "active_volume", "free");
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.completed.has(expiry.key)).toBe(true);
  expect(d.completed.has(volume.key)).toBe(true);
});
it("persists fallback paid expiry intent before materializing the unsupported-account result", async () => {
  const d = fixture({ exchangeName: "unsupported", volumeQualified: false });
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.store.recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      key: `paid_expiry:p:${Date.parse("2026-10-28T00:00:00Z")}`,
      kind: "paid_expiry",
      fromTier: "active_paid",
      toTier: "free",
    }),
  );
  expect(d.store.recordTransition.mock.invocationCallOrder[0]).toBeLessThan(
    d.write.mock.invocationCallOrder[0]!,
  );
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.effects.every((e) => e.locked)).toBe(true);
});
it("notifies an actual successful volume downgrade once", async () => {
  const d = fixture({
    status: "active_volume",
    paidAt: null,
    reviewDueAt: null,
  });
  d.client.volume.mockResolvedValue({ spot: "0", futures: "0" });
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.store.recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "volume_downgrade",
      fromTier: "active_volume",
      toTier: "free",
    }),
  );
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.send.mock.calls[0]?.[1]).toContain("未達");
});
it("repairs transition completion after a crash following successful delivery without sending twice", async () => {
  const d = fixture({
    status: "free",
    paidAt: null,
    reviewDueAt: null,
    volumeQualified: false,
  });
  const event = d.transition("volume_downgrade", "active_volume", "free");
  d.store.completeTransition.mockRejectedValueOnce(
    Error("crash after successful send"),
  );
  await runDailyV2(now, d as any);
  expect(d.completed.has(event.key)).toBe(false);
  await runDailyV2(now, d as any);
  expect(d.completed.has(event.key)).toBe(true);
  expect(d.send).toHaveBeenCalledTimes(1);
});
it("repairs reminder markers after a failed Notion write without sending the reminder twice", async () => {
  const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
  d.write.mockRejectedValueOnce(Error("Notion write failed"));
  await expect(
    sendV2RenewalReminder(await d.read(), now, "7day", d as any),
  ).rejects.toThrow("Notion write failed");
  await sendV2RenewalReminder(await d.read(), now, "7day", d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect((await d.read()).renewalReminderDueAt).toBe("2026-11-02T00:00:00Z");
});
it("checks the renewed lease guard before a manual reminder send or marker write", async () => {
  const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
  d.store.withQualificationLock = async (_id: string, work: any) =>
    work(async () => {
      throw Error("qualification_lease_expired");
    });
  await expect(
    sendV2RenewalReminder(await d.read(), now, "7day", d as any),
  ).rejects.toThrow("qualification_lease_expired");
  expect(d.send).not.toHaveBeenCalled();
  expect(d.write).not.toHaveBeenCalled();
});
it("cannot send a duplicate volume notice after a crash between redundant-intent completions", async () => {
  const d = fixture({ status: "free", volumeQualified: false });
  d.transition("paid_expiry", "active_paid", "free", "2026-10-28T00:00:00Z");
  const volume = d.transition("volume_downgrade", "active_volume", "free");
  let fail = true;
  d.store.completeTransition.mockImplementation(async (key) => {
    if (key === volume.key && fail) {
      fail = false;
      throw Error("crash while consuming redundant volume intent");
    }
    d.completed.add(key);
  });
  await runDailyV2(now, d as any);
  await runDailyV2(now, d as any);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.completed.has(volume.key)).toBe(true);
});
it.each(["future_window", "check_before_window"])(
  "holds a volume intent with unconfirmed %s statistics",
  async (reason) => {
    const end = reason === "future_window" ? "2026-10-28T16:00:00Z" : windowEnd;
    const d = fixture({
      status: "active_volume",
      paidAt: null,
      reviewDueAt: null,
      volumeWindowEnd: end,
      volumeCheckedAt:
        reason === "check_before_window"
          ? "2026-10-27T00:00:00Z"
          : now.toISOString(),
    });
    const event = d.transition("volume_upgrade", "free", "active_volume", end);
    await runDailyV2(now, d as any);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.completed.has(event.key)).toBe(false);
  },
);
it("holds unknown reminder delivery without sending or restoring cycle markers", async () => {
  const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
  d.outcomes.set(
    `reminder:p:${Date.parse("2026-11-02T00:00:00Z")}:7day`,
    "unknown",
  );
  await expect(
    sendV2RenewalReminder(await d.read(), now, "7day", d as any),
  ).rejects.toThrow("需要人工覆核");
  expect(d.send).not.toHaveBeenCalled();
  expect(d.write).not.toHaveBeenCalled();
});
it("serializes concurrent stage recovery and preserves the earlier stage marker", async () => {
  const d = fixture({ reviewDueAt: "2026-11-02T00:00:00Z" });
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  d.send.mockImplementationOnce(async () => {
    entered();
    await held;
  });
  const first = sendV2RenewalReminder(await d.read(), now, "7day", d as any);
  await started;
  const later = new Date("2026-10-31T01:00:00Z");
  await expect(
    sendV2RenewalReminder(await d.read(), later, "3day", d as any),
  ).rejects.toThrow("qualification_in_progress");
  release();
  await first;
  await sendV2RenewalReminder(await d.read(), later, "3day", d as any);
  expect(d.send).toHaveBeenCalledTimes(2);
  expect(await d.read()).toMatchObject({
    renewalReminderSentAt: now.toISOString(),
    renewalReminder3DaySentAt: later.toISOString(),
  });
});
it("reports retained-volume API failures to the existing operator alert path", async () => {
  const d = fixture();
  const results = await runDailyV2(now, d as any);
  expect(results).toEqual([
    {
      pageId: "p",
      action: "error",
      detail: expect.stringContaining("upstream_unavailable"),
    },
  ]);
  expect((await d.read()).volumeQualified).toBe(true);
  expect((await d.read()).status).toBe("active_volume");
});
