import {
  generateJqQuery,
  generateJsonPath,
  runTransform,
} from "../src/intelligence/json-transform/index.js";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected an unsupported jq export error`);
}

const cases = [
  {
    id: "single-path",
    program: { ops: [{ op: "set", source: "$.users[0].email", target: "$" }] },
    jq: ".users[0].email",
    jsonPath: "$.users[0].email",
  },
  {
    id: "array-map",
    program: { ops: [{ op: "arrayMap", source: "$.users", extract: "$.email", target: "$" }] },
    jq: "[.users[] | .email]",
    jsonPath: "$.users[*].email",
  },
  {
    id: "array-filter-map",
    program: { ops: [{ op: "arrayMap", source: "$.users", where: { path: "$.active", equals: true }, extract: "$.email", target: "$" }] },
    jq: "[.users[] | select(.active == true) | .email]",
    jsonPath: "$.users[?(@.active == true)].email",
  },
  {
    id: "object-wrapper",
    program: { ops: [{ op: "arrayMap", source: "$.users", where: { path: "$.active", equals: true }, extract: "$.email", target: "$.emails" }] },
    jq: "{emails: [.users[] | select(.active == true) | .email]}",
    jsonPath: null,
  },
  {
    id: "array-project",
    program: { ops: [{ op: "arrayProject", source: "$.users", fields: [{ source: "$.email", target: "$.mail" }], target: "$.contacts" }] },
    jq: "{contacts: [.users[] | {mail: .email}]}",
    jsonPath: null,
  },
  {
    id: "array-count-filtered",
    program: { ops: [{ op: "arrayCount", source: "$.users", where: { path: "$.active", equals: true }, target: "$.activeCount" }] },
    jq: "{activeCount: ([.users[] | select(.active == true)] | length)}",
    jsonPath: null,
  },
  {
    id: "array-join",
    program: { ops: [{ op: "arrayJoin", source: "$.users", extract: "$.email", separator: ", ", target: "$.emails" }] },
    jq: "{emails: ([.users[] | .email] | join(\", \"))}",
    jsonPath: null,
  },
  {
    id: "array-find",
    program: { ops: [{ op: "arrayFind", source: "$.emails", where: { path: "$.type", equals: "work" }, extract: "$.value", target: "$.workEmail" }] },
    jq: "{workEmail: first(.emails[] | select(.type == \"work\") | .value)}",
    jsonPath: null,
  },
];

for (const item of cases) {
  assertEqual(generateJqQuery(item.program), item.jq, `${item.id} jq`);
  assertEqual(generateJsonPath(item.program), item.jsonPath, `${item.id} JSONPath`);
}

assertThrows(
  () => generateJqQuery({ ops: [{ op: "coerce", source: "$.age", to: "number", target: "$.age" }] }),
  "unsupported coerce"
);

const input = { users: [{ email: "ada@example.com", active: true }, { email: "grace@example.com", active: false }] };
const output = { emails: ["ada@example.com"] };
const result = runTransform({ examples: [{ input, output }] });
const candidate = result.diagnosis?.candidates?.[0]?.candidates?.find(row => row.program?.op === "arrayMap" && row.program?.where);
if (!candidate) throw new Error("reshape candidate did not expose a filtered arrayMap jq-exportable program");
assertEqual(
  generateJqQuery({ ops: [candidate.program] }),
  "{emails: [.users[] | select(.active == true) | .email]}",
  "filtered reshape candidate jq"
);

console.log(JSON.stringify({ total: cases.length + 2, passed: cases.length + 2 }, null, 2));
