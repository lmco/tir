import { beforeEach, describe, expect, test, vi } from "vitest";

import { importCciList } from "../../../server/utils/cci";

const models = vi.hoisted(() => ({
  CciList: { findOrBuild: vi.fn() },
  CciItem: { findAll: vi.fn(), upsert: vi.fn() },
  CciReference: { findAll: vi.fn(), create: vi.fn() },
  PolicyDocument: { findAll: vi.fn(), create: vi.fn() },
}));

vi.mock("../../../db/models", () => models);

const xml = `<?xml version="1.0" encoding="utf-8"?>
<cci_list xmlns="http://iase.disa.mil/cci">
  <metadata><version>2025-01-23</version><publishdate>2025-01-23</publishdate></metadata>
  <cci_items>
    <cci_item id="CCI-000001">
      <status>draft</status>
      <publishdate>2009-05-13</publishdate>
      <contributor>DISA FSO</contributor>
      <definition>Access control policy.</definition>
      <type>policy</type>
      <references>
        <reference creator="NIST" title="NIST SP 800-53" version="5" location="https://example.test" index="AC-1 a 1" />
      </references>
    </cci_item>
    <cci_item id="CCI-000002">
      <status>draft</status>
      <publishdate>2009-05-13</publishdate>
      <contributor>DISA FSO</contributor>
      <definition>Access control procedures.</definition>
      <type>technical</type>
      <references>
        <reference creator="NIST" title="NIST SP 800-53" version="5" location="https://example.test" index="AC-1 a 2" />
      </references>
    </cci_item>
  </cci_items>
</cci_list>`;

const streamer = { status: vi.fn(), progress: vi.fn(), error: vi.fn(), complete: vi.fn() } as any;

function buildCciList() {
  const list: any = { id: undefined };
  list.save = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    list.id = 42;
  });
  return list;
}

describe("importCciList", () => {
  let transaction: { commit: ReturnType<typeof vi.fn>; rollback: ReturnType<typeof vi.fn> };
  let list: any;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction = { commit: vi.fn(), rollback: vi.fn() };
    vi.stubGlobal("sequelize", {
      transaction: vi.fn().mockResolvedValue(transaction),
      getDialect: () => "postgres",
    });
    vi.stubGlobal("logger", { error: vi.fn(), info: vi.fn() });

    list = buildCciList();
    models.CciList.findOrBuild
      .mockResolvedValueOnce([list, true])
      .mockResolvedValueOnce([list, false]);
    models.CciItem.findAll.mockResolvedValue([]);
    models.PolicyDocument.findAll.mockResolvedValue([]);
    models.CciReference.findAll.mockResolvedValue([]);
    models.CciItem.upsert.mockImplementation((values: any) =>
      Promise.resolve([
        { ...values, addCciReference: vi.fn(), hasCciReference: vi.fn().mockResolvedValue(true) },
        true,
      ]),
    );
    models.PolicyDocument.create.mockImplementation((values: any) =>
      Promise.resolve({ id: 7, ...values }),
    );
    models.CciReference.create.mockImplementation((values: any) =>
      Promise.resolve({ id: 8, ...values }),
    );
  });

  test("saves the list before creating its items so every item gets the list id", async () => {
    const result = await importCciList(xml, streamer);

    expect(result).toEqual({ success: true, error: "" });
    expect(list.save).toHaveBeenCalledWith({ transaction });
    expect(models.CciItem.upsert).toHaveBeenCalledTimes(2);
    for (const [values, options] of models.CciItem.upsert.mock.calls) {
      expect(values.CciListId).toBe(42);
      expect(options).toEqual({ transaction });
    }
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  test("reads existing rows inside the import transaction", async () => {
    await importCciList(xml, streamer);

    expect(models.CciItem.findAll).toHaveBeenCalledWith({
      where: { CciListId: 42 },
      transaction,
    });
    expect(models.PolicyDocument.findAll).toHaveBeenCalledWith({ transaction });
    expect(models.CciReference.findAll).toHaveBeenCalledWith({ transaction });
    expect(models.PolicyDocument.create).toHaveBeenCalledTimes(1);
    expect(models.CciReference.create).toHaveBeenCalledTimes(2);
  });

  test("rolls back and reports failure when an item cannot be written", async () => {
    models.CciItem.upsert.mockRejectedValue(new Error("notNull Violation"));

    const result = await importCciList(xml, streamer);

    expect(result.success).toBe(false);
    expect(result.error).toContain("notNull Violation");
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  test("refuses an older list than the one already imported", async () => {
    models.CciList.findOrBuild.mockReset();
    models.CciList.findOrBuild.mockResolvedValueOnce([list, false]);

    const result = await importCciList(xml, streamer);

    expect(result).toEqual({ success: false, error: "Newer CCIList already imported." });
    expect(list.save).not.toHaveBeenCalled();
  });
});
