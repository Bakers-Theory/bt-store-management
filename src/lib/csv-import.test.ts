import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseDateCell,
  parseNumberCell,
  planAssetImport,
  planConsumableImport,
  planItemImport,
  planMovementImport,
  templateCsv,
  toRecords,
  ASSET_CSV_HEADERS,
} from "./csv-import";

const parse = (text: string) => toRecords(parseCsv(text));

/** Shared across the planners that resolve a Vendor cell. */
const SUPPLIERS = [
  { id: "s1", code: "SUP-0001", name: "Sharma Flour Mills" },
  { id: "s2", code: "SUP-0002", name: "Nagpur Dairy" },
];

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
  const ctx = {
    categories: ["Electronics", "Vehicles"],
    vendors: SUPPLIERS,
    today: "2026-08-05",
  };
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
  const ctx = { categories: ["Packaging"], units: ["pcs", "kg"], vendors: SUPPLIERS };
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

  it("reads an opening quantity, and defaults it to nothing", () => {
    const plan = planConsumableImport(
      parse(`${head},Opening qty\nBoxes,Packaging,pcs,100,250\nCups,Packaging,pcs,50,\n`),
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows.map((r) => r.value.openingQty)).toEqual([250, 0]);
  });

  it("refuses a negative opening quantity", () => {
    const plan = planConsumableImport(
      parse(`${head},Opening qty\nBoxes,Packaging,pcs,100,-5\n`),
      ctx,
    );
    expect(plan.errors[0].message).toBe("opening quantity is negative");
  });

  it("files every row under the forced vendor, ignoring the Vendor column", () => {
    const plan = planConsumableImport(
      parse(`${head},Vendor\nBoxes,Packaging,pcs,100,Nobody At All\n`),
      { ...ctx, forceVendorId: "s2" },
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].value.vendorId).toBe("s2");
  });
});

describe("planMovementImport", () => {
  const ctx = {
    today: "2026-08-05",
    vendors: SUPPLIERS,
    holders: [{ id: "e1", code: "", name: "Asha" }],
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

describe("vendor and billing columns", () => {
  const assetCtx = {
    categories: ["Electronics"],
    vendors: SUPPLIERS,
    today: "2026-08-05",
  };
  const conCtx = { categories: ["Packaging"], units: ["pcs"], vendors: SUPPLIERS };
  const movCtx = {
    today: "2026-08-05",
    vendors: SUPPLIERS,
    holders: [{ id: "e1", code: "", name: "Asha" }],
    items: [{ id: "c1", code: "CON-0001", name: "Cake boxes", unit: "pcs", currentStock: 10 }],
  };

  it("resolves an asset's vendor by name or by code", () => {
    const head = "Name,Category,Location,Purchase date,Purchase price,Vendor";
    const p = planAssetImport(
      parse(
        `${head}\nOven,Electronics,Kitchen,2026-01-01,50000,SUP-0002\n` +
          `Mixer,Electronics,Kitchen,2026-01-01,9000,sharma flour mills\n` +
          `Fan,Electronics,Kitchen,2026-01-01,2000,\n`,
      ),
      assetCtx,
    );
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => r.value.vendorId)).toEqual(["s2", "s1", null]);
  });

  it("refuses a vendor that matches no supplier rather than dropping it", () => {
    const head = "Name,Category,Location,Purchase date,Purchase price,Vendor";
    const p = planAssetImport(
      parse(`${head}\nOven,Electronics,Kitchen,2026-01-01,500,Acme Ltd\n`),
      assetCtx,
    );
    expect(p.rows).toEqual([]);
    expect(p.errors[0].message).toContain('no supplier matches "Acme Ltd"');
  });

  it("carries a consumable's bill mode, HSN, GST rate and vendor", () => {
    const head = "Name,Category,Unit,Minimum,Cost per unit,Bill mode,HSN,GST rate,Vendor";
    const p = planConsumableImport(
      parse(`${head}\nBoxes,Packaging,pcs,10,4,charge,4819,12,Nagpur Dairy\n`),
      conCtx,
    );
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toMatchObject({
      billMode: "charge",
      hsn: "4819",
      gstRate: 12,
      vendorId: "s2",
    });
  });

  it("defaults a consumable's billing columns to what the form defaults to", () => {
    const p = planConsumableImport(
      parse("Name,Category,Unit,Minimum\nBoxes,Packaging,pcs,10\n"),
      conCtx,
    );
    expect(p.rows[0].value).toMatchObject({
      billMode: "none",
      hsn: "",
      gstRate: 0,
      vendorId: null,
    });
  });

  it("refuses a bill mode it does not know, and a GST rate the app does not offer", () => {
    const head = "Name,Category,Unit,Minimum,Cost per unit,Bill mode,HSN,GST rate";
    expect(
      planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,10,4,invoice\n`), conCtx).errors[0]
        .message,
    ).toBe('bill mode "invoice" is not one of none, charge, absorb');
    expect(
      planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,10,4,charge,4819,9\n`), conCtx)
        .errors[0].message,
    ).toBe("GST rate must be one of 0, 5, 12, 18, 28");
  });

  it("refuses to charge a consumable that has no cost per unit", () => {
    const head = "Name,Category,Unit,Minimum,Cost per unit,Bill mode";
    expect(
      planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,10,,charge\n`), conCtx).errors[0]
        .message,
    ).toBe("set a cost per pcs before charging this item on a bill");
    expect(
      planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,10,0,charge\n`), conCtx).errors[0]
        .message,
    ).toContain("before charging this item on a bill");
    // absorb prices nothing on a bill, so it needs no cost.
    expect(
      planConsumableImport(parse(`${head}\nBoxes,Packaging,pcs,10,,absorb\n`), conCtx).errors,
    ).toEqual([]);
  });

  it("carries a movement's vendor and issued-to, each on its own movement type", () => {
    const head = "Item,Type,Qty,Date,Unit cost,Vendor,Issued to";
    const p = planMovementImport(
      parse(
        `${head}\nCON-0001,purchase,5,2026-08-01,4,SUP-0001,\n` +
          `CON-0001,issue,2,2026-08-02,,,Asha\n`,
      ),
      movCtx,
    );
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => [r.value.vendorId, r.value.issuedTo])).toEqual([
      ["s1", null],
      [null, "e1"],
    ]);
  });

  it("refuses a vendor on an issue, an issued-to on a purchase, and an unknown holder", () => {
    const head = "Item,Type,Qty,Date,Unit cost,Vendor,Issued to";
    expect(
      planMovementImport(parse(`${head}\nCON-0001,issue,2,2026-08-01,,SUP-0001,\n`), movCtx)
        .errors[0].message,
    ).toBe("a vendor belongs on a purchase");
    expect(
      planMovementImport(parse(`${head}\nCON-0001,purchase,2,2026-08-01,4,,Asha\n`), movCtx)
        .errors[0].message,
    ).toBe("an issued-to name belongs on an issue");
    expect(
      planMovementImport(parse(`${head}\nCON-0001,issue,2,2026-08-01,,,Ravi\n`), movCtx).errors[0]
        .message,
    ).toBe('nobody on the staff list is called "Ravi"');
  });
});

describe("planItemImport", () => {
  const ctx = {
    categories: ["Bakery", "Dairy"],
    units: ["kg", "pcs"],
    existingNames: ["Butter"],
    today: "2026-08-05",
  };
  const head = "Name,Category,Unit,Cost price,Sell price,Opening qty,HSN,GST rate,Tracks expiry,Expiry date,Emoji";
  const plan = (body: string) => planItemImport(parse(`${head}\n${body}`), ctx);

  it("reads a full row", () => {
    const p = plan("Croissant,Bakery,pcs,20,45,12,1905,5,yes,2026-09-01,🥐\n");
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toEqual({
      name: "Croissant",
      emoji: "🥐",
      imageUrl: null,
      category: "Bakery",
      unit: "pcs",
      price: 45,
      costPrice: 20,
      qty: 12,
      tracksExpiry: true,
      expiryDate: "2026-09-01",
      hsn: "1905",
      gstRate: 5,
    });
  });

  it("fills the optional columns with the Add Item form's defaults", () => {
    const p = plan("Baguette,Bakery,pcs,,,,,,,,\n");
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toMatchObject({
      emoji: "📦",
      price: 0,
      costPrice: 0,
      qty: 0,
      gstRate: 0,
      hsn: "",
      tracksExpiry: true,
      expiryDate: null,
    });
  });

  it("requires a name, and a category and unit that already exist", () => {
    expect(plan(",Bakery,pcs\n").errors[0].message).toBe("no name");
    expect(plan("Cake,Sweets,pcs\n").errors[0].message).toContain(
      'category "Sweets" does not exist',
    );
    expect(plan("Cake,Bakery,dozen\n").errors[0].message).toContain(
      'unit "dozen" is not on the units list',
    );
    expect(plan("Cake,Bakery,\n").errors[0].message).toBe("no unit");
  });

  it("refuses a name that is already in Stock rather than merging into it", () => {
    expect(plan("butter,Dairy,kg\n").errors[0].message).toContain("already in Stock");
  });

  it("refuses the same name twice in one file", () => {
    const p = plan("Cake,Bakery,pcs\nCAKE,Bakery,pcs\n");
    expect(p.rows).toHaveLength(1);
    expect(p.errors[0]).toEqual({ line: 3, message: '"CAKE" appears twice in this file' });
  });

  it("refuses unreadable or negative numbers", () => {
    expect(plan("Cake,Bakery,pcs,abc\n").errors[0].message).toBe(
      "a price or quantity column is not a number",
    );
    expect(plan("Cake,Bakery,pcs,-1\n").errors[0].message).toBe("a price is negative");
    expect(plan("Cake,Bakery,pcs,1,2,-3\n").errors[0].message).toBe(
      "opening quantity is negative",
    );
  });

  it("only accepts a GST rate the app offers", () => {
    expect(plan("Cake,Bakery,pcs,1,2,3,,7\n").errors[0].message).toBe(
      "GST rate must be one of 0, 5, 12, 18, 28",
    );
    expect(plan("Cake,Bakery,pcs,1,2,3,,18\n").rows[0].value.gstRate).toBe(18);
  });

  it("reads tracks expiry as yes/no and refuses anything else", () => {
    expect(plan("Cake,Bakery,pcs,,,,,,no\n").rows[0].value.tracksExpiry).toBe(false);
    expect(plan("Cake,Bakery,pcs,,,,,,maybe\n").errors[0].message).toBe(
      "tracks expiry must be yes or no",
    );
  });

  it("refuses an expiry that is not a date, has passed, or contradicts tracks expiry", () => {
    expect(plan("Cake,Bakery,pcs,,,,,,,soon\n").errors[0].message).toContain(
      "expiry date is not a date",
    );
    expect(plan("Cake,Bakery,pcs,,,,,,,2026-08-04\n").errors[0].message).toBe(
      "expiry date has already passed",
    );
    expect(plan("Cake,Bakery,pcs,,,,,,no,2026-09-01\n").errors[0].message).toContain(
      "tracks expiry is no",
    );
  });

  it("accepts the headers a spreadsheet is likelier to carry", () => {
    const p = planItemImport(
      parse("Product name,Category,UOM,Cost,MRP,Qty,HSN code,GST%\nJam,Dairy,kg,80,140,4,2007,12\n"),
      ctx,
    );
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toMatchObject({ name: "Jam", price: 140, costPrice: 80, qty: 4, gstRate: 12 });
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
