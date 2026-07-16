import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/trace");
await mkdir(root, { recursive: true });

async function write(name, value) {
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(root, name), content, "utf8");
}

const customers = ["customer_id,plan,country,monthly_spend,orders,last_seen,marketing_opt_in"];
for (let index = 0; index < 1000; index += 1) {
  const id = `C-${String(index + 1).padStart(4, "0")}`;
  const plan = ["Starter", "Pro", "Team"][index % 3];
  const country = index % 10 < 6 ? "DE" : index % 10 < 8 ? "NL" : index % 10 === 8 ? "FR" : "BE";
  const spend = index === 777 ? "not-recorded" : index % 40 === 0 ? "" : 29 + (index % 12) * 10;
  customers.push([id, plan, country, spend, index % 28, `2026-06-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`, index % 3 !== 0].join(","));
}
await write("customer-export.csv", `${customers.join("\n")}\n`);

const telemetry = [];
let minute = 0;
for (let index = 0; index < 240; index += 1) {
  if (index === 160) minute += 360;
  const timestamp = new Date(Date.UTC(2026, 5, 1, 0, minute)).toISOString();
  telemetry.push({
    timestamp,
    service: index % 4 ? "api" : "worker",
    latency_ms: index === 41 ? 1800 : index === 211 ? 2400 : 80 + (index % 17) * 4,
    requests: 900 + (index % 31) * 7,
    healthy: index !== 41 && index !== 211,
  });
  minute += 5;
}
await write("telemetry-series.json", telemetry);

const categories = ["category,amount"];
const longTail = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
for (let index = 0; index < 240; index += 1) {
  const category = index < 150 ? "core" : index < 195 ? "secondary" : longTail[(index - 195) % longTail.length];
  categories.push(`${category},${10 + (index % 9)}`);
}
await write("category-long-tail.csv", `${categories.join("\n")}\n`);

const large = ["record_id,segment,value,tail_pattern"];
for (let index = 0; index < 60000; index += 1) {
  large.push(`R-${String(index).padStart(5, "0")},${index % 5 === 0 ? "priority" : "standard"},${index % 1000},${index >= 59000 ? "tail" : "body"}`);
}
await write("large-sampled.csv", `${large.join("\n")}\n`);

const reorderedA = Array.from({ length: 30 }, (_, index) => ({ id: `R-${index}`, value: index, group: index % 3 }));
await write("compare-reordered-a.json", reorderedA);
await write("compare-reordered-b.json", [...reorderedA].reverse());

const keyedA = Array.from({ length: 25 }, (_, index) => ({ id: index < 2 ? "duplicate" : `R-${index}`, value: index, state: "active" }));
const keyedB = keyedA.slice(1).map(row => row.id === "R-8" ? { ...row, value: 88 } : row).concat({ id: "R-25", value: 25, state: "new" });
await write("compare-keyed-rows-a.json", keyedA);
await write("compare-keyed-rows-b.json", keyedB);

const distributionA = Array.from({ length: 80 }, (_, index) => ({ id: `R-${index}`, value: 20 + (index % 11), category: index % 4 ? "common" : "secondary" }));
const distributionB = distributionA.map((row, index) => ({ ...row, value: row.value + 50 + (index % 5), category: index % 5 ? "common" : "new-category" }));
await write("compare-distribution-a.json", distributionA);
await write("compare-distribution-b.json", distributionB);

const missingnessA = Array.from({ length: 50 }, (_, index) => ({ id: `R-${index}`, ...(index < 5 ? {} : { note: "present" }) }));
const missingnessB = Array.from({ length: 50 }, (_, index) => ({ id: `R-${index}`, ...(index < 15 ? {} : { note: "present" }) }));
await write("compare-missingness-a.json", missingnessA);
await write("compare-missingness-b.json", missingnessB);

const toleranceA = Array.from({ length: 24 }, (_, index) => ({ id: `R-${index}`, measurement: 100 + index }));
const toleranceB = toleranceA.map(row => ({ ...row, measurement: row.measurement + 0.005 }));
await write("compare-tolerance-a.json", toleranceA);
await write("compare-tolerance-b.json", toleranceB);

console.log("Generated deterministic Trace product fixtures.");
