function pipelineLog() {
  return [
    ...Array.from({ length: 18 }, (_, index) => `2026-07-29T08:12:${String(index).padStart(2, "0")}Z INFO job ${81000 + index} completed in ${40 + index}ms`),
    "2026-07-29T08:12:19Z FATAL job 81019 rollback after 842ms table=customer_events",
    ...Array.from({ length: 6 }, (_, index) => `2026-07-29T08:12:${20 + index}Z INFO job ${81020 + index} completed in ${62 + index}ms`),
  ].join("\n");
}

function changingIdentifiers() {
  return Array.from({ length: 24 }, (_, index) =>
    `2026-07-29T09:20:${String(index).padStart(2, "0")}Z request 550e8400-e29b-41d4-a716-${String(446655440000 + index)} completed after ${20 + index}ms`
  ).join("\n");
}

function migrationReport() {
  return [
    ...Array.from({ length: 14 }, (_, index) => `row ${1000 + index}: migrated account acct_${1000 + index}`),
    "row 1014: rejected account acct_1014 because region_code is missing",
    "row 1015: rejected account acct_1015 because created_at is invalid",
    "row 1016: partial migration for account acct_1016; fallback owner applied",
    ...Array.from({ length: 5 }, (_, index) => `row ${1017 + index}: migrated account acct_${1017 + index}`),
  ].join("\n");
}

function dataContract() {
  return [
    "# Customer event contract",
    "",
    "`event_id` means the immutable identifier for one accepted event.",
    "`event_id` must be a non-empty UUID.",
    "`occurred_at` must use UTC.",
    "Payload size must be <= 256 KB.",
    "Events must not contain raw payment card data.",
    "",
    "However, replay events may override `occurred_at` when `replay_reason` is present.",
    "The decision is to retain rejected events for 30 days.",
  ].join("\n");
}

function repeatedProhibition() {
  return [
    "# Export rules",
    "Exports must use UTF-8.",
    "Customer records must not leave the approved region.",
    "Examples follow.",
    "Customer records must not leave the approved region.",
    "A reviewer shall approve each exception.",
    "Customer records must not leave the approved region.",
  ].join("\n");
}

function probableRestatement() {
  return [
    "The customer event identifier must remain stable across every retry.",
    "Retries can change delivery metadata.",
    "Every retry must preserve the stable customer event identifier.",
    "Operators should record the retry reason.",
  ].join("\n");
}

function dbtOutput() {
  return [
    "08:40:00  1 of 8 START sql table model analytics.orders",
    "08:40:01  1 of 8 OK created sql table model analytics.orders",
    "08:40:01  2 of 8 START sql view model analytics.customers",
    "08:40:02  WARN model analytics.customers uses deprecated test syntax",
    "08:40:02      at macros/tests/not_null.sql:18",
    "08:40:02  2 of 8 OK created sql view model analytics.customers",
    "08:40:03  3 of 8 START sql table model analytics.events",
    "08:40:04  3 of 8 OK created sql table model analytics.events",
  ].join("\n");
}

function uniqueProse() {
  return [
    "# Review notes",
    "",
    "The ingestion team owns the first stage of this workflow.",
    "Historical records arrive from several systems with different conventions.",
    "Analysts inspect the reconciled output during the weekly review.",
    "Some background context is retained beside the generated report.",
    "The current document describes the workflow without prescribing a change.",
    "Future discussion may refine how the teams exchange metadata.",
  ].join("\n");
}

export const SIGNAL_BENCHMARKS = [
  { id: "pipeline-fatal-template", suite: "golden", text: pipelineLog(), assertion: "fatal-top" },
  { id: "changing-identifiers-cluster", suite: "golden", text: changingIdentifiers(), assertion: "single-template" },
  { id: "migration-rejections", suite: "golden", text: migrationReport(), assertion: "rejections-visible" },
  { id: "data-contract-relations", suite: "golden", text: dataContract(), assertion: "constraints-linked" },
  { id: "repeated-prohibition", suite: "adversarial", text: repeatedProhibition(), assertion: "prohibition-visible" },
  { id: "probable-restatement", suite: "golden", text: probableRestatement(), assertion: "restatement-linked" },
  { id: "dbt-warning", suite: "real-world", text: dbtOutput(), assertion: "warning-visible" },
  { id: "unique-prose-restraint", suite: "adversarial", text: uniqueProse(), assertion: "weak-evidence" },
];

