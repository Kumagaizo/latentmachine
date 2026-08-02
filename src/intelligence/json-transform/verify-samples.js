function numberedRows(count, createRow) {
  return Array.from({ length: count }, (_, index) => createRow(index + 1));
}

export const VERIFY_SAMPLES = [
  {
    id: "ai-date-drift",
    label: "AI date format drift",
    expectedFlagged: 2,
    expectedFlaggedRows: [7, 8],
    original: numberedRows(8, id => ({
      id,
      name: `Customer ${id}`,
      created: `2026-0${Math.min(id, 9)}-${String(10 + id).padStart(2, "0")}T09:00:00Z`,
    })),
    transformed: numberedRows(8, id => ({
      customerId: id,
      fullName: `Customer ${id}`,
      createdDate: id <= 6
        ? `2026-0${Math.min(id, 9)}-${String(10 + id).padStart(2, "0")}`
        : id === 7
          ? `${String(10 + id).padStart(2, "0")}/0${Math.min(id, 9)}/2026`
          : `0${Math.min(id, 9)}-${String(10 + id).padStart(2, "0")}-2026`,
    })),
  },
  {
    id: "ai-enum-inconsistency",
    label: "AI enum inconsistency",
    expectedFlagged: 2,
    expectedFlaggedRows: [4, 7],
    original: numberedRows(8, id => ({
      role: id <= 4 ? "admin" : "viewer",
    })),
    transformed: numberedRows(8, id => ({
      role: id <= 4
        ? (id === 4 ? "administrator" : "admin")
        : (id === 7 ? "read-only" : "viewer"),
    })),
  },
  {
    id: "clean-migration",
    label: "Clean migration",
    expectedFlagged: 0,
    expectedFlaggedRows: [],
    original: numberedRows(8, id => ({ legacy_id: id, customer: `Customer ${id}` })),
    transformed: numberedRows(8, id => ({ id, name: `Customer ${id}` })),
  },
  {
    id: "one-outlier",
    label: "One outlier row",
    expectedFlagged: 1,
    expectedFlaggedRows: [7],
    original: numberedRows(10, id => ({ status: id % 2 ? "pending" : "complete" })),
    transformed: numberedRows(10, id => ({
      status: id === 7 ? "pendng" : (id % 2 ? "pending" : "complete"),
    })),
  },
  {
    id: "llm-drift",
    label: "LLM drift",
    expectedFlagged: 3,
    expectedFlaggedRows: [4, 5, 6],
    original: numberedRows(6, id => ({ id, date: `2026-01-${String(id).padStart(2, "0")}` })),
    transformed: numberedRows(6, id => ({
      id,
      date: id <= 3 ? `2026-01-${String(id).padStart(2, "0")}` : `${String(id).padStart(2, "0")}/01/2026`,
    })),
  },
  {
    id: "schema-change",
    label: "Schema change",
    expectedFlagged: 1,
    expectedFlaggedRows: [5],
    original: numberedRows(5, id => ({ id, name: `Record ${id}` })),
    transformed: numberedRows(5, id => id === 5
      ? { id, name: `Record ${id}`, source: "legacy" }
      : { id, name: `Record ${id}` }),
  },
];

export const VERIFY_ACCEPTANCE_CASES = [
  ...VERIFY_SAMPLES,
  {
    id: "accept-ai-missing-field",
    label: "AI missing required field",
    expectedFlagged: 1,
    expectedFlaggedRows: [5],
    expectedRuleStatus: "safe",
    original: numberedRows(8, id => ({
      customerId: `cus_${id}`,
      email: `customer${id}@example.com`,
    })),
    transformed: numberedRows(8, id => id === 5
      ? { customerId: `cus_${id}` }
      : { customerId: `cus_${id}`, email: `customer${id}@example.com` }),
  },
  {
    id: "accept-ai-invented-field",
    label: "AI invented extra field",
    expectedFlagged: 1,
    expectedFlaggedRows: [6],
    expectedRuleStatus: "safe",
    original: numberedRows(8, id => ({
      orderId: `ord_${id}`,
      total: id * 10,
    })),
    transformed: numberedRows(8, id => id === 6
      ? { orderId: `ord_${id}`, total: id * 10, priority: "high" }
      : { orderId: `ord_${id}`, total: id * 10 }),
  },
  {
    id: "accept-repeated-missing-field",
    label: "Repeated value missing field",
    expectedFlagged: 1,
    expectedFlaggedRows: [4],
    expectedRuleStatus: "safe",
    original: numberedRows(8, id => ({
      email: id <= 4 ? "team@example.com" : "sales@example.com",
    })),
    transformed: numberedRows(8, id => id === 4
      ? {}
      : { email: id <= 4 ? "team@example.com" : "sales@example.com" }),
  },
  {
    id: "accept-repeated-extra-field",
    label: "Repeated value extra field",
    expectedFlagged: 1,
    expectedFlaggedRows: [4],
    expectedRuleStatus: "safe",
    original: numberedRows(8, id => ({
      total: id <= 4 ? 100 : 200,
    })),
    transformed: numberedRows(8, id => id === 4
      ? { total: 100, note: "urgent" }
      : { total: id <= 4 ? 100 : 200 }),
  },
  {
    id: "accept-row-order-ambiguity",
    label: "Row order memorisation is unverifiable",
    expectedFlagged: 0,
    expectedFlaggedRows: [],
    expectedRuleStatus: "unverified",
    original: numberedRows(8, id => ({
      id,
      name: `Customer ${id}`,
    })),
    transformed: numberedRows(8, id => ({
      customerId: id,
      name: `Customer ${id}`,
    })).map((row, index, all) => {
      if (index === 3) return all[4];
      if (index === 4) return all[3];
      return row;
    }),
  },
];

export function verifySampleById(id) {
  return VERIFY_SAMPLES.find(sample => sample.id === id) || null;
}
