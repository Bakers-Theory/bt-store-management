import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseDateCell,
  parseNumberCell,
  planAssetImport,
  planConsumableImport,
  planMovementImport,
  templateCsv,
  toRecords,
  ASSET_CSV_HEADERS,
} from "./csv-import";

const parse = (text: string) => toRecords(parseCsv(text));

describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a quoted comma inside its field", () => {
    expect(parseCsv('name,note\n"Oven, big",hot\n')).toEqual([
      ["name", "note"],
      ["Oven, big", "hot"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"say ""hi"""\n')).toEqual([["a"], ['say "hi"']]);
  });

  it("allows a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"two\nlines",x\n')).toEqual([
      ["a", "b"],
      ["two\nlines", "x"],
    ]);
  });

  it("handles CRLF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops blank lines rather than importing empty rows", () => {
    expect(parseCsv("a\n1\n\n2\n")).toEqual([["a"], ["1"], ["2"]]);
  });

  it("strips the BOM Excel writes, so the first header still matches", () => {
    const { records } = parse("﻿Name\nOven\n");
    expect(records[0].get("name")).toBe("Oven");
  });
});

describe("toRecords", () => {
  it("matches headers ignoring case, spaces and punctuation", () => {
    const { records } = parse("Purchase Price,serial_number\n100,SN1\n");
    expect(records[0].get("purchase price")).toBe("100");
    expect(records[0].get("serial number")).toBe("SN1");
  });

  it("cites the file line, header included", () => {
    const { records } = parse("name\nA\nB\n");
    expect(records.map((r) => r.line)).toEqual([2, 3]);
  });

  it("returns empty for a missing column rather than throwing", () => {
    const { records } = parse("name\nA\n");
    expect(records[0].get("nothing here")).toBe("");
  });

  it("tries each alias in turn", () => {
    const { records } = parse("item name\nBoxes\n");
    expect(records[0].get("name", "item name")).toBe("Boxes");
  });
});

describe("parseDateCell", () => {
  it("accepts what a machine writes and what a person writes", () => {
    expect(parseDateCell("2026-07-04")).toBe("2026-07-04");
    expect(parseDateCell("4-7-2026")).toBe("2026-07-04");
    expect(parseDateCell("04/07/2026")).toBe("2026-07-04");
  });

  it("rejects a date that does not exist", () => {
    expect(parseDateCell("31-02-2026")).toBeNull();
    expect(parseDateCell("2026-13-01")).toBeNull();
  });

  it("knows February in a leap year", () => {
    expect(parseDateCell("29-02-2028")).toBe("2028-02-29");
    expect(parseDateCell("29-02-2026")).toBeNull();
  });

  it("returns null for junk rather than a Date meaning January", () => {
    expect(parseDateCell("last Tuesday")).toBeNull();
    expect(parseDateCell("")).toBeNull();
  });
});

describe("parseNumberCell", () => {
  it("reads a number, tolerating thousands separators", () => {
    expect(parseNumberCell("1,250.50")).toBe(1250.5);
  });

  it("distinguishes blank from unreadable", () => {
    expect(parseNumberCell("  ")).toBeNull();
    expect(parseNumberCell("about ten")).toBe("invalid");
  });
});

describe("planAssetImport", () => {
  const ctx = { categories: ["Electronics", "Vehicles"], today: "2026-08-05" };
  const head = "Name,Category,Location,Purchase date,Purchase price";

  it("accepts a good row", () => {
    const plan = planAssetImport(
      parse(`${head}\nPOS machine,Electronics,Counter,2026-01-10,20000\n`),
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].value).toMatchObject({
      name: "POS machine",
      category: "Electronics",
      location: "Counter",
      purchaseDate: "2026-01-10",
      purchasePrice: 20000,
    });
  });

  it("reports a row it cannot read instead of skipping it quietly", () => {
    const plan = planAssetImport(parse(`${head}\n,Electronics,Counter,2026-01-10,1\n`), ctx);
    expect(plan.rows).toHaveLength(0);
    expect(plan.errors).toEqual([{ line: 2, message: "no name" }]);
  });

  it("refuses a category that is not on the admin list", () => {
    const plan = planAssetImport(parse(`${head}\nOven,Ovens,Kitchen,2026-01-10,1\n`), ctx);
    expect(plan.errors[0].message).toContain('category "Ovens" does not exist');
  });

  it("refuses a future purchase date", () => {
    const plan = planAssetImport(parse(`${head}\nOven,Electronics,K,2027-01-01,1\n`), ctx);
    expect(plan.errors[0].message).toBe("purchase date is in the future");
  });

  it("refuses an unreadable date and says what format to use", () => {
    const plan = planAssetImport(parse(`${head}\nOven,Electronics,K,soon,1\n`), ctx);
    expect(plan.errors[0].message).toContain("YYYY-MM-DD");
  });

  it("checks the warranty ordering the same way the form does", () => {
    const plan = planAssetImport(
      parse(
        "Name,Category,Location,Purchase date,Purchase price,Warranty start,Warranty expiry\n" +
          "Oven,Electronics,K,2026-01-10,1,2026-06-01,2026-05-01\n",
      ),
      ctx,
    );
    expect(plan.errors[0].message).toBe("warranty ends before it starts");
  });

  it("catches a warranty ending before the asset was bought", () => {
    const plan = planAssetImport(
      parse(
        "Name,Category,Location,Purchase date,Purchase price,Warranty expiry\n" +
          "Oven,Electronics,K,2026-01-10,1,2025-01-01\n",
      ),
      ctx,
    );
    expect(plan.errors[0].message).toBe("warranty ends before the asset was bought");
  });

  it("catches a serial repeated inside the file", () => {
    const plan = planAssetImport(
      parse(
        `${head},Serial\nA,Electronics,K,2026-01-10,1,SN1\nB,Electronics,K,2026-01-10,1,sn1\n`,
      ),
      ctx,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.errors[0].message).toContain("appears twice");
  });

  it("validates a condition against the list", () => {
    const plan = planAssetImport(
      parse(`${head},Condition\nA,Electronics,K,2026-01-10,1,mint\n`),
      ctx,
    );
    expect(plan.errors[0].message).toContain("not one of new, good, fair, poor");
  });

  it("keeps reading after a bad row", () => {
    const plan = planAssetImport(
      parse(`${head}\n,Electronics,K,2026-01-10,1\nB,Electronics,K,2026-01-10,2\n`),
      ctx,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.rows[0].line).toBe(3);
  });
});

describe("planConsumableImport", () => {
  const ctx = { categories: ["Packaging"], units: ["pcs", "kg"] };
  const head = "Name,Category,Unit,Minimum";

  it("accepts a good row and leaves optional columns null", () => {
    const plan = planConsumableImport(parse(`${head}\nCake boxes,Packaging,pcs,100\n`), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].value).toMatchObject({
      name: "Cake boxes",
      unit: "pcs",
      minStock: 100,
      maxStock: null,
      reorderLevel: null,
      costPerUnit: null,
      expiryDate: null,
    });
  });

  it("insists on a minimum, because it is what triggers the alert", () => {
    const plan = planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,\n`), ctx);
    expect(plan.errors[0].message).toContain("no minimum stock");
  });

  it("refuses a unit that is not on the list", () => {
    const plan = planConsumableImport(parse(`${head}\nBoxes,Packaging,crates,10\n`), ctx);
    expect(plan.errors[0].message).toContain('unit "crates" is not on the units list');
  });

  it("applies the same level rules as the form", () => {
    const rows = parse(`${head},Maximum\nBoxes,Packaging,pcs,100,50\n`);
    expect(planConsumableImport(rows, ctx).errors[0].message).toBe(
      "maximum is below the minimum",
    );

    const reorder = parse(`${head},Maximum,Reorder level\nB,Packaging,pcs,10,50,80\n`);
    expect(planConsumableImport(reorder, ctx).errors[0].message).toBe(
      "reorder level is above the maximum",
    );
  });

  it("catches the same (name, unit) pair twice — the table's own uniqueness", () => {
    const plan = planConsumableImport(
      parse(`${head}\nBoxes,Packaging,pcs,10\nboxes,Packaging,pcs,20\n`),
      ctx,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.errors[0].message).toContain("appears twice");
  });

  it("allows the same name in a different unit", () => {
    const plan = planConsumableImport(
      parse(`${head}\nSugar,Packaging,kg,10\nSugar,Packaging,pcs,20\n`),
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(2);
  });
});

describe("planMovementImport", () => {
  const ctx = {
    today: "2026-08-05",
    items: [
      { id: "c1", code: "CON-0001", name: "Cake boxes", unit: "pcs", currentStock: 10 },
      { id: "c2", code: "CON-0002", name: "Sugar", unit: "kg", currentStock: 0 },
    ],
  };
  const head = "Item,Type,Qty,Date";

  it("matches an item by code or by name", () => {
    const plan = planMovementImport(
      parse(`${head}\nCON-0001,issue,2,2026-08-01\nSugar,purchase,5,2026-08-01\n`),
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows.map((r) => r.value.consumableId)).toEqual(["c1", "c2"]);
  });

  it("validates against a RUNNING stock figure, not the opening one", () => {
    // 10 on hand: 4 + 4 pass, the third 4 cannot.
    const plan = planMovementImport(
      parse(`${head}\nCON-0001,issue,4,2026-08-01\nCON-0001,issue,4,2026-08-02\nCON-0001,issue,4,2026-08-03\n`),
      ctx,
    );
    expect(plan.rows).toHaveLength(2);
    expect(plan.errors[0].message).toContain("only 2 pcs of Cake boxes would be on hand");
  });

  it("lets a purchase earlier in the file fund a later issue", () => {
    const plan = planMovementImport(
      parse(`${head}\nSugar,purchase,20,2026-08-01\nSugar,issue,15,2026-08-02\n`),
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(2);
  });

  it("requires a reason on the write-off types", () => {
    const plan = planMovementImport(parse(`${head}\nCON-0001,wastage,1,2026-08-01\n`), ctx);
    expect(plan.errors[0].message).toBe("a wastage needs a reason");
  });

  it("allows a negative adjustment but not a zero one", () => {
    const ok = planMovementImport(
      parse(`${head},Reason\nCON-0001,adjustment,-2,2026-08-01,Count\n`),
      ctx,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0].value.qty).toBe(-2);

    const zero = planMovementImport(
      parse(`${head},Reason\nCON-0001,adjustment,0,2026-08-01,Count\n`),
      ctx,
    );
    expect(zero.errors[0].message).toContain("zero changes nothing");
  });

  it("keeps a unit cost to purchases", () => {
    const plan = planMovementImport(
      parse(`${head},Unit cost\nCON-0001,issue,1,2026-08-01,5\n`),
      ctx,
    );
    expect(plan.errors[0].message).toBe("a unit cost belongs on a purchase");
  });

  it("defaults a blank date to today rather than refusing the row", () => {
    const plan = planMovementImport(parse(`${head}\nCON-0001,issue,1,\n`), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].value.onDate).toBe("2026-08-05");
  });

  it("refuses a future date and an unknown item", () => {
    expect(
      planMovementImport(parse(`${head}\nCON-0001,issue,1,2027-01-01\n`), ctx).errors[0]
        .message,
    ).toBe("date is in the future");
    expect(
      planMovementImport(parse(`${head}\nWidgets,issue,1,2026-08-01\n`), ctx).errors[0]
        .message,
    ).toContain('no item matches "Widgets"');
  });

  it("rejects a movement type it does not know", () => {
    const plan = planMovementImport(parse(`${head}\nCON-0001,vanish,1,2026-08-01\n`), ctx);
    expect(plan.errors[0].message).toContain('"vanish" is not a movement type');
  });
});

describe("templateCsv", () => {
  it("writes a header-only file for someone to fill in", () => {
    expect(templateCsv(ASSET_CSV_HEADERS)).toBe(ASSET_CSV_HEADERS.join(",") + "\r\n");
  });

  it("round-trips through the parser as an empty record set", () => {
    const { headers, records } = parse(templateCsv(ASSET_CSV_HEADERS));
    expect(headers).toEqual(ASSET_CSV_HEADERS);
    expect(records).toEqual([]);
  });
});
