import { parseCSV } from "../src/intelligence/data-formats/csv.js";
import { applySuggestions, hasValuableSuggestions, suggestTransformations } from "../src/intelligence/json-transform/suggestions.js";

const cases = [
  {
    id: "suppresses-single-numeric-column",
    csv: "name,price\nChair,12",
    expectedSuggestions: ["$.price:coerce-number"],
    expectedValuable: false,
  },
  {
    id: "accepts-multiple-type-fields",
    csv: "name,price,qty\nChair,12,2",
    expectedSuggestions: ["$.price:coerce-number", "$.qty:coerce-number"],
    expectedValuable: true,
    expectedOutput: { name: "Chair", price: 12, qty: 2 },
  },
  {
    id: "accepts-boolean-field",
    csv: "name,active\nAna,true",
    expectedSuggestions: ["$.active:coerce-boolean"],
    expectedValuable: true,
    expectedOutput: { name: "Ana", active: true },
  },
  {
    id: "accepts-list-field",
    csv: "name,tags\nAna,\"a, b, c\"",
    expectedSuggestions: ["$.tags:split-array"],
    expectedValuable: true,
    expectedOutput: { name: "Ana", tags: ["a", "b", "c"] },
  },
  {
    id: "suppresses-identifiers-and-contact-fields",
    csv: "id,zip,phone\n001,10115,+49 30 123456",
    expectedSuggestions: [],
    expectedValuable: false,
  },
  {
    id: "suppresses-address-looking-list",
    csv: "name,address\nAna,\"Madrid, Spain\"",
    expectedSuggestions: [],
    expectedValuable: false,
  },
  {
    id: "suppresses-date-looking-value",
    csv: "name,date\nAna,2024-01-02",
    expectedSuggestions: [],
    expectedValuable: false,
  },
  {
    id: "suppresses-one-numeric-field-across-rows",
    csv: "name,price\nChair,12\nDesk,20",
    expectedSuggestions: ["$[].price:coerce-number"],
    expectedValuable: false,
  },
];

const failures = [];

for (const test of cases) {
  const parsed = parseCSV(test.csv, { singleRowAsObject: true, coerce: false });
  const result = suggestTransformations(parsed);
  const actualSuggestions = result.suggestions.map(suggestion => `${suggestion.path}:${suggestion.type}`);
  const actualValuable = hasValuableSuggestions(result);

  if (JSON.stringify(actualSuggestions) !== JSON.stringify(test.expectedSuggestions)) {
    failures.push(`${test.id}: expected suggestions ${JSON.stringify(test.expectedSuggestions)}, got ${JSON.stringify(actualSuggestions)}.`);
  }

  if (actualValuable !== test.expectedValuable) {
    failures.push(`${test.id}: expected valuable=${test.expectedValuable}, got ${actualValuable}.`);
  }

  if (test.expectedOutput) {
    const output = applySuggestions(parsed, result.suggestions);
    if (JSON.stringify(output) !== JSON.stringify(test.expectedOutput)) {
      failures.push(`${test.id}: expected output ${JSON.stringify(test.expectedOutput)}, got ${JSON.stringify(output)}.`);
    }
  }
}

console.log(JSON.stringify({ total: cases.length, passed: cases.length - failures.length, failed: failures.length }, null, 2));

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}
