import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  detectFormat,
  detectXML,
  parseXML,
  serializeXML,
} from "../src/intelligence/data-formats/index.js";
import { runTransform } from "../src/intelligence/json-transform/index.js";

function roundTrip(value) {
  return parseXML(serializeXML(value));
}

const fixtureDir = new URL("../fixtures/translator/", import.meta.url);
const [rss, pom, manifest] = await Promise.all([
  readFile(new URL("rss-feed.xml", fixtureDir), "utf8"),
  readFile(new URL("maven-pom.xml", fixtureDir), "utf8"),
  readFile(new URL("android-manifest.xml", fixtureDir), "utf8"),
]);

const cases = [
  ["detects xml declaration", () => assert.equal(detectFormat("<?xml version=\"1.0\"?><root/>"), "xml")],
  ["detects html-like fragment", () => assert.equal(detectXML("<section><h1>Hi</h1></section>"), true)],
  ["does not detect comparison text", () => assert.equal(detectXML("1 < 2 and 3 > 2"), false)],
  ["attributes use at-prefix", () => assert.deepEqual(parseXML("<user id=\"1\" role=\"admin\"><name>Ana</name></user>"), { user: { "@id": "1", "@role": "admin", name: "Ana" } })],
  ["repeated siblings become arrays", () => assert.deepEqual(parseXML("<root><item>A</item><item>B</item><single>C</single></root>"), { root: { item: ["A", "B"], single: "C" } })],
  ["mixed content uses text key", () => assert.deepEqual(parseXML("<p>Hello <em>world</em></p>"), { p: { em: "world", "#text": "Hello " } })],
  ["cdata is plain text", () => assert.deepEqual(parseXML("<script><![CDATA[if (a < b) run();]]></script>"), { script: "if (a < b) run();" })],
  ["standard and numeric entities decode", () => assert.deepEqual(parseXML("<root>&lt;tag&gt; &amp; &#65; &#x42;</root>"), { root: "<tag> & A B" })],
  ["namespace prefixes and xmlns declarations are stripped", () => assert.deepEqual(parseXML("<atom:entry xmlns:atom=\"urn\"><atom:title>Post</atom:title></atom:entry>"), { entry: { title: "Post" } })],
  ["self-closing elements become null", () => assert.deepEqual(parseXML("<root><empty/><meta key=\"x\"/></root>"), { root: { empty: null, meta: { "@key": "x" } } })],
  ["malformed nesting reports line and expected tag", () => assert.throws(() => parseXML("<root>\n  <name>Ana</root>"), /line 2, column .*expected <\/name>/i)],
  ["round trip preserves attributes and arrays", () => assert.deepEqual(roundTrip({ feed: { "@version": "2.0", item: [{ title: "A" }, { title: "B" }] } }), { feed: { "@version": "2.0", item: [{ title: "A" }, { title: "B" }] } })],
  ["rss fixture parses repeated items", () => {
    const parsed = parseXML(rss);
    assert.equal(parsed.rss["@version"], "2.0");
    assert.equal(parsed.rss.channel.item[1].category, "verification");
  }],
  ["maven pom fixture parses dependencies", () => {
    const parsed = parseXML(pom);
    assert.equal(parsed.project.artifactId, "xml-tools");
    assert.equal(parsed.project.dependencies.dependency.version, "3.1.4");
  }],
  ["android manifest fixture strips android attributes", () => {
    const parsed = parseXML(manifest);
    assert.equal(parsed.manifest["@package"], "com.latentmachine.app");
    assert.equal(parsed.manifest.application["@label"], "Latentmachine");
    assert.equal(parsed.manifest.application.activity["@exported"], "true");
  }],
  ["xml translates through wrapper", () => assert.deepEqual(runTransform({
    examples: [
      { input: "<order id=\"o1\"><customer>Ana</customer><total>119.50</total></order>", inputFormat: "xml", output: { order_id: "o1", customer: "Ana", total: 119.5 } },
      { input: "<order id=\"o2\"><customer>Bo</customer><total>59.00</total></order>", inputFormat: "xml", output: { order_id: "o2", customer: "Bo", total: 59 } },
    ],
    newInput: "<order id=\"o3\"><customer>Tim</customer><total>240.75</total></order>",
    inputFormat: "xml",
    outputFormat: "json",
  }).output, { order_id: "o3", customer: "Tim", total: 240.75 })],
];

const results = cases.map(([name, run]) => {
  try {
    run();
    return { name, passed: true };
  } catch (error) {
    return { name, passed: false, error: error?.message || "Unknown error" };
  }
});

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(result => result.name) }, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.name}: ${result.error}`).join("\n"));
  process.exit(1);
}
