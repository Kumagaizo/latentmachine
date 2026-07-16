import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFormat, parseWithFormat, serializeWithFormat } from "../src/intelligence/data-formats/index.js";
import { runTransform } from "../src/intelligence/json-transform/translator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "fixtures", "translator");

async function readFixture(name) {
  return readFile(path.join(fixtureDir, name), "utf8");
}

function normalize(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

function assertSerialized(value, format) {
  const serialized = serializeWithFormat(value, format);
  assert.deepEqual(parseWithFormat(serialized, format), value);
  return serialized;
}

const parseCases = [
  {
    name: "kubernetes deployment yaml parses",
    file: "kubernetes-deployment.yaml",
    format: "yaml",
    run(value) {
      assert.equal(value.kind, "Deployment");
      assert.equal(value.metadata.name, "worker");
      assert.equal(value.spec.template.spec.containers[0].resources.limits.memory, "512Mi");
    },
  },
  {
    name: "kubernetes service yaml parses",
    file: "kubernetes-service.yaml",
    format: "yaml",
    run(value) {
      assert.equal(value.kind, "Service");
      assert.equal(value.spec.ports[0].targetPort, 8080);
    },
  },
  {
    name: "docker compose yaml parses",
    file: "docker-compose.yaml",
    format: "yaml",
    run(value) {
      assert.equal(value.services.api.environment.APP_ENV, "production");
      assert.equal(value.services.db.image, "postgres:16");
    },
  },
  {
    name: "github actions yaml parses",
    file: "github-actions.yaml",
    format: "yaml",
    run(value) {
      assert.equal(value.name, "Nightly");
      assert.equal(value.jobs.build["runs-on"], "ubuntu-24.04");
      assert.equal(value.jobs.build.steps[1].with["node-version"], 24);
    },
  },
  {
    name: "app config yaml preserves ambiguous strings",
    file: "app-config.yaml",
    format: "yaml",
    run(value) {
      assert.equal(value.countries.primary, "NO");
      assert.equal(value.service.released, "2024-01-15");
      assert.match(assertSerialized({ country: value.countries.primary, released: value.service.released }, "yaml"), /country: "NO"\nreleased: "2024-01-15"/);
    },
  },
  {
    name: "users csv parses",
    file: "users.csv",
    format: "csv",
    run(value) {
      assert.equal(value.length, 3);
      assert.equal(value[2].id, "300");
      assert.equal(value[2].active, true);
    },
  },
  {
    name: "api users json parses",
    file: "api-users.json",
    format: "json",
    run(value) {
      assert.equal(value.length, 2);
      assert.equal(value[0].profile.email, "ana@example.com");
    },
  },
  {
    name: "next vercel env parses",
    file: "next-vercel.env",
    format: "env",
    run(value) {
      assert.equal(value.NEXT_PUBLIC_APP_URL, "https://app.example.com/dashboard?tab=overview#team");
      assert.equal(value.NEXT_PUBLIC_FEATURES, "search,billing,teams");
      assert.equal(value.AUTH_SECRET, "spaces and # hash stay inside quotes");
      assert.equal(value.EMPTY_VALUE, "");
    },
  },
  {
    name: "docker compose env parses",
    file: "docker-compose.env",
    format: "env",
    run(value) {
      assert.equal(value.API_PORT, "8080");
      assert.equal(value.ALLOWED_ORIGINS, "http://localhost:4173,https://staging.example.com");
      assert.equal(value.WORKER_CONCURRENCY, "4");
    },
  },
  {
    name: "private key env parses",
    file: "private-key.env",
    format: "env",
    run(value) {
      assert.match(value.PRIVATE_KEY, /BEGIN TEST KEY/);
      assert.match(value.PRIVATE_KEY, /line-one\nline-two/);
      assert.equal(value.TOKEN_AUDIENCE, "https://example.com/auth#service-account");
      assert.equal(value.NOTE, "single quoted # stays literal");
      assert.match(assertSerialized({ SERVICE_ACCOUNT_EMAIL: value.SERVICE_ACCOUNT_EMAIL, NOTE: value.NOTE }, "env"), /NOTE="single quoted # stays literal"/);
    },
  },
  {
    name: "pyproject toml parses",
    file: "pyproject.toml",
    format: "toml",
    run(value) {
      assert.equal(value.project.name, "latent-config-tools");
      assert.equal(value.project.description, "Config helpers for #ops workflows.\nBuilt for small automation teams.\n");
      assert.deepEqual(value.project["optional-dependencies"].dev, ["pytest", "ruff"]);
    },
  },
  {
    name: "cargo toml parses",
    file: "Cargo.toml",
    format: "toml",
    run(value) {
      assert.equal(value.package.edition, "2021");
      assert.equal(value.dependencies.serde.version, "1.0");
      assert.equal(value.bin[0].path, "src/main.rs");
    },
  },
  {
    name: "netlify toml parses",
    file: "netlify.toml",
    format: "toml",
    run(value) {
      assert.equal(value.build.publish, "dist");
      assert.equal(value.context.production.environment.NODE_VERSION, "22");
      assert.equal(value.redirects[0].headers["X-From"], "Netlify");
    },
  },
  {
    name: "rss xml parses",
    file: "rss-feed.xml",
    format: "xml",
    run(value) {
      assert.equal(value.rss["@version"], "2.0");
      assert.equal(value.rss.channel.title, "Latentlog");
      assert.equal(value.rss.channel.item[0].guid, "post-1");
    },
  },
  {
    name: "maven pom xml parses",
    file: "maven-pom.xml",
    format: "xml",
    run(value) {
      assert.equal(value.project.groupId, "com.latentmachine");
      assert.equal(value.project.dependencies.dependency.artifactId, "core");
    },
  },
  {
    name: "android manifest xml parses",
    file: "android-manifest.xml",
    format: "xml",
    run(value) {
      assert.equal(value.manifest["@package"], "com.latentmachine.app");
      assert.equal(value.manifest.application.activity["@name"], ".MainActivity");
    },
  },
];

const transformCases = [
  {
    name: "fixture kubernetes deployment flattens to json",
    fixture: "kubernetes-deployment.yaml",
    task(input) {
      return {
        examples: [
          {
            input: "metadata:\n  name: api\n  namespace: staging\nspec:\n  template:\n    spec:\n      containers:\n        - image: registry.example.com/api:1.0\n          env:\n            - name: APP_ENV\n              value: staging\n          resources:\n            requests:\n              cpu: 100m\n            limits:\n              memory: 256Mi",
            inputFormat: "yaml",
            output: { app: "api", namespace: "staging", request_cpu: "100m", limit_memory: "256Mi" },
          },
          {
            input: "metadata:\n  name: web\n  namespace: prod\nspec:\n  template:\n    spec:\n      containers:\n        - image: registry.example.com/web:2.0\n          env:\n            - name: APP_ENV\n              value: production\n          resources:\n            requests:\n              cpu: 200m\n            limits:\n              memory: 384Mi",
            inputFormat: "yaml",
            output: { app: "web", namespace: "prod", request_cpu: "200m", limit_memory: "384Mi" },
          },
        ],
        newInput: input,
        inputFormat: "yaml",
        outputFormat: "json",
      };
    },
    expectedOutput: { app: "worker", namespace: "prod", request_cpu: "250m", limit_memory: "512Mi" },
  },
  {
    name: "fixture github actions extracts workflow metadata",
    fixture: "github-actions.yaml",
    task(input) {
      return {
        examples: [
          { input: "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20", inputFormat: "yaml", output: { workflow: "CI", runner: "ubuntu-latest", node: 20 } },
          { input: "name: Release\njobs:\n  build:\n    runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22", inputFormat: "yaml", output: { workflow: "Release", runner: "ubuntu-22.04", node: 22 } },
        ],
        newInput: input,
        inputFormat: "yaml",
        outputFormat: "json",
      };
    },
    expectedOutput: { workflow: "Nightly", runner: "ubuntu-24.04", node: 24 },
  },
  {
    name: "fixture docker compose serializes to yaml",
    fixture: "docker-compose.yaml",
    task(input) {
      return {
        examples: [
          { input: "services:\n  api:\n    image: app:1.0\n    ports:\n      - \"3000:3000\"\n    environment:\n      APP_ENV: staging", inputFormat: "yaml", output: "service:\n  name: api\n  image: app:1.0\n  port: 3000:3000\n  env: staging\n", outputFormat: "yaml" },
          { input: "services:\n  api:\n    image: app:2.0\n    ports:\n      - \"8080:8080\"\n    environment:\n      APP_ENV: production", inputFormat: "yaml", output: "service:\n  name: api\n  image: app:2.0\n  port: 8080:8080\n  env: production\n", outputFormat: "yaml" },
        ],
        newInput: input,
        inputFormat: "yaml",
        outputFormat: "yaml",
      };
    },
    expectedOutput: { service: { name: "api", image: "registry.example.com/api:3.0", port: "8080:8080", env: "production" } },
    expectedSerialized: "service:\n  name: api\n  image: registry.example.com/api:3.0\n  port: 8080:8080\n  env: production",
  },
  {
    name: "fixture users csv applies batch to json",
    fixture: "users.csv",
    task(input) {
      return {
        examples: [
          { input: "id,name,email,role,active\n100,Ana Lopez,ana@example.com,admin,true", inputFormat: "csv", output: { user: "Ana Lopez", email: "ana@example.com", access: "admin", enabled: true } },
          { input: "id,name,email,role,active\n200,Bo Smith,bo@example.com,viewer,false", inputFormat: "csv", output: { user: "Bo Smith", email: "bo@example.com", access: "viewer", enabled: false } },
        ],
        newInput: input,
        inputFormat: "csv",
        outputFormat: "json",
      };
    },
    expectedOutput: [
      { user: "Ana Lopez", email: "ana@example.com", access: "admin", enabled: true },
      { user: "Bo Smith", email: "bo@example.com", access: "viewer", enabled: false },
      { user: "Tim Berg", email: "tim@example.com", access: "editor", enabled: true },
    ],
  },
  {
    name: "fixture api json applies batch to csv",
    fixture: "api-users.json",
    task(input) {
      return {
        examples: [
          { input: { id: "u001", profile: { name: "Ana Lopez", email: "ana@example.com" }, plan: "pro", active: true }, output: "id,name,email,plan,enabled\nu001,Ana Lopez,ana@example.com,pro,true", outputFormat: "csv" },
          { input: { id: "u002", profile: { name: "Bo Smith", email: "bo@example.com" }, plan: "starter", active: false }, output: "id,name,email,plan,enabled\nu002,Bo Smith,bo@example.com,starter,false", outputFormat: "csv" },
        ],
        newInput: input,
        inputFormat: "json",
        outputFormat: "csv",
      };
    },
    expectedOutput: [
      { id: "u100", name: "Ana Lopez", email: "ana@example.com", plan: "pro", enabled: true },
      { id: "u200", name: "Bo Smith", email: "bo@example.com", plan: "starter", enabled: false },
    ],
    expectedSerialized: "id,name,email,plan,enabled\nu100,Ana Lopez,ana@example.com,pro,true\nu200,Bo Smith,bo@example.com,starter,false",
  },
  {
    name: "fixture next vercel env extracts public config",
    fixture: "next-vercel.env",
    task(input) {
      return {
        examples: [
          {
            input: "NEXT_PUBLIC_APP_URL=https://staging.example.com/app#main\nNEXT_PUBLIC_FEATURES=search,teams\nVERCEL_ENV=preview",
            inputFormat: "env",
            output: { url: "https://staging.example.com/app#main", features: "search,teams", environment: "preview" },
          },
          {
            input: "NEXT_PUBLIC_APP_URL=https://app.example.com/dashboard#home\nNEXT_PUBLIC_FEATURES=search,billing\nVERCEL_ENV=production",
            inputFormat: "env",
            output: { url: "https://app.example.com/dashboard#home", features: "search,billing", environment: "production" },
          },
        ],
        newInput: input,
        inputFormat: "env",
        outputFormat: "json",
      };
    },
    expectedOutput: {
      url: "https://app.example.com/dashboard?tab=overview#team",
      features: "search,billing,teams",
      environment: "production",
    },
  },
  {
    name: "fixture docker compose env serializes runtime env",
    fixture: "docker-compose.env",
    task(input) {
      return {
        examples: [
          {
            input: "APP_ENV=development\nAPI_PORT=3000\nAPI_BASE_URL=http://api:3000/v1\nLOG_LEVEL=info",
            inputFormat: "env",
            output: "NODE_ENV=development\nPORT=3000\nAPI_URL=http://api:3000/v1\nLOG_LEVEL=info\n",
            outputFormat: "env",
          },
          {
            input: "APP_ENV=production\nAPI_PORT=8080\nAPI_BASE_URL=https://api.example.com/v1\nLOG_LEVEL=warn",
            inputFormat: "env",
            output: "NODE_ENV=production\nPORT=8080\nAPI_URL=https://api.example.com/v1\nLOG_LEVEL=warn\n",
            outputFormat: "env",
          },
        ],
        newInput: input,
        inputFormat: "env",
        outputFormat: "env",
      };
    },
    expectedOutput: {
      NODE_ENV: "staging",
      PORT: "8080",
      API_URL: "http://api:8080/v1",
      LOG_LEVEL: "debug",
    },
    expectedSerialized: "NODE_ENV=staging\nPORT=8080\nAPI_URL=http://api:8080/v1\nLOG_LEVEL=debug",
  },
  {
    name: "fixture netlify toml extracts deployment config",
    fixture: "netlify.toml",
    task(input) {
      return {
        examples: [
          {
            input: "[build]\ncommand = \"npm run build\"\npublish = \"dist\"\n[context.production.environment]\nNODE_VERSION = \"20\"\nENABLE_CHECKER = false\n[[redirects]]\nfrom = \"/api/*\"\nto = \"https://staging-api.example.com/:splat\"\nstatus = 200",
            inputFormat: "toml",
            output: { build: "npm run build", publish: "dist", node: "20", checker: false, redirect_to: "https://staging-api.example.com/:splat" },
          },
          {
            input: "[build]\ncommand = \"npm run export\"\npublish = \"out\"\n[context.production.environment]\nNODE_VERSION = \"22\"\nENABLE_CHECKER = true\n[[redirects]]\nfrom = \"/api/*\"\nto = \"https://api.example.com/:splat\"\nstatus = 200",
            inputFormat: "toml",
            output: { build: "npm run export", publish: "out", node: "22", checker: true, redirect_to: "https://api.example.com/:splat" },
          },
        ],
        newInput: input,
        inputFormat: "toml",
        outputFormat: "json",
      };
    },
    expectedOutput: {
      build: "npm run build",
      publish: "dist",
      node: "22",
      checker: true,
      redirect_to: "https://api.example.com/:splat",
    },
  },
  {
    name: "fixture maven pom xml extracts package metadata",
    fixture: "maven-pom.xml",
    task(input) {
      return {
        examples: [
          {
            input: "<project><groupId>com.example</groupId><artifactId>api</artifactId><version>1.0.0</version><dependencies><dependency><artifactId>core</artifactId><version>2.0.0</version></dependency></dependencies></project>",
            inputFormat: "xml",
            output: { group: "com.example", artifact: "api", version: "1.0.0", dependency: "core", dependency_version: "2.0.0" },
          },
          {
            input: "<project><groupId>org.demo</groupId><artifactId>web</artifactId><version>2.1.0</version><dependencies><dependency><artifactId>shared</artifactId><version>3.0.0</version></dependency></dependencies></project>",
            inputFormat: "xml",
            output: { group: "org.demo", artifact: "web", version: "2.1.0", dependency: "shared", dependency_version: "3.0.0" },
          },
        ],
        newInput: input,
        inputFormat: "xml",
        outputFormat: "json",
      };
    },
    expectedOutput: {
      group: "com.latentmachine",
      artifact: "xml-tools",
      version: "1.2.0",
      dependency: "core",
      dependency_version: "3.1.4",
    },
  },
];

const results = [];

for (const testCase of parseCases) {
  try {
    const text = await readFixture(testCase.file);
    assert.equal(detectFormat(text), testCase.format);
    testCase.run(parseWithFormat(text, testCase.format));
    results.push({ name: testCase.name, passed: true });
  } catch (error) {
    results.push({ name: testCase.name, passed: false, error: error?.message || "Unknown error" });
  }
}

for (const testCase of transformCases) {
  try {
    const input = await readFixture(testCase.fixture);
    const result = runTransform(testCase.task(input));
    assert.deepEqual(result.output, testCase.expectedOutput);
    if (testCase.expectedSerialized) {
      assert.equal(normalize(result.serializedOutput), normalize(testCase.expectedSerialized));
    } else {
      assert.deepEqual(parseWithFormat(result.serializedOutput, result.outputFormat), testCase.expectedOutput);
    }
    results.push({ name: testCase.name, passed: true });
  } catch (error) {
    results.push({ name: testCase.name, passed: false, error: error?.message || "Unknown error" });
  }
}

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(result => result.name) }, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.name}: ${result.error}`).join("\n"));
  process.exit(1);
}
