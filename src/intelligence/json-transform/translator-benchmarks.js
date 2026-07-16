import { parseYAML } from "../data-formats/index.js";
import { runTransform } from "./translator.js";

export const TRANSLATOR_BENCHMARKS = [
  {
    id: "env-to-json",
    suite: "translator-env",
    category: "env-to-json",
    examples: [
      { input: "APP_NAME=api\nAPP_ENV=production\nPORT=3000", inputFormat: "env", output: { app: "api", environment: "production", port: 3000 } },
      { input: "APP_NAME=web\nAPP_ENV=staging\nPORT=8080", inputFormat: "env", output: { app: "web", environment: "staging", port: 8080 } },
    ],
    newInput: "APP_NAME=worker\nAPP_ENV=production\nPORT=9000",
    inputFormat: "env",
    outputFormat: "json",
    expectedOutput: { app: "worker", environment: "production", port: 9000 },
    expectedSerializedOutput: "{\n  \"app\": \"worker\",\n  \"environment\": \"production\",\n  \"port\": 9000\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "json-to-env",
    suite: "translator-env",
    category: "json-to-env",
    examples: [
      { input: { app: "api", environment: "production", port: 3000 }, output: "APP_NAME=api\nAPP_ENV=production\nPORT=3000\n", outputFormat: "env" },
      { input: { app: "web", environment: "staging", port: 8080 }, output: "APP_NAME=web\nAPP_ENV=staging\nPORT=8080\n", outputFormat: "env" },
    ],
    newInput: { app: "worker", environment: "production", port: 9000 },
    outputFormat: "env",
    expectedOutput: { APP_NAME: "worker", APP_ENV: "production", PORT: "9000" },
    expectedSerializedOutput: "APP_NAME=worker\nAPP_ENV=production\nPORT=9000\n",
    expectedOutputFormat: "env",
    minConfidence: 0.75,
  },
  {
    id: "env-to-csv",
    suite: "translator-env",
    category: "env-to-csv",
    examples: [
      { input: "APP_NAME=api\nAPP_ENV=production", inputFormat: "env", output: "service,environment\napi,production", outputFormat: "csv" },
      { input: "APP_NAME=web\nAPP_ENV=staging", inputFormat: "env", output: "service,environment\nweb,staging", outputFormat: "csv" },
    ],
    newInput: "APP_NAME=worker\nAPP_ENV=production",
    inputFormat: "env",
    outputFormat: "csv",
    expectedOutput: { service: "worker", environment: "production" },
    expectedSerializedOutput: "service,environment\nworker,production",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "toml-config-to-json",
    suite: "translator-toml",
    category: "toml-to-json",
    examples: [
      { input: "[service]\nname = \"api\"\nport = 3000\n[database]\nhost = \"stage-db.internal\"", inputFormat: "toml", output: { app: "api", port: 3000, database_host: "stage-db.internal" } },
      { input: "[service]\nname = \"web\"\nport = 8080\n[database]\nhost = \"prod-db.internal\"", inputFormat: "toml", output: { app: "web", port: 8080, database_host: "prod-db.internal" } },
    ],
    newInput: "[service]\nname = \"worker\"\nport = 9000\n[database]\nhost = \"jobs-db.internal\"",
    inputFormat: "toml",
    outputFormat: "json",
    expectedOutput: { app: "worker", port: 9000, database_host: "jobs-db.internal" },
    expectedSerializedOutput: "{\n  \"app\": \"worker\",\n  \"port\": 9000,\n  \"database_host\": \"jobs-db.internal\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "json-to-toml-config",
    suite: "translator-toml",
    category: "json-to-toml",
    examples: [
      { input: { app: "api", port: 3000, database_host: "stage-db.internal" }, output: "[service]\nname = \"api\"\nport = 3000\n\n[database]\nhost = \"stage-db.internal\"\n", outputFormat: "toml" },
      { input: { app: "web", port: 8080, database_host: "prod-db.internal" }, output: "[service]\nname = \"web\"\nport = 8080\n\n[database]\nhost = \"prod-db.internal\"\n", outputFormat: "toml" },
    ],
    newInput: { app: "worker", port: 9000, database_host: "jobs-db.internal" },
    outputFormat: "toml",
    expectedOutput: { service: { name: "worker", port: 9000 }, database: { host: "jobs-db.internal" } },
    expectedSerializedOutput: "[service]\nname = \"worker\"\nport = 9000\n\n[database]\nhost = \"jobs-db.internal\"\n",
    expectedOutputFormat: "toml",
    minConfidence: 0.75,
  },
  {
    id: "toml-service-to-csv",
    suite: "translator-toml",
    category: "toml-to-csv",
    examples: [
      { input: "[service]\nname = \"api\"\nport = 3000", inputFormat: "toml", output: "service,port\napi,3000", outputFormat: "csv" },
      { input: "[service]\nname = \"web\"\nport = 8080", inputFormat: "toml", output: "service,port\nweb,8080", outputFormat: "csv" },
    ],
    newInput: "[service]\nname = \"worker\"\nport = 9000",
    inputFormat: "toml",
    outputFormat: "csv",
    expectedOutput: { service: "worker", port: 9000 },
    expectedSerializedOutput: "service,port\nworker,9000",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xml-user-to-json",
    suite: "translator-xml",
    category: "xml-to-json",
    examples: [
      { input: "<user id=\"1\"><name>Ana</name><role>admin</role></user>", inputFormat: "xml", output: { id: "1", person: "Ana", access: "admin" } },
      { input: "<user id=\"2\"><name>Bo</name><role>viewer</role></user>", inputFormat: "xml", output: { id: "2", person: "Bo", access: "viewer" } },
    ],
    newInput: "<user id=\"3\"><name>Tim</name><role>editor</role></user>",
    inputFormat: "xml",
    outputFormat: "json",
    expectedOutput: { id: "3", person: "Tim", access: "editor" },
    expectedSerializedOutput: "{\n  \"id\": \"3\",\n  \"person\": \"Tim\",\n  \"access\": \"editor\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "json-to-xml-user",
    suite: "translator-xml",
    category: "json-to-xml",
    examples: [
      { input: { id: "1", person: "Ana", access: "admin" }, output: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<user id=\"1\">\n  <name>Ana</name>\n  <role>admin</role>\n</user>\n", outputFormat: "xml" },
      { input: { id: "2", person: "Bo", access: "viewer" }, output: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<user id=\"2\">\n  <name>Bo</name>\n  <role>viewer</role>\n</user>\n", outputFormat: "xml" },
    ],
    newInput: { id: "3", person: "Tim", access: "editor" },
    outputFormat: "xml",
    expectedOutput: { user: { "@id": "3", name: "Tim", role: "editor" } },
    expectedSerializedOutput: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<user id=\"3\">\n  <name>Tim</name>\n  <role>editor</role>\n</user>\n",
    expectedOutputFormat: "xml",
    minConfidence: 0.75,
  },
  {
    id: "xml-order-to-csv",
    suite: "translator-xml",
    category: "xml-to-csv",
    examples: [
      { input: "<order id=\"o1\"><customer>Ana</customer><total>119.50</total></order>", inputFormat: "xml", output: "order_id,customer,total\no1,Ana,119.50", outputFormat: "csv" },
      { input: "<order id=\"o2\"><customer>Bo</customer><total>59.00</total></order>", inputFormat: "xml", output: "order_id,customer,total\no2,Bo,59.00", outputFormat: "csv" },
    ],
    newInput: "<order id=\"o3\"><customer>Tim</customer><total>240.75</total></order>",
    inputFormat: "xml",
    outputFormat: "csv",
    expectedOutput: { order_id: "o3", customer: "Tim", total: 240.75 },
    expectedSerializedOutput: "order_id,customer,total\no3,Tim,240.75",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "yaml-flat-to-json",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "name: Ana\nage: 28\ncity: Berlin", inputFormat: "yaml", output: { person: "Ana", years: 28, location: "Berlin" } },
      { input: "name: Bo\nage: 31\ncity: Seoul", inputFormat: "yaml", output: { person: "Bo", years: 31, location: "Seoul" } },
    ],
    newInput: "name: Tim\nage: 44\ncity: Austin",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { person: "Tim", years: 44, location: "Austin" },
    expectedSerializedOutput: "{\n  \"person\": \"Tim\",\n  \"years\": 44,\n  \"location\": \"Austin\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-nested-to-flat",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "user:\n  name: Ana\n  role: admin\norg: Acme", inputFormat: "yaml", output: { name: "Ana", role: "admin", company: "Acme" } },
      { input: "user:\n  name: Bo\n  role: viewer\norg: Nova", inputFormat: "yaml", output: { name: "Bo", role: "viewer", company: "Nova" } },
    ],
    newInput: "user:\n  name: Tim\n  role: editor\norg: Orbit Works",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { name: "Tim", role: "editor", company: "Orbit Works" },
    expectedSerializedOutput: "{\n  \"name\": \"Tim\",\n  \"role\": \"editor\",\n  \"company\": \"Orbit Works\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-to-csv",
    suite: "translator-yaml",
    category: "yaml-to-csv",
    examples: [
      { input: "name: Ana\nemail: ana@test.com", inputFormat: "yaml", output: "person,email\nAna,ana@test.com", outputFormat: "csv" },
      { input: "name: Bo\nemail: bo@test.com", inputFormat: "yaml", output: "person,email\nBo,bo@test.com", outputFormat: "csv" },
    ],
    newInput: "name: Tim\nemail: tim@test.com",
    inputFormat: "yaml",
    outputFormat: "csv",
    expectedOutput: { person: "Tim", email: "tim@test.com" },
    expectedSerializedOutput: "person,email\nTim,tim@test.com",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "json-to-yaml-flat",
    suite: "translator-yaml",
    category: "json-to-yaml",
    examples: [
      { input: { name: "Ana", age: 28 }, output: "person: Ana\nyears: 28\n", outputFormat: "yaml" },
      { input: { name: "Bo", age: 31 }, output: "person: Bo\nyears: 31\n", outputFormat: "yaml" },
    ],
    newInput: { name: "Tim", age: 44 },
    outputFormat: "yaml",
    expectedOutput: { person: "Tim", years: 44 },
    expectedSerializedOutput: "person: Tim\nyears: 44\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "csv-to-yaml",
    suite: "translator-yaml",
    category: "csv-to-yaml",
    examples: [
      { input: "name,email\nAna,ana@test.com", inputFormat: "csv", output: "person: Ana\nemail: ana@test.com\n", outputFormat: "yaml" },
      { input: "name,email\nBo,bo@test.com", inputFormat: "csv", output: "person: Bo\nemail: bo@test.com\n", outputFormat: "yaml" },
    ],
    newInput: "name,email\nTim,tim@test.com",
    inputFormat: "csv",
    outputFormat: "yaml",
    expectedOutput: { person: "Tim", email: "tim@test.com" },
    expectedSerializedOutput: "person: Tim\nemail: tim@test.com\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "yaml-to-yaml-rename",
    suite: "translator-yaml",
    category: "yaml-to-yaml",
    examples: [
      { input: "first_name: Ana\nlast_name: Lopez", inputFormat: "yaml", output: "firstName: Ana\nlastName: Lopez\n", outputFormat: "yaml" },
      { input: "first_name: Bo\nlast_name: Smith", inputFormat: "yaml", output: "firstName: Bo\nlastName: Smith\n", outputFormat: "yaml" },
    ],
    newInput: "first_name: Tim\nlast_name: Berg",
    inputFormat: "yaml",
    outputFormat: "yaml",
    expectedOutput: { firstName: "Tim", lastName: "Berg" },
    expectedSerializedOutput: "firstName: Tim\nlastName: Berg\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "yaml-norway-safe",
    suite: "translator-yaml",
    category: "adversarial",
    examples: [
      { input: "country: US\nname: United States", inputFormat: "yaml", output: { code: "US", label: "United States" } },
      { input: "country: DE\nname: Germany", inputFormat: "yaml", output: { code: "DE", label: "Germany" } },
    ],
    newInput: "country: NO\nname: Norway",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { code: "NO", label: "Norway" },
    expectedSerializedOutput: "{\n  \"code\": \"NO\",\n  \"label\": \"Norway\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-booleans-correct",
    suite: "translator-yaml",
    category: "adversarial",
    examples: [
      { input: "active: true\nname: Ana", inputFormat: "yaml", output: { isActive: true, person: "Ana" } },
      { input: "active: false\nname: Bo", inputFormat: "yaml", output: { isActive: false, person: "Bo" } },
    ],
    newInput: "active: true\nname: Tim",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { isActive: true, person: "Tim" },
    expectedSerializedOutput: "{\n  \"isActive\": true,\n  \"person\": \"Tim\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-yes-no-strings",
    suite: "translator-yaml",
    category: "adversarial",
    examples: [
      { input: "flag: yes\nname: Ana", inputFormat: "yaml", output: { flag: "yes", person: "Ana" } },
      { input: "flag: no\nname: Bo", inputFormat: "yaml", output: { flag: "no", person: "Bo" } },
    ],
    newInput: "flag: on\nname: Tim",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { flag: "on", person: "Tim" },
    expectedSerializedOutput: "{\n  \"flag\": \"on\",\n  \"person\": \"Tim\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-octal-safe",
    suite: "translator-yaml",
    category: "adversarial",
    examples: [
      { input: "permissions: 0644\npath: /etc/config", inputFormat: "yaml", output: { perms: 644, file: "/etc/config" } },
      { input: "permissions: 0755\npath: /usr/bin", inputFormat: "yaml", output: { perms: 755, file: "/usr/bin" } },
    ],
    newInput: "permissions: 0777\npath: /tmp",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { perms: 777, file: "/tmp" },
    expectedSerializedOutput: "{\n  \"perms\": 777,\n  \"file\": \"/tmp\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-version-string",
    suite: "translator-yaml",
    category: "adversarial",
    examples: [
      { input: "version: 1.2.3\nname: api", inputFormat: "yaml", output: { app: "api", version: "1.2.3" } },
      { input: "version: 2.5.0\nname: web", inputFormat: "yaml", output: { app: "web", version: "2.5.0" } },
    ],
    newInput: "version: 9.5.25\nname: worker",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { app: "worker", version: "9.5.25" },
    expectedSerializedOutput: "{\n  \"app\": \"worker\",\n  \"version\": \"9.5.25\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-multiline-literal",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "name: Ana\nbio: |\n  Line one\n  Line two", inputFormat: "yaml", output: { person: "Ana", description: "Line one\nLine two\n" } },
      { input: "name: Bo\nbio: |\n  Hello\n  World", inputFormat: "yaml", output: { person: "Bo", description: "Hello\nWorld\n" } },
    ],
    newInput: "name: Tim\nbio: |\n  First\n  Second",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { person: "Tim", description: "First\nSecond\n" },
    expectedSerializedOutput: "{\n  \"person\": \"Tim\",\n  \"description\": \"First\\nSecond\\n\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-anchors-resolved",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "defaults: &defaults\n  timeout: 30\nserver:\n  <<: *defaults\n  name: prod", inputFormat: "yaml", output: { serverName: "prod", timeout: 30 } },
      { input: "defaults: &defaults\n  timeout: 60\nserver:\n  <<: *defaults\n  name: staging", inputFormat: "yaml", output: { serverName: "staging", timeout: 60 } },
    ],
    newInput: "defaults: &defaults\n  timeout: 45\nserver:\n  <<: *defaults\n  name: dev",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { serverName: "dev", timeout: 45 },
    expectedSerializedOutput: "{\n  \"serverName\": \"dev\",\n  \"timeout\": 45\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-k8s-deployment-flatten",
    suite: "translator-yaml",
    category: "real-world",
    examples: [
      { input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: prod\nspec:\n  replicas: 3", inputFormat: "yaml", output: { name: "web", namespace: "prod", replicas: 3 } },
      { input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n  namespace: staging\nspec:\n  replicas: 1", inputFormat: "yaml", output: { name: "api", namespace: "staging", replicas: 1 } },
    ],
    newInput: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: worker\n  namespace: prod\nspec:\n  replicas: 5",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { name: "worker", namespace: "prod", replicas: 5 },
    expectedSerializedOutput: "{\n  \"name\": \"worker\",\n  \"namespace\": \"prod\",\n  \"replicas\": 5\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-comments-stripped",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "name: Ana # owner\nteam: ops", inputFormat: "yaml", output: { owner: "Ana", team: "ops" } },
      { input: "name: Bo # owner\nteam: data", inputFormat: "yaml", output: { owner: "Bo", team: "data" } },
    ],
    newInput: "name: Tim # owner\nteam: product",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { owner: "Tim", team: "product" },
    expectedSerializedOutput: "{\n  \"owner\": \"Tim\",\n  \"team\": \"product\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-document-marker",
    suite: "translator-yaml",
    category: "yaml-to-json",
    examples: [
      { input: "---\nname: Ana\nrole: admin", inputFormat: "yaml", output: { person: "Ana", access: "admin" } },
      { input: "---\nname: Bo\nrole: viewer", inputFormat: "yaml", output: { person: "Bo", access: "viewer" } },
    ],
    newInput: "---\nname: Tim\nrole: editor",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { person: "Tim", access: "editor" },
    expectedSerializedOutput: "{\n  \"person\": \"Tim\",\n  \"access\": \"editor\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-sequence-batch-to-json",
    suite: "translator-yaml",
    category: "yaml-batch",
    examples: [
      { input: "name: Ana\nemail: ANA@EXAMPLE.COM\nrole: admin", inputFormat: "yaml", output: { person: "Ana", email: "ana@example.com", access: "admin" } },
      { input: "name: Bo\nemail: BO@EXAMPLE.COM\nrole: viewer", inputFormat: "yaml", output: { person: "Bo", email: "bo@example.com", access: "viewer" } },
    ],
    newInput: "- name: Tim\n  email: TIM@SITE.COM\n  role: editor\n- name: Mina\n  email: MINA@SITE.COM\n  role: admin",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: [
      { person: "Tim", email: "tim@site.com", access: "editor" },
      { person: "Mina", email: "mina@site.com", access: "admin" },
    ],
    expectedSerializedOutput: "[\n  {\n    \"person\": \"Tim\",\n    \"email\": \"tim@site.com\",\n    \"access\": \"editor\"\n  },\n  {\n    \"person\": \"Mina\",\n    \"email\": \"mina@site.com\",\n    \"access\": \"admin\"\n  }\n]",
    expectedOutputFormat: "json",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "yaml-k8s-container-image-env",
    suite: "translator-yaml-real-world",
    category: "kubernetes",
    examples: [
      { input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  template:\n    spec:\n      containers:\n        - name: web\n          image: registry/app-web:1.0\n          env:\n            - name: APP_ENV\n              value: production", inputFormat: "yaml", output: { app: "web", image: "registry/app-web:1.0", env: "production" } },
      { input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          image: registry/app-api:2.1\n          env:\n            - name: APP_ENV\n              value: staging", inputFormat: "yaml", output: { app: "api", image: "registry/app-api:2.1", env: "staging" } },
    ],
    newInput: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: worker\nspec:\n  template:\n    spec:\n      containers:\n        - name: worker\n          image: registry/app-worker:3.4\n          env:\n            - name: APP_ENV\n              value: production",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { app: "worker", image: "registry/app-worker:3.4", env: "production" },
    expectedSerializedOutput: "{\n  \"app\": \"worker\",\n  \"image\": \"registry/app-worker:3.4\",\n  \"env\": \"production\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-k8s-resources-extract",
    suite: "translator-yaml-real-world",
    category: "kubernetes",
    examples: [
      { input: "metadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - resources:\n            requests:\n              cpu: 250m\n              memory: 128Mi\n            limits:\n              cpu: 500m\n              memory: 256Mi", inputFormat: "yaml", output: { name: "api", request_cpu: "250m", limit_cpu: "500m", limit_memory: "256Mi" } },
      { input: "metadata:\n  name: worker\nspec:\n  template:\n    spec:\n      containers:\n        - resources:\n            requests:\n              cpu: 500m\n              memory: 256Mi\n            limits:\n              cpu: 1000m\n              memory: 512Mi", inputFormat: "yaml", output: { name: "worker", request_cpu: "500m", limit_cpu: "1000m", limit_memory: "512Mi" } },
    ],
    newInput: "metadata:\n  name: cron\nspec:\n  template:\n    spec:\n      containers:\n        - resources:\n            requests:\n              cpu: 750m\n              memory: 384Mi\n            limits:\n              cpu: 1500m\n              memory: 768Mi",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { name: "cron", request_cpu: "750m", limit_cpu: "1500m", limit_memory: "768Mi" },
    expectedSerializedOutput: "{\n  \"name\": \"cron\",\n  \"request_cpu\": \"750m\",\n  \"limit_cpu\": \"1500m\",\n  \"limit_memory\": \"768Mi\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.6,
  },
  {
    id: "yaml-github-actions-extract",
    suite: "translator-yaml-real-world",
    category: "ci",
    examples: [
      { input: "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20", inputFormat: "yaml", output: { workflow: "CI", runner: "ubuntu-latest", node: 20 } },
      { input: "name: Release\njobs:\n  build:\n    runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22", inputFormat: "yaml", output: { workflow: "Release", runner: "ubuntu-22.04", node: 22 } },
    ],
    newInput: "name: Nightly\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { workflow: "Nightly", runner: "ubuntu-24.04", node: 24 },
    expectedSerializedOutput: "{\n  \"workflow\": \"Nightly\",\n  \"runner\": \"ubuntu-24.04\",\n  \"node\": 24\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-docker-compose-fixed-service",
    suite: "translator-yaml-real-world",
    category: "docker-compose",
    examples: [
      { input: "services:\n  app:\n    image: nginx:1.25\n    ports:\n      - \"80:80\"\n    restart: always", inputFormat: "yaml", output: { service: "app", image: "nginx:1.25", port: "80:80", restart: "always" } },
      { input: "services:\n  app:\n    image: postgres:16\n    ports:\n      - \"5432:5432\"\n    restart: unless-stopped", inputFormat: "yaml", output: { service: "app", image: "postgres:16", port: "5432:5432", restart: "unless-stopped" } },
    ],
    newInput: "services:\n  app:\n    image: redis:7\n    ports:\n      - \"6379:6379\"\n    restart: always",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { service: "app", image: "redis:7", port: "6379:6379", restart: "always" },
    expectedSerializedOutput: "{\n  \"service\": \"app\",\n  \"image\": \"redis:7\",\n  \"port\": \"6379:6379\",\n  \"restart\": \"always\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-docker-compose-env-flatten",
    suite: "translator-yaml-real-world",
    category: "docker-compose",
    examples: [
      { input: "services:\n  api:\n    image: app:1.0\n    environment:\n      APP_ENV: production\n      LOG_LEVEL: info", inputFormat: "yaml", output: { image: "app:1.0", env: "production", log_level: "info" } },
      { input: "services:\n  api:\n    image: app:2.0\n    environment:\n      APP_ENV: staging\n      LOG_LEVEL: debug", inputFormat: "yaml", output: { image: "app:2.0", env: "staging", log_level: "debug" } },
    ],
    newInput: "services:\n  api:\n    image: app:3.0\n    environment:\n      APP_ENV: production\n      LOG_LEVEL: warn",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { image: "app:3.0", env: "production", log_level: "warn" },
    expectedSerializedOutput: "{\n  \"image\": \"app:3.0\",\n  \"env\": \"production\",\n  \"log_level\": \"warn\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "yaml-ci-config-to-csv",
    suite: "translator-yaml-real-world",
    category: "ci",
    examples: [
      { input: "pipeline:\n  name: build\n  image: node:20\n  timeout: 15", inputFormat: "yaml", output: "pipeline,image,timeout\nbuild,node:20,15", outputFormat: "csv" },
      { input: "pipeline:\n  name: test\n  image: node:22\n  timeout: 20", inputFormat: "yaml", output: "pipeline,image,timeout\ntest,node:22,20", outputFormat: "csv" },
    ],
    newInput: "pipeline:\n  name: deploy\n  image: node:24\n  timeout: 30",
    inputFormat: "yaml",
    outputFormat: "csv",
    expectedOutput: { pipeline: "deploy", image: "node:24", timeout: 30 },
    expectedSerializedOutput: "pipeline,image,timeout\ndeploy,node:24,30",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "json-to-yaml-service-config",
    suite: "translator-yaml-real-world",
    category: "yaml-generation",
    examples: [
      { input: { service: "api", image: "app:1.0", port: 8080 }, output: "service:\n  name: api\n  image: app:1.0\n  port: 8080\n", outputFormat: "yaml" },
      { input: { service: "web", image: "web:2.0", port: 3000 }, output: "service:\n  name: web\n  image: web:2.0\n  port: 3000\n", outputFormat: "yaml" },
    ],
    newInput: { service: "worker", image: "worker:3.0", port: 9000 },
    outputFormat: "yaml",
    expectedOutput: { service: { name: "worker", image: "worker:3.0", port: 9000 } },
    expectedSerializedOutput: "service:\n  name: worker\n  image: worker:3.0\n  port: 9000\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "csv-to-yaml-feature-flags",
    suite: "translator-yaml-real-world",
    category: "yaml-generation",
    examples: [
      { input: "name,enabled,rollout\ncheckout,true,25", inputFormat: "csv", output: "feature:\n  key: checkout\n  enabled: true\n  rollout: 25\n", outputFormat: "yaml" },
      { input: "name,enabled,rollout\nsearch,false,0", inputFormat: "csv", output: "feature:\n  key: search\n  enabled: false\n  rollout: 0\n", outputFormat: "yaml" },
    ],
    newInput: "name,enabled,rollout\nrecommendations,true,10",
    inputFormat: "csv",
    outputFormat: "yaml",
    expectedOutput: { feature: { key: "recommendations", enabled: true, rollout: 10 } },
    expectedSerializedOutput: "feature:\n  key: recommendations\n  enabled: true\n  rollout: 10\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "yaml-to-yaml-env-rename",
    suite: "translator-yaml-real-world",
    category: "yaml-to-yaml",
    examples: [
      { input: "service:\n  name: api\n  env: prod\n  image: app:1", inputFormat: "yaml", output: "app:\n  id: api\n  environment: prod\n  container: app:1\n", outputFormat: "yaml" },
      { input: "service:\n  name: web\n  env: staging\n  image: web:2", inputFormat: "yaml", output: "app:\n  id: web\n  environment: staging\n  container: web:2\n", outputFormat: "yaml" },
    ],
    newInput: "service:\n  name: worker\n  env: prod\n  image: worker:3",
    inputFormat: "yaml",
    outputFormat: "yaml",
    expectedOutput: { app: { id: "worker", environment: "prod", container: "worker:3" } },
    expectedSerializedOutput: "app:\n  id: worker\n  environment: prod\n  container: worker:3\n",
    expectedOutputFormat: "yaml",
    minConfidence: 0.75,
  },
  {
    id: "yaml-merge-defaults-extract",
    suite: "translator-yaml-real-world",
    category: "yaml-merge",
    examples: [
      { input: "defaults: &defaults\n  timeout: 30\n  retries: 2\nservice:\n  <<: *defaults\n  name: api", inputFormat: "yaml", output: { service: "api", timeout: 30, retries: 2 } },
      { input: "defaults: &defaults\n  timeout: 60\n  retries: 3\nservice:\n  <<: *defaults\n  name: worker", inputFormat: "yaml", output: { service: "worker", timeout: 60, retries: 3 } },
    ],
    newInput: "defaults: &defaults\n  timeout: 45\n  retries: 4\nservice:\n  <<: *defaults\n  name: cron",
    inputFormat: "yaml",
    outputFormat: "json",
    expectedOutput: { service: "cron", timeout: 45, retries: 4 },
    expectedSerializedOutput: "{\n  \"service\": \"cron\",\n  \"timeout\": 45,\n  \"retries\": 4\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.7,
  },
  {
    id: "xf-json-to-csv-flat",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { name: "Ana", age: "28", city: "Berlin" }, output: "name,age,city\nAna,28,Berlin", outputFormat: "csv" },
      { input: { name: "Bo", age: "31", city: "Paris" }, output: "name,age,city\nBo,31,Paris", outputFormat: "csv" },
    ],
    newInput: { name: "Tim", age: "44", city: "Madrid" },
    outputFormat: "csv",
    expectedOutput: { name: "Tim", age: 44, city: "Madrid" },
    expectedSerializedOutput: "name,age,city\nTim,44,Madrid",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-json-to-csv-rename-compute",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { first: "Ana", last: "Lopez", logins: "12" }, output: "full_name,login_count\nAna Lopez,12", outputFormat: "csv" },
      { input: { first: "Bo", last: "Smith", logins: "5" }, output: "full_name,login_count\nBo Smith,5", outputFormat: "csv" },
    ],
    newInput: { first: "Tim", last: "Berg", logins: "28" },
    outputFormat: "csv",
    expectedOutput: { full_name: "Tim Berg", login_count: 28 },
    expectedSerializedOutput: "full_name,login_count\nTim Berg,28",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-stripe-json-to-accounting-csv",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      {
        input: { data: { object: { id: "pi_1", amount: 4999, customer: "cus_1" } } },
        output: "payment_id,amount_usd,customer\npi_1,49.99,cus_1",
        outputFormat: "csv",
      },
      {
        input: { data: { object: { id: "pi_2", amount: 1200, customer: "cus_2" } } },
        output: "payment_id,amount_usd,customer\npi_2,12,cus_2",
        outputFormat: "csv",
      },
    ],
    newInput: { data: { object: { id: "pi_3", amount: 2500, customer: "cus_3" } } },
    outputFormat: "csv",
    expectedOutput: { payment_id: "pi_3", amount_usd: 25, customer: "cus_3" },
    expectedSerializedOutput: "payment_id,amount_usd,customer\npi_3,25,cus_3",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-flat",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "Name,Age,City\nAna,28,Berlin", inputFormat: "csv", output: { name: "Ana", age: 28, city: "Berlin" } },
      { input: "Name,Age,City\nBo,31,Paris", inputFormat: "csv", output: { name: "Bo", age: 31, city: "Paris" } },
    ],
    newInput: "Name,Age,City\nTim,44,Madrid",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { name: "Tim", age: 44, city: "Madrid" },
    expectedSerializedOutput: "{\n  \"name\": \"Tim\",\n  \"age\": 44,\n  \"city\": \"Madrid\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-nested",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "Name,Email,Role\nAna Lopez,ANA@EXAMPLE.COM,admin", inputFormat: "csv", output: { user: { name: "Ana Lopez", email: "ana@example.com" }, role: "admin" } },
      { input: "Name,Email,Role\nBo Smith,BO@TEST.COM,viewer", inputFormat: "csv", output: { user: { name: "Bo Smith", email: "bo@test.com" }, role: "viewer" } },
    ],
    newInput: "Name,Email,Role\nTim Berg,TIM@SITE.COM,editor",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { user: { name: "Tim Berg", email: "tim@site.com" }, role: "editor" },
    expectedSerializedOutput: "{\n  \"user\": {\n    \"name\": \"Tim Berg\",\n    \"email\": \"tim@site.com\"\n  },\n  \"role\": \"editor\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-batch",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "Name,Email\nAna Lopez,ANA@EXAMPLE.COM", inputFormat: "csv", output: { name: "Ana Lopez", email: "ana@example.com" } },
      { input: "Name,Email\nBo Smith,BO@TEST.COM", inputFormat: "csv", output: { name: "Bo Smith", email: "bo@test.com" } },
    ],
    newInput: "Name,Email\nTim Berg,TIM@SITE.COM\nMina Cho,MINA@SITE.COM",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: [
      { name: "Tim Berg", email: "tim@site.com" },
      { name: "Mina Cho", email: "mina@site.com" },
    ],
    expectedSerializedOutput: "[\n  {\n    \"name\": \"Tim Berg\",\n    \"email\": \"tim@site.com\"\n  },\n  {\n    \"name\": \"Mina Cho\",\n    \"email\": \"mina@site.com\"\n  }\n]",
    expectedOutputFormat: "json",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-cleanup",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "NAME,EMAIL,STATUS\n\"  john doe \",JOHN@TEST.COM,active", inputFormat: "csv", output: "name,email,active\nJohn Doe,john@test.com,true", outputFormat: "csv" },
      { input: "NAME,EMAIL,STATUS\n\" mina CHO\",MINA@TEST.COM,inactive", inputFormat: "csv", output: "name,email,active\nMina Cho,mina@test.com,false", outputFormat: "csv" },
    ],
    newInput: "NAME,EMAIL,STATUS\n\"tim BERG \",TIM@SITE.COM,active",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { name: "Tim Berg", email: "tim@site.com", active: true },
    expectedSerializedOutput: "name,email,active\nTim Berg,tim@site.com,true",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-batch-cleanup",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "NAME,EMAIL,STATUS\n\"  john doe \",JOHN@TEST.COM,active", inputFormat: "csv", output: "name,email,active\nJohn Doe,john@test.com,true", outputFormat: "csv" },
      { input: "NAME,EMAIL,STATUS\n\" mina CHO\",MINA@TEST.COM,inactive", inputFormat: "csv", output: "name,email,active\nMina Cho,mina@test.com,false", outputFormat: "csv" },
    ],
    newInput: "NAME,EMAIL,STATUS\n\"tim BERG \",TIM@SITE.COM,active\n\" ana LOPEZ\",ANA@SITE.COM,inactive",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: [
      { name: "Tim Berg", email: "tim@site.com", active: true },
      { name: "Ana Lopez", email: "ana@site.com", active: false },
    ],
    expectedSerializedOutput: "name,email,active\nTim Berg,tim@site.com,true\nAna Lopez,ana@site.com,false",
    expectedOutputFormat: "csv",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-quoted-values",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "first,last,note\nAna,Lopez,\"Berlin, DE\"", inputFormat: "csv", output: "name,note\nAna Lopez,\"Berlin, DE\"", outputFormat: "csv" },
      { input: "first,last,note\nBo,Smith,\"Paris, FR\"", inputFormat: "csv", output: "name,note\nBo Smith,\"Paris, FR\"", outputFormat: "csv" },
    ],
    newInput: "first,last,note\nTim,Berg,\"Madrid, ES\"",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { name: "Tim Berg", note: "Madrid, ES" },
    expectedSerializedOutput: "name,note\nTim Berg,\"Madrid, ES\"",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-auto-detect-json-csv",
    suite: "translator",
    category: "auto-detect",
    examples: [
      { input: "{\"first\":\"Ana\",\"last\":\"Lopez\"}", output: "name,type\nAna Lopez,user" },
      { input: "{\"first\":\"Bo\",\"last\":\"Smith\"}", output: "name,type\nBo Smith,user" },
    ],
    newInput: "{\"first\":\"Tim\",\"last\":\"Berg\"}",
    expectedOutput: { name: "Tim Berg", type: "user" },
    expectedSerializedOutput: "name,type\nTim Berg,user",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-json-valid-input-not-csv",
    suite: "translator",
    category: "auto-detect",
    examples: [
      { input: "{\"userId\":\"USR_748392\",\"full_name\":\"Johnathan  Doe\",\"emails\":[\"john.doe@oldcorp.com \",\"jdoe@gmail.com\"],\"phone\":\"+1 (415) 555-0123\",\"address\":\"123 Main St, San Francisco, CA 94105\",\"tags\":[\"developer\",\"premium\",\"active\"],\"created\":\"2023-11-05T14:30:00Z\",\"last_login\":\"2024-02-18\",\"plan\":\"pro\",\"score\":8742}", output: { id: "748392", name: "Johnathan Doe", emails: ["john.doe@oldcorp.com", "jdoe@gmail.com"], phone: "+14155550123", address: "123 Main St, San Francisco, CA 94105", tags: ["developer", "premium", "active"], created_at: "2023-11-05T14:30:00Z", last_login: "2024-02-18", plan: "pro", score: 8742 } },
      { input: "{\"userId\":\"USR_39281\",\"full_name\":\"Maria Rodriguez Lopez\",\"emails\":[\"maria.r@company.es\"],\"phone\":\"+34 912 345 678\",\"address\":\"Madrid, Spain\",\"tags\":[\"admin\",\"editor \"],\"created\":\"2022/03/15\",\"last_login\":null,\"plan\":\"enterprise\",\"score\":\"12450\"}", output: { id: "39281", name: "Maria Rodriguez Lopez", emails: ["maria.r@company.es"], phone: "+34912345678", address: "Madrid, Spain", tags: ["admin", "editor"], created_at: "2022-03-15", last_login: null, plan: "enterprise", score: 12450 } },
    ],
    newInput: "[{\"userId\":\"USR_112233\",\"full_name\":\"Alice   Chen\",\"emails\":[\"alice@startup.io\"],\"phone\":\"(650) 555-9876\",\"address\":\"456 Oak Ave, Austin, TX\",\"tags\":[\"designer\",\"active\"],\"created\":\"2024-01-10T09:15:00Z\",\"last_login\":null,\"plan\":\"starter\",\"score\":3420}]",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: [{ id: "112233", name: "Alice Chen", emails: ["alice@startup.io"], phone: "+16505559876", address: "456 Oak Ave, Austin, TX", tags: ["designer", "active"], created_at: "2024-01-10T09:15:00Z", last_login: null, plan: "starter", score: 3420 }],
    expectedSerializedOutput: "[\n  {\n    \"id\": \"112233\",\n    \"name\": \"Alice Chen\",\n    \"emails\": [\n      \"alice@startup.io\"\n    ],\n    \"phone\": \"+16505559876\",\n    \"address\": \"456 Oak Ave, Austin, TX\",\n    \"tags\": [\n      \"designer\",\n      \"active\"\n    ],\n    \"created_at\": \"2024-01-10T09:15:00Z\",\n    \"last_login\": null,\n    \"plan\": \"starter\",\n    \"score\": 3420\n  }\n]",
    expectedOutputFormat: "json",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-json-batch-to-csv-users",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { id: "USR_100", full_name: "Ana   Lopez", email: "ana@example.com " }, output: "id,name,email\n100,Ana Lopez,ana@example.com", outputFormat: "csv" },
      { input: { id: "USR_200", full_name: "Bo Smith", email: " bo@example.com" }, output: "id,name,email\n200,Bo Smith,bo@example.com", outputFormat: "csv" },
    ],
    newInput: [
      { id: "USR_300", full_name: "Tim   Berg", email: "tim@example.com " },
      { id: "USR_400", full_name: "Mina Cho", email: " mina@example.com" },
    ],
    outputFormat: "csv",
    expectedOutput: [
      { id: "300", name: "Tim Berg", email: "tim@example.com" },
      { id: "400", name: "Mina Cho", email: "mina@example.com" },
    ],
    expectedSerializedOutput: "id,name,email\n300,Tim Berg,tim@example.com\n400,Mina Cho,mina@example.com",
    expectedOutputFormat: "csv",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-json-to-csv-contact-normalize",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { contact: { name: "Ana   Lopez", phone: "+1 (415) 555-0101" }, created: "2024/01/05" }, output: "name,phone,created_at\nAna Lopez,+14155550101,2024-01-05", outputFormat: "csv" },
      { input: { contact: { name: "Bo Smith", phone: "+44 20 7946 0958" }, created: "2023-12-11" }, output: "name,phone,created_at\nBo Smith,+442079460958,2023-12-11", outputFormat: "csv" },
    ],
    newInput: { contact: { name: "Mina   Cho", phone: "(650) 555-9876" }, created: "2022/03/15" },
    outputFormat: "csv",
    expectedOutput: { name: "Mina Cho", phone: "+16505559876", created_at: "2022-03-15" },
    expectedSerializedOutput: "name,phone,created_at\nMina Cho,+16505559876,2022-03-15",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-json-to-csv-array-join",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { title: "Launch", tags: ["product", "urgent"] }, output: "title,tag_list\nLaunch,product | urgent", outputFormat: "csv" },
      { input: { title: "Retrospective", tags: ["team", "ops"] }, output: "title,tag_list\nRetrospective,team | ops", outputFormat: "csv" },
    ],
    newInput: { title: "Roadmap", tags: ["strategy", "planning"] },
    outputFormat: "csv",
    expectedOutput: { title: "Roadmap", tag_list: "strategy | planning" },
    expectedSerializedOutput: "title,tag_list\nRoadmap,strategy | planning",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-split-tags",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "title,tags\nLaunch,\"product; urgent\"", inputFormat: "csv", output: { title: "Launch", tags: ["product", "urgent"] } },
      { input: "title,tags\nRetro,\"team; ops\"", inputFormat: "csv", output: { title: "Retro", tags: ["team", "ops"] } },
    ],
    newInput: "title,tags\nRoadmap,\"strategy; planning\"",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { title: "Roadmap", tags: ["strategy", "planning"] },
    expectedSerializedOutput: "{\n  \"title\": \"Roadmap\",\n  \"tags\": [\n    \"strategy\",\n    \"planning\"\n  ]\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-contact-normalize",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "Full Name,Phone,Created,Score\n\"Ana   Lopez\",+1 (415) 555-0101,2024/01/05,1200", inputFormat: "csv", output: { name: "Ana Lopez", phone: "+14155550101", created_at: "2024-01-05", score: 1200 } },
      { input: "Full Name,Phone,Created,Score\nBo Smith,+44 20 7946 0958,2023-12-11,940", inputFormat: "csv", output: { name: "Bo Smith", phone: "+442079460958", created_at: "2023-12-11", score: 940 } },
    ],
    newInput: "Full Name,Phone,Created,Score\n\"Mina   Cho\",(650) 555-9876,2022/03/15,880",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { name: "Mina Cho", phone: "+16505559876", created_at: "2022-03-15", score: 880 },
    expectedSerializedOutput: "{\n  \"name\": \"Mina Cho\",\n  \"phone\": \"+16505559876\",\n  \"created_at\": \"2022-03-15\",\n  \"score\": 880\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-json-full-name",
    suite: "translator",
    category: "csv-to-json",
    examples: [
      { input: "first,last,email\nAna,Lopez,ANA@EXAMPLE.COM", inputFormat: "csv", output: { name: "Ana Lopez", email: "ana@example.com" } },
      { input: "first,last,email\nBo,Smith,BO@TEST.COM", inputFormat: "csv", output: { name: "Bo Smith", email: "bo@test.com" } },
    ],
    newInput: "first,last,email\nMina,Cho,MINA@SITE.COM",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { name: "Mina Cho", email: "mina@site.com" },
    expectedSerializedOutput: "{\n  \"name\": \"Mina Cho\",\n  \"email\": \"mina@site.com\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-reorder-drop",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "sku,name,internal_note,price\nA-1,Desk,fragile,129.99", inputFormat: "csv", output: "name,sku,price\nDesk,A-1,129.99", outputFormat: "csv" },
      { input: "sku,name,internal_note,price\nB-2,Lamp,warehouse,39.5", inputFormat: "csv", output: "name,sku,price\nLamp,B-2,39.5", outputFormat: "csv" },
    ],
    newInput: "sku,name,internal_note,price\nC-3,Chair,clearance,84",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { name: "Chair", sku: "C-3", price: 84 },
    expectedSerializedOutput: "name,sku,price\nChair,C-3,84",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-status-label",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "email,status\nana@example.com,active", inputFormat: "csv", output: "email,status_label\nana@example.com,Enabled", outputFormat: "csv" },
      { input: "email,status\nbo@example.com,inactive", inputFormat: "csv", output: "email,status_label\nbo@example.com,Disabled", outputFormat: "csv" },
    ],
    newInput: "email,status\nmina@example.com,active",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { email: "mina@example.com", status_label: "Enabled" },
    expectedSerializedOutput: "email,status_label\nmina@example.com,Enabled",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-csv-to-csv-quoted-commas-batch",
    suite: "translator",
    category: "csv-to-csv",
    examples: [
      { input: "name,address\nAna,\"Madrid, Spain\"", inputFormat: "csv", output: "name,address\nAna,\"Madrid, Spain\"", outputFormat: "csv" },
      { input: "name,address\nBo,\"Paris, France\"", inputFormat: "csv", output: "name,address\nBo,\"Paris, France\"", outputFormat: "csv" },
    ],
    newInput: "name,address\nMina,\"Berlin, Germany\"\nTim,\"Austin, TX\"",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: [
      { name: "Mina", address: "Berlin, Germany" },
      { name: "Tim", address: "Austin, TX" },
    ],
    expectedSerializedOutput: "name,address\nMina,\"Berlin, Germany\"\nTim,\"Austin, TX\"",
    expectedOutputFormat: "csv",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-json-to-csv-nested-array-count",
    suite: "translator",
    category: "json-to-csv",
    examples: [
      { input: { account: { id: "acct_1" }, users: [{ active: true }, { active: false }, { active: true }] }, output: "account_id,user_count,active_count\nacct_1,3,2", outputFormat: "csv" },
      { input: { account: { id: "acct_2" }, users: [{ active: false }, { active: true }] }, output: "account_id,user_count,active_count\nacct_2,2,1", outputFormat: "csv" },
    ],
    newInput: { account: { id: "acct_3" }, users: [{ active: true }, { active: true }, { active: false }, { active: true }] },
    outputFormat: "csv",
    expectedOutput: { account_id: "acct_3", user_count: 4, active_count: 3 },
    expectedSerializedOutput: "account_id,user_count,active_count\nacct_3,4,3",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "xf-json-to-json-api-cleanup-batch",
    suite: "translator",
    category: "json-to-json",
    examples: [
      { input: { userId: "USR_748392", full_name: "Johnathan  Doe", emails: ["john.doe@oldcorp.com ", "jdoe@gmail.com"], phone: "+1 (415) 555-0123", created: "2023-11-05T14:30:00Z", score: 8742 }, output: { id: "748392", name: "Johnathan Doe", emails: ["john.doe@oldcorp.com", "jdoe@gmail.com"], phone: "+14155550123", created_at: "2023-11-05T14:30:00Z", score: 8742 } },
      { input: { userId: "USR_39281", full_name: "Maria Rodriguez Lopez", emails: ["maria.r@company.es"], phone: "+34 912 345 678", created: "2022/03/15", score: "12450" }, output: { id: "39281", name: "Maria Rodriguez Lopez", emails: ["maria.r@company.es"], phone: "+34912345678", created_at: "2022-03-15", score: 12450 } },
    ],
    newInput: [
      { userId: "USR_112233", full_name: "Alice   Chen", emails: ["alice@startup.io"], phone: "(650) 555-9876", created: "2024-01-10T09:15:00Z", score: 3420 },
      { userId: "USR_44556", full_name: "Ahmed Al-Sayed", emails: ["ahmed.sayed@tech.ae", "a.sayed@gmail.com "], phone: "+971 50 123 4567", created: "2023-08-22", score: 6750 },
    ],
    outputFormat: "json",
    expectedOutput: [
      { id: "112233", name: "Alice Chen", emails: ["alice@startup.io"], phone: "+16505559876", created_at: "2024-01-10T09:15:00Z", score: 3420 },
      { id: "44556", name: "Ahmed Al-Sayed", emails: ["ahmed.sayed@tech.ae", "a.sayed@gmail.com"], phone: "+971501234567", created_at: "2023-08-22", score: 6750 },
    ],
    expectedSerializedOutput: "[\n  {\n    \"id\": \"112233\",\n    \"name\": \"Alice Chen\",\n    \"emails\": [\n      \"alice@startup.io\"\n    ],\n    \"phone\": \"+16505559876\",\n    \"created_at\": \"2024-01-10T09:15:00Z\",\n    \"score\": 3420\n  },\n  {\n    \"id\": \"44556\",\n    \"name\": \"Ahmed Al-Sayed\",\n    \"emails\": [\n      \"ahmed.sayed@tech.ae\",\n      \"a.sayed@gmail.com\"\n    ],\n    \"phone\": \"+971501234567\",\n    \"created_at\": \"2023-08-22\",\n    \"score\": 6750\n  }\n]",
    expectedOutputFormat: "json",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "xf-auto-detect-csv-to-json",
    suite: "translator",
    category: "auto-detect",
    examples: [
      { input: "name,email\nAna,ANA@EXAMPLE.COM", output: { name: "Ana", email: "ana@example.com" } },
      { input: "name,email\nBo,BO@EXAMPLE.COM", output: { name: "Bo", email: "bo@example.com" } },
    ],
    newInput: "name,email\nMina,MINA@EXAMPLE.COM",
    outputFormat: "json",
    expectedOutput: { name: "Mina", email: "mina@example.com" },
    expectedSerializedOutput: "{\n  \"name\": \"Mina\",\n  \"email\": \"mina@example.com\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-shopify-products-json-to-csv",
    suite: "golden-workflows",
    category: "commerce",
    examples: [
      { input: { id: "gid://shopify/Product/100", title: "Solar Lamp", sku: "SL-1", price: "49.99", tags: ["Outdoor", "Solar"], status: "ACTIVE" }, output: "product_id,title,sku,price,tags,status\n100,Solar Lamp,SL-1,49.99,Outdoor | Solar,ACTIVE", outputFormat: "csv" },
      { input: { id: "gid://shopify/Product/200", title: "Desk Mat", sku: "DM-2", price: "24.5", tags: ["Office", "Accessories"], status: "DRAFT" }, output: "product_id,title,sku,price,tags,status\n200,Desk Mat,DM-2,24.5,Office | Accessories,DRAFT", outputFormat: "csv" },
    ],
    newInput: { id: "gid://shopify/Product/300", title: "Cable Box", sku: "CB-3", price: "18", tags: ["Office", "Storage"], status: "ACTIVE" },
    outputFormat: "csv",
    expectedOutput: { product_id: "300", title: "Cable Box", sku: "CB-3", price: 18, tags: "Office | Storage", status: "ACTIVE" },
    expectedSerializedOutput: "product_id,title,sku,price,tags,status\n300,Cable Box,CB-3,18,Office | Storage,ACTIVE",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-hubspot-contacts-csv-to-json",
    suite: "golden-workflows",
    category: "crm",
    examples: [
      { input: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n101,Ana,Lopez,ANA@EXAMPLE.COM,+1 (415) 555-0101,customer", inputFormat: "csv", output: { id: "101", name: "Ana Lopez", email: "ana@example.com", phone: "+14155550101", stage: "customer" } },
      { input: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n202,Bo,Smith,BO@EXAMPLE.COM,+44 20 7946 0958,lead", inputFormat: "csv", output: { id: "202", name: "Bo Smith", email: "bo@example.com", phone: "+442079460958", stage: "lead" } },
    ],
    newInput: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n303,Tim,Berg,TIM@EXAMPLE.COM,(650) 555-9876,customer",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { id: "303", name: "Tim Berg", email: "tim@example.com", phone: "+16505559876", stage: "customer" },
    expectedSerializedOutput: "{\n  \"id\": \"303\",\n  \"name\": \"Tim Berg\",\n  \"email\": \"tim@example.com\",\n  \"phone\": \"+16505559876\",\n  \"stage\": \"customer\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-airtable-csv-to-csv-cleanup",
    suite: "golden-workflows",
    category: "airtable",
    examples: [
      { input: "Name,Owner Email,Tags,Status\n\"  Launch Plan \",ANA@EXAMPLE.COM,strategy | planning,Active", inputFormat: "csv", output: "title,owner_email,tags,is_active\nLaunch Plan,ana@example.com,strategy | planning,true", outputFormat: "csv" },
      { input: "Name,Owner Email,Tags,Status\n\"Roadmap\",BO@EXAMPLE.COM,product | ops,Inactive", inputFormat: "csv", output: "title,owner_email,tags,is_active\nRoadmap,bo@example.com,product | ops,false", outputFormat: "csv" },
    ],
    newInput: "Name,Owner Email,Tags,Status\n\"  QA Checklist\",TIM@EXAMPLE.COM,quality | release,Active",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { title: "QA Checklist", owner_email: "tim@example.com", tags: "quality | release", is_active: true },
    expectedSerializedOutput: "title,owner_email,tags,is_active\nQA Checklist,tim@example.com,quality | release,true",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-wordpress-json-to-csv",
    suite: "golden-workflows",
    category: "cms",
    examples: [
      { input: { id: 10, title: { rendered: "Solar Guide" }, slug: "solar-guide", date: "2024-03-15T09:30:00", status: "publish" }, output: "post_id,title,slug,published_at,status\n10,Solar Guide,solar-guide,2024-03-15,publish", outputFormat: "csv" },
      { input: { id: 20, title: { rendered: "Heat Pump" }, slug: "heat-pump", date: "2024-06-01T14:00:00", status: "draft" }, output: "post_id,title,slug,published_at,status\n20,Heat Pump,heat-pump,2024-06-01,draft", outputFormat: "csv" },
    ],
    newInput: { id: 30, title: { rendered: "Battery Storage" }, slug: "battery-storage", date: "2024-09-20T08:00:00", status: "publish" },
    outputFormat: "csv",
    expectedOutput: { post_id: "30", title: "Battery Storage", slug: "battery-storage", published_at: "2024-09-20", status: "publish" },
    expectedSerializedOutput: "post_id,title,slug,published_at,status\n30,Battery Storage,battery-storage,2024-09-20,publish",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-invoice-csv-to-json",
    suite: "golden-workflows",
    category: "finance",
    examples: [
      { input: "invoice_id,customer,net,tax,status\nINV-1,Ana,100,19,paid", inputFormat: "csv", output: { invoice: { id: "INV-1", customer: "Ana" }, gross: 119, paid: true } },
      { input: "invoice_id,customer,net,tax,status\nINV-2,Bo,50,9,due", inputFormat: "csv", output: { invoice: { id: "INV-2", customer: "Bo" }, gross: 59, paid: false } },
    ],
    newInput: "invoice_id,customer,net,tax,status\nINV-3,Tim,80,15,paid",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { invoice: { id: "INV-3", customer: "Tim" }, gross: 95, paid: true },
    expectedSerializedOutput: "{\n  \"invoice\": {\n    \"id\": \"INV-3\",\n    \"customer\": \"Tim\"\n  },\n  \"gross\": 95,\n  \"paid\": true\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-analytics-events-json-to-csv",
    suite: "golden-workflows",
    category: "analytics",
    examples: [
      { input: { event: "signup", user: { id: "u1" }, timestamp: "2024-03-15T09:30:00Z", properties: { plan: "pro" } }, output: "event,user_id,event_date,plan\nsignup,u1,2024-03-15,pro", outputFormat: "csv" },
      { input: { event: "purchase", user: { id: "u2" }, timestamp: "2024-06-01T14:00:00Z", properties: { plan: "starter" } }, output: "event,user_id,event_date,plan\npurchase,u2,2024-06-01,starter", outputFormat: "csv" },
    ],
    newInput: { event: "signup", user: { id: "u3" }, timestamp: "2024-09-20T08:00:00Z", properties: { plan: "enterprise" } },
    outputFormat: "csv",
    expectedOutput: { event: "signup", user_id: "u3", event_date: "2024-09-20", plan: "enterprise" },
    expectedSerializedOutput: "event,user_id,event_date,plan\nsignup,u3,2024-09-20,enterprise",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-support-tickets-csv-to-json-batch",
    suite: "golden-workflows",
    category: "support",
    examples: [
      { input: "Ticket ID,Requester,Priority,Tags\nT-1,Ana,urgent,\"billing; vip\"", inputFormat: "csv", output: { id: "T-1", requester: "Ana", priority: "urgent", tags: ["billing", "vip"] } },
      { input: "Ticket ID,Requester,Priority,Tags\nT-2,Bo,normal,\"bug; product\"", inputFormat: "csv", output: { id: "T-2", requester: "Bo", priority: "normal", tags: ["bug", "product"] } },
    ],
    newInput: "Ticket ID,Requester,Priority,Tags\nT-3,Tim,urgent,\"account; vip\"\nT-4,Mina,normal,\"docs; product\"",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: [
      { id: "T-3", requester: "Tim", priority: "urgent", tags: ["account", "vip"] },
      { id: "T-4", requester: "Mina", priority: "normal", tags: ["docs", "product"] },
    ],
    expectedSerializedOutput: "[\n  {\n    \"id\": \"T-3\",\n    \"requester\": \"Tim\",\n    \"priority\": \"urgent\",\n    \"tags\": [\n      \"account\",\n      \"vip\"\n    ]\n  },\n  {\n    \"id\": \"T-4\",\n    \"requester\": \"Mina\",\n    \"priority\": \"normal\",\n    \"tags\": [\n      \"docs\",\n      \"product\"\n    ]\n  }\n]",
    expectedOutputFormat: "json",
    expectedBatchApplied: true,
    minConfidence: 0.75,
  },
  {
    id: "golden-shipping-csv-to-csv-quoted-newline",
    suite: "golden-workflows",
    category: "shipping",
    examples: [
      { input: "Order,Name,Address,Note\n100,Ana,\"Main St 1\nBerlin\",Gift", inputFormat: "csv", output: "order_id,name,address,note\n100,Ana,\"Main St 1\nBerlin\",Gift", outputFormat: "csv" },
      { input: "Order,Name,Address,Note\n200,Bo,\"Oak Ave 2\nParis\",Fragile", inputFormat: "csv", output: "order_id,name,address,note\n200,Bo,\"Oak Ave 2\nParis\",Fragile", outputFormat: "csv" },
    ],
    newInput: "Order,Name,Address,Note\n300,Tim,\"Pine Rd 3\nMadrid\",Gift",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { order_id: "300", name: "Tim", address: "Pine Rd 3\nMadrid", note: "Gift" },
    expectedSerializedOutput: "order_id,name,address,note\n300,Tim,\"Pine Rd 3\nMadrid\",Gift",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-formula-safe-csv-output",
    suite: "golden-workflows",
    category: "security",
    examples: [
      { input: { name: "Ana", note: "=SUM(A1:A2)" }, output: "name,note\nAna,=SUM(A1:A2)", outputFormat: "csv" },
      { input: { name: "Bo", note: "@cmd" }, output: "name,note\nBo,@cmd", outputFormat: "csv" },
    ],
    newInput: { name: "Tim", note: "=IMPORTXML(\"https://example.com\")" },
    outputFormat: "csv",
    expectedOutput: { name: "Tim", note: "=IMPORTXML(\"https://example.com\")" },
    expectedSerializedOutput: "name,note\nTim,\"'=IMPORTXML(\"\"https://example.com\"\")\"",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-semicolon-csv-to-json",
    suite: "golden-workflows",
    category: "format",
    examples: [
      { input: "Name;Email;Score\nAna;ANA@EXAMPLE.COM;1200", inputFormat: "csv", output: { name: "Ana", email: "ana@example.com", score: 1200 } },
      { input: "Name;Email;Score\nBo;BO@EXAMPLE.COM;940", inputFormat: "csv", output: { name: "Bo", email: "bo@example.com", score: 940 } },
    ],
    newInput: "Name;Email;Score\nTim;TIM@EXAMPLE.COM;880",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { name: "Tim", email: "tim@example.com", score: 880 },
    expectedSerializedOutput: "{\n  \"name\": \"Tim\",\n  \"email\": \"tim@example.com\",\n  \"score\": 880\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-tsv-to-csv-cleanup",
    suite: "golden-workflows",
    category: "format",
    examples: [
      { input: "Name\tEmail\tStatus\nAna\tANA@EXAMPLE.COM\tactive", inputFormat: "csv", output: "name,email,active\nAna,ana@example.com,true", outputFormat: "csv" },
      { input: "Name\tEmail\tStatus\nBo\tBO@EXAMPLE.COM\tinactive", inputFormat: "csv", output: "name,email,active\nBo,bo@example.com,false", outputFormat: "csv" },
    ],
    newInput: "Name\tEmail\tStatus\nTim\tTIM@EXAMPLE.COM\tactive",
    inputFormat: "csv",
    outputFormat: "csv",
    expectedOutput: { name: "Tim", email: "tim@example.com", active: true },
    expectedSerializedOutput: "name,email,active\nTim,tim@example.com,true",
    expectedOutputFormat: "csv",
    minConfidence: 0.75,
  },
  {
    id: "golden-aws-s3-records-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectCreated:Put", eventTime: "2024-05-01T10:00:00Z", s3: { bucket: { name: "app-uploads" }, object: { key: "inbox/a.csv", size: 2048 } } }] }, output: [{ source: "aws:s3", event: "ObjectCreated:Put", bucket: "app-uploads", key: "inbox/a.csv", size: 2048, occurred_at: "2024-05-01T10:00:00Z" }] },
      { input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-02T11:30:00Z", s3: { bucket: { name: "audit-logs" }, object: { key: "old/b.log", size: 512 } } }] }, output: [{ source: "aws:s3", event: "ObjectRemoved:Delete", bucket: "audit-logs", key: "old/b.log", size: 512, occurred_at: "2024-05-02T11:30:00Z" }] },
    ],
    newInput: { Records: [
      { eventSource: "aws:s3", eventName: "ObjectCreated:Post", eventTime: "2024-05-03T12:45:00Z", s3: { bucket: { name: "media" }, object: { key: "photos/c.jpg", size: 8192 } } },
      { eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-04T13:00:00Z", s3: { bucket: { name: "media" }, object: { key: "old/d.jpg", size: 4096 } } },
    ] },
    outputFormat: "json",
    expectedOutput: [
      { source: "aws:s3", event: "ObjectCreated:Post", bucket: "media", key: "photos/c.jpg", size: 8192, occurred_at: "2024-05-03T12:45:00Z" },
      { source: "aws:s3", event: "ObjectRemoved:Delete", bucket: "media", key: "old/d.jpg", size: 4096, occurred_at: "2024-05-04T13:00:00Z" },
    ],
    expectedSerializedOutput: "[\n  {\n    \"source\": \"aws:s3\",\n    \"event\": \"ObjectCreated:Post\",\n    \"bucket\": \"media\",\n    \"key\": \"photos/c.jpg\",\n    \"size\": 8192,\n    \"occurred_at\": \"2024-05-03T12:45:00Z\"\n  },\n  {\n    \"source\": \"aws:s3\",\n    \"event\": \"ObjectRemoved:Delete\",\n    \"bucket\": \"media\",\n    \"key\": \"old/d.jpg\",\n    \"size\": 4096,\n    \"occurred_at\": \"2024-05-04T13:00:00Z\"\n  }\n]",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-aws-s3-decoded-metadata-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectCreated:Put", eventTime: "2024-05-01T10:00:00Z", s3: { bucket: { name: "app-uploads" }, object: { key: "inbox%2Fsummer+trip.jpg", size: 2048, eTag: "etag-1", versionId: "v1", sequencer: "001" } } }] }, output: [{ source: "aws:s3", event: "ObjectCreated:Put", bucket: "app-uploads", key: "inbox/summer trip.jpg", size: 2048, e_tag: "etag-1", version_id: "v1", sequencer: "001", occurred_at: "2024-05-01T10:00:00Z" }] },
      { input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-02T11:30:00Z", s3: { bucket: { name: "audit-logs" }, object: { key: "old%2Ftax+form.pdf", size: 512, eTag: "etag-2", versionId: "v2", sequencer: "002" } } }] }, output: [{ source: "aws:s3", event: "ObjectRemoved:Delete", bucket: "audit-logs", key: "old/tax form.pdf", size: 512, e_tag: "etag-2", version_id: "v2", sequencer: "002", occurred_at: "2024-05-02T11:30:00Z" }] },
    ],
    newInput: { Records: [
      { eventSource: "aws:s3", eventName: "ObjectCreated:Post", eventTime: "2024-05-03T12:45:00Z", s3: { bucket: { name: "media" }, object: { key: "photos%2Fhero+banner.png", size: 8192, eTag: "etag-3", versionId: "v3", sequencer: "003" } } },
      { eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-04T13:00:00Z", s3: { bucket: { name: "media" }, object: { key: "old%2Farchive+copy.zip", size: 4096, eTag: "etag-4", versionId: "v4", sequencer: "004" } } },
    ] },
    outputFormat: "json",
    expectedOutput: [
      { source: "aws:s3", event: "ObjectCreated:Post", bucket: "media", key: "photos/hero banner.png", size: 8192, e_tag: "etag-3", version_id: "v3", sequencer: "003", occurred_at: "2024-05-03T12:45:00Z" },
      { source: "aws:s3", event: "ObjectRemoved:Delete", bucket: "media", key: "old/archive copy.zip", size: 4096, e_tag: "etag-4", version_id: "v4", sequencer: "004", occurred_at: "2024-05-04T13:00:00Z" },
    ],
    expectedSerializedOutput: "[\n  {\n    \"source\": \"aws:s3\",\n    \"event\": \"ObjectCreated:Post\",\n    \"bucket\": \"media\",\n    \"key\": \"photos/hero banner.png\",\n    \"size\": 8192,\n    \"e_tag\": \"etag-3\",\n    \"version_id\": \"v3\",\n    \"sequencer\": \"003\",\n    \"occurred_at\": \"2024-05-03T12:45:00Z\"\n  },\n  {\n    \"source\": \"aws:s3\",\n    \"event\": \"ObjectRemoved:Delete\",\n    \"bucket\": \"media\",\n    \"key\": \"old/archive copy.zip\",\n    \"size\": 4096,\n    \"e_tag\": \"etag-4\",\n    \"version_id\": \"v4\",\n    \"sequencer\": \"004\",\n    \"occurred_at\": \"2024-05-04T13:00:00Z\"\n  }\n]",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-eventbridge-ec2-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-01T09:00:00Z", detail: { "instance-id": "i-001", state: "running" } }, output: { source: "aws.ec2", type: "EC2 Instance State-change Notification", resource_id: "i-001", state: "running", occurred_at: "2024-04-01T09:00:00Z" } },
      { input: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-02T10:15:00Z", detail: { "instance-id": "i-002", state: "stopped" } }, output: { source: "aws.ec2", type: "EC2 Instance State-change Notification", resource_id: "i-002", state: "stopped", occurred_at: "2024-04-02T10:15:00Z" } },
    ],
    newInput: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-03T11:30:00Z", detail: { "instance-id": "i-003", state: "pending" } },
    outputFormat: "json",
    expectedOutput: { source: "aws.ec2", type: "EC2 Instance State-change Notification", resource_id: "i-003", state: "pending", occurred_at: "2024-04-03T11:30:00Z" },
    expectedSerializedOutput: "{\n  \"source\": \"aws.ec2\",\n  \"type\": \"EC2 Instance State-change Notification\",\n  \"resource_id\": \"i-003\",\n  \"state\": \"pending\",\n  \"occurred_at\": \"2024-04-03T11:30:00Z\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-step-functions-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { detail: { status: "SUCCEEDED", executionArn: "arn:aws:states:eu-central-1:123:execution:ImportOrders:run-100", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:ImportOrders", startDate: "2024-04-01T09:00:00Z", stopDate: "2024-04-01T09:05:00Z" } }, output: { execution_arn: "arn:aws:states:eu-central-1:123:execution:ImportOrders:run-100", state_machine_arn: "arn:aws:states:eu-central-1:123:stateMachine:ImportOrders", status: "SUCCEEDED", started_at: "2024-04-01T09:00:00Z", finished_at: "2024-04-01T09:05:00Z" } },
      { input: { detail: { status: "FAILED", executionArn: "arn:aws:states:eu-central-1:123:execution:SyncInventory:run-200", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:SyncInventory", startDate: "2024-04-02T10:00:00Z", stopDate: "2024-04-02T10:02:00Z" } }, output: { execution_arn: "arn:aws:states:eu-central-1:123:execution:SyncInventory:run-200", state_machine_arn: "arn:aws:states:eu-central-1:123:stateMachine:SyncInventory", status: "FAILED", started_at: "2024-04-02T10:00:00Z", finished_at: "2024-04-02T10:02:00Z" } },
    ],
    newInput: { detail: { status: "RUNNING", executionArn: "arn:aws:states:eu-central-1:123:execution:BuildReport:run-300", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:BuildReport", startDate: "2024-04-03T11:00:00Z", stopDate: "2024-04-03T11:08:00Z" } },
    outputFormat: "json",
    expectedOutput: { execution_arn: "arn:aws:states:eu-central-1:123:execution:BuildReport:run-300", state_machine_arn: "arn:aws:states:eu-central-1:123:stateMachine:BuildReport", status: "RUNNING", started_at: "2024-04-03T11:00:00Z", finished_at: "2024-04-03T11:08:00Z" },
    expectedSerializedOutput: "{\n  \"execution_arn\": \"arn:aws:states:eu-central-1:123:execution:BuildReport:run-300\",\n  \"state_machine_arn\": \"arn:aws:states:eu-central-1:123:stateMachine:BuildReport\",\n  \"status\": \"RUNNING\",\n  \"started_at\": \"2024-04-03T11:00:00Z\",\n  \"finished_at\": \"2024-04-03T11:08:00Z\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-terraform-module-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { instance_type: "t3.large", subnet_id: "subnet-1", enable_monitoring: "true" }, output: { compute: { type: "t3.large", subnet: "subnet-1", monitoring: true } } },
      { input: { instance_type: "m6i.large", subnet_id: "subnet-2", enable_monitoring: "false" }, output: { compute: { type: "m6i.large", subnet: "subnet-2", monitoring: false } } },
    ],
    newInput: { instance_type: "c7g.large", subnet_id: "subnet-3", enable_monitoring: "true" },
    outputFormat: "json",
    expectedOutput: { compute: { type: "c7g.large", subnet: "subnet-3", monitoring: true } },
    expectedSerializedOutput: "{\n  \"compute\": {\n    \"type\": \"c7g.large\",\n    \"subnet\": \"subnet-3\",\n    \"monitoring\": true\n  }\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "golden-kubernetes-resources-json-to-json",
    suite: "golden-infra-workflows",
    category: "infrastructure",
    examples: [
      { input: { name: "api", resources: { cpu: "500m", memory: "256Mi" } }, output: { name: "api", resources: { limits: { cpu: "500m", memory: "256Mi" }, requests: { cpu: "250m", memory: "128Mi" } } } },
      { input: { name: "worker", resources: { cpu: "1000m", memory: "512Mi" } }, output: { name: "worker", resources: { limits: { cpu: "1000m", memory: "512Mi" }, requests: { cpu: "500m", memory: "256Mi" } } } },
    ],
    newInput: { name: "cron", resources: { cpu: "750m", memory: "1024Mi" } },
    outputFormat: "json",
    expectedOutput: { name: "cron", resources: { limits: { cpu: "750m", memory: "1024Mi" }, requests: { cpu: "375m", memory: "512Mi" } } },
    expectedSerializedOutput: "{\n  \"name\": \"cron\",\n  \"resources\": {\n    \"limits\": {\n      \"cpu\": \"750m\",\n      \"memory\": \"1024Mi\"\n    },\n    \"requests\": {\n      \"cpu\": \"375m\",\n      \"memory\": \"512Mi\"\n    }\n  }\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "hardening-csv-identifiers-and-total",
    suite: "hardening",
    category: "csv-types",
    examples: [
      { input: "account_id,invoice_id,zip,phone,total\n00123,INV-001,10115,+49 30 123456,119.50", inputFormat: "csv", output: { account_id: "00123", invoice_id: "INV-001", zip: "10115", phone: "+49 30 123456", total: 119.5 } },
      { input: "account_id,invoice_id,zip,phone,total\n00456,INV-002,90210,+1 415 555 0100,59.00", inputFormat: "csv", output: { account_id: "00456", invoice_id: "INV-002", zip: "90210", phone: "+1 415 555 0100", total: 59 } },
    ],
    newInput: "account_id,invoice_id,zip,phone,total\n00789,INV-003,75001,+33 1 23 45 67 89,240.75",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { account_id: "00789", invoice_id: "INV-003", zip: "75001", phone: "+33 1 23 45 67 89", total: 240.75 },
    expectedSerializedOutput: "{\n  \"account_id\": \"00789\",\n  \"invoice_id\": \"INV-003\",\n  \"zip\": \"75001\",\n  \"phone\": \"+33 1 23 45 67 89\",\n  \"total\": 240.75\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "hardening-json-nullable-profile-field",
    suite: "hardening",
    category: "nullable-fields",
    examples: [
      { input: { user: { name: "Ana", email: "ana@example.com", last_login: null } }, output: { name: "Ana", email: "ana@example.com", last_login: null } },
      { input: { user: { name: "Bo", email: "bo@example.com", last_login: "2024-05-01T10:00:00Z" } }, output: { name: "Bo", email: "bo@example.com", last_login: "2024-05-01T10:00:00Z" } },
    ],
    newInput: { user: { name: "Tim", email: "tim@example.com", last_login: null } },
    outputFormat: "json",
    expectedOutput: { name: "Tim", email: "tim@example.com", last_login: null },
    expectedSerializedOutput: "{\n  \"name\": \"Tim\",\n  \"email\": \"tim@example.com\",\n  \"last_login\": null\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "hardening-tsv-identifiers-to-json",
    suite: "hardening",
    category: "csv-types",
    examples: [
      { input: "User ID\tEmail\tLogin Count\n001\tANA@EXAMPLE.COM\t12", inputFormat: "csv", output: { user_id: "001", email: "ana@example.com", login_count: 12 } },
      { input: "User ID\tEmail\tLogin Count\n002\tBO@EXAMPLE.COM\t8", inputFormat: "csv", output: { user_id: "002", email: "bo@example.com", login_count: 8 } },
    ],
    newInput: "User ID\tEmail\tLogin Count\n003\tTIM@EXAMPLE.COM\t24",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { user_id: "003", email: "tim@example.com", login_count: 24 },
    expectedSerializedOutput: "{\n  \"user_id\": \"003\",\n  \"email\": \"tim@example.com\",\n  \"login_count\": 24\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "hardening-csv-quoted-comma-and-newline-to-json",
    suite: "hardening",
    category: "csv-quoting",
    examples: [
      { input: "order_id,name,address,note\n100,Ana,\"Main St 1, Berlin\",\"Gift\nWrap\"", inputFormat: "csv", output: { order_id: "100", name: "Ana", address: "Main St 1, Berlin", note: "Gift\nWrap" } },
      { input: "order_id,name,address,note\n200,Bo,\"Oak Ave 2, Paris\",\"Leave\nDoor\"", inputFormat: "csv", output: { order_id: "200", name: "Bo", address: "Oak Ave 2, Paris", note: "Leave\nDoor" } },
    ],
    newInput: "order_id,name,address,note\n300,Tim,\"Pine Rd 3, Madrid\",\"Call\nAhead\"",
    inputFormat: "csv",
    outputFormat: "json",
    expectedOutput: { order_id: "300", name: "Tim", address: "Pine Rd 3, Madrid", note: "Call\nAhead" },
    expectedSerializedOutput: "{\n  \"order_id\": \"300\",\n  \"name\": \"Tim\",\n  \"address\": \"Pine Rd 3, Madrid\",\n  \"note\": \"Call\\nAhead\"\n}",
    expectedOutputFormat: "json",
    minConfidence: 0.75,
  },
  {
    id: "hardening-missing-nested-source-diagnosis",
    suite: "hardening-diagnosis",
    category: "missing-fields",
    examples: [
      { input: { user: { name: "Ana", email: "ana@example.com" } }, output: { name: "Ana", email: "ana@example.com" } },
      { input: { user: { name: "Bo", email: "bo@example.com" } }, output: { name: "Bo", email: "bo@example.com" } },
    ],
    newInput: { user: { name: "Tim" } },
    outputFormat: "json",
    expectedOutput: { name: "Tim", email: "[missing $.user.email]" },
    expectedSerializedOutput: "{\n  \"name\": \"Tim\",\n  \"email\": \"[missing $.user.email]\"\n}",
    expectedOutputFormat: "json",
    expectedStatus: "unsafe",
    expectedWarnings: ["missing-source"],
    expectedSuggestedExampleExists: true,
    minConfidence: 0.35,
  },
  {
    id: "hardening-unseen-value-map-diagnosis",
    suite: "hardening-diagnosis",
    category: "unseen-values",
    examples: [
      { input: { id: "1", status: "active" }, output: { id: "1", state: "enabled" } },
      { input: { id: "2", status: "inactive" }, output: { id: "2", state: "disabled" } },
    ],
    newInput: { id: "3", status: "pending" },
    outputFormat: "json",
    expectedOutput: { id: "3", state: "[unresolved: unseen value at $.status]" },
    expectedSerializedOutput: "{\n  \"id\": \"3\",\n  \"state\": \"[unresolved: unseen value at $.status]\"\n}",
    expectedOutputFormat: "json",
    expectedStatus: "unsafe",
    expectedWarnings: ["unseen-value-map"],
    expectedSuggestedExampleExists: true,
    minConfidence: 0.35,
  },
  {
    id: "hardening-nested-array-map-safe",
    suite: "hardening",
    category: "nested-arrays",
    examples: [
      { input: { order: { id: "o1", items: [{ sku: "A" }, { sku: "B" }] } }, output: { order_id: "o1", skus: ["A", "B"] } },
      { input: { order: { id: "o2", items: [{ sku: "C" }] } }, output: { order_id: "o2", skus: ["C"] } },
    ],
    newInput: { order: { id: "o3", items: [{ sku: "D" }, { sku: "E" }] } },
    outputFormat: "json",
    expectedOutput: { order_id: "o3", skus: ["D", "E"] },
    expectedSerializedOutput: "{\n  \"order_id\": \"o3\",\n  \"skus\": [\n    \"D\",\n    \"E\"\n  ]\n}",
    expectedOutputFormat: "json",
    expectedStatus: "safe",
    minConfidence: 0.75,
  },
  {
    id: "hardening-array-aggregation-blocked",
    suite: "hardening-diagnosis",
    category: "nested-arrays",
    examples: [
      { input: { items: [{ sku: "A", qty: 2 }] }, output: { skus: ["A"], total_qty: 2 } },
      { input: { items: [{ sku: "B", qty: 3 }] }, output: { skus: ["B"], total_qty: 3 } },
    ],
    newInput: { items: [{ sku: "C" }, { sku: "D", qty: 4 }] },
    outputFormat: "json",
    expectedOutput: { skus: ["C", "D"] },
    expectedSerializedOutput: "{\n  \"skus\": [\n    \"C\",\n    \"D\"\n  ]\n}",
    expectedOutputFormat: "json",
    expectedStatus: "unsafe",
    expectedUnexplained: ["$.total_qty"],
    minConfidence: 0.2,
  },
  {
    id: "hardening-batch-failure-groups-and-change-ledger",
    suite: "hardening-diagnosis",
    category: "batch",
    examples: [
      { input: { id: "1", status: "active" }, output: { id: "1", state: "enabled" } },
      { input: { id: "2", status: "inactive" }, output: { id: "2", state: "disabled" } },
    ],
    newInput: [
      { id: "3", status: "active" },
      { id: "4", status: "pending" },
      { id: "5", status: "inactive" },
    ],
    outputFormat: "json",
    expectedOutput: [
      { id: "3", state: "enabled" },
      { id: "4", state: "[unresolved: unseen value at $.status]" },
      { id: "5", state: "disabled" },
    ],
    expectedSerializedOutput: "[\n  {\n    \"id\": \"3\",\n    \"state\": \"enabled\"\n  },\n  {\n    \"id\": \"4\",\n    \"state\": \"[unresolved: unseen value at $.status]\"\n  },\n  {\n    \"id\": \"5\",\n    \"state\": \"disabled\"\n  }\n]",
    expectedOutputFormat: "json",
    expectedStatus: "unsafe",
    expectedWarnings: ["unseen-value-map"],
    expectedBatchApplied: true,
    expectedBatchSummary: {
      totalRows: 3,
      failureCount: 1,
      groups: [{ type: "unseen-value-map", field: "$.status", rows: [2], sampleValue: "pending" }],
    },
    expectedChangeLedger: {
      mode: "batch-sample",
      rows: [{ kind: "mapped", target: "$.state", source: "$.status" }],
    },
    minConfidence: 0.35,
  },
  {
    id: "contract-missing-required-field-preset",
    suite: "contract-framing",
    category: "contract",
    examples: [
      { input: { user: { id: "u1", name: "Ana", email: "ana@example.com" } }, output: { id: "u1", name: "Ana", email: "ana@example.com" } },
      { input: { user: { id: "u2", name: "Bo", email: "bo@example.com" } }, output: { id: "u2", name: "Bo", email: "bo@example.com" } },
    ],
    newInput: { user: { id: "u3", name: "Tim" } },
    outputFormat: "json",
    expectedOutput: { id: "u3", name: "Tim", email: "[missing $.user.email]" },
    expectedSerializedOutput: "{\n  \"id\": \"u3\",\n  \"name\": \"Tim\",\n  \"email\": \"[missing $.user.email]\"\n}",
    expectedOutputFormat: "json",
    expectedStatus: "unsafe",
    expectedWarnings: ["missing-source"],
    expectedSuggestedExampleExists: true,
    minConfidence: 0.35,
  },
  {
    id: "contract-schema-new-field-preset",
    suite: "contract-framing",
    category: "contract",
    examples: [
      { input: { name: "Ana", email: "ana@example.com" }, output: { contact: "Ana", email: "ana@example.com" } },
      { input: { name: "Bo", email: "bo@example.com" }, output: { contact: "Bo", email: "bo@example.com" } },
    ],
    newInput: { name: "Tim", email: "tim@example.com", source: "web-form" },
    outputFormat: "json",
    expectedOutput: { contact: "Tim", email: "tim@example.com" },
    expectedSerializedOutput: "{\n  \"contact\": \"Tim\",\n  \"email\": \"tim@example.com\"\n}",
    expectedOutputFormat: "json",
    expectedStatus: "safe",
    expectedSchemaDrift: [{ type: "schema-new-field", path: "$.source" }],
    minConfidence: 0.75,
  },
];

function deepEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function serializedEqual(actual, expected, outputFormat) {
  if (outputFormat !== "yaml") return actual === expected;
  try {
    return deepEqual(parseYAML(actual), parseYAML(expected));
  } catch {
    return actual === expected;
  }
}

function confidenceComparable(confidence = {}) {
  if (Number.isFinite(confidence.checks?.passed) && Number.isFinite(confidence.checks?.total) && confidence.checks.total > 0) {
    return confidence.checks.passed / confidence.checks.total;
  }
  return 0;
}

export function benchmarkTranslator() {
  const results = TRANSLATOR_BENCHMARKS.map(task => {
    const started = Date.now();
    try {
      const result = runTransform(task);
      const failures = [];
      if (!deepEqual(result.output, task.expectedOutput)) {
        failures.push(`output expected ${JSON.stringify(task.expectedOutput)}, got ${JSON.stringify(result.output)}`);
      }
      if (!serializedEqual(result.serializedOutput, task.expectedSerializedOutput, task.expectedOutputFormat)) {
        failures.push(`serialized output expected ${JSON.stringify(task.expectedSerializedOutput)}, got ${JSON.stringify(result.serializedOutput)}`);
      }
      if (result.outputFormat !== task.expectedOutputFormat) {
        failures.push(`output format expected ${task.expectedOutputFormat}, got ${result.outputFormat}`);
      }
      const confidence = confidenceComparable(result.confidence);
      if (confidence < task.minConfidence) {
        failures.push(`confidence expected >= ${task.minConfidence}, got ${confidence}`);
      }
      if (task.expectedStatus && result.status !== task.expectedStatus) {
        failures.push(`status expected ${task.expectedStatus}, got ${result.status}`);
      }
      if (task.expectedWarnings?.length) {
        const warningTypes = new Set([
          ...(result.warnings || []).map(warning => warning.type),
          ...(result.diagnosis?.guardrails || []).map(warning => warning.type),
        ]);
        for (const expectedWarning of task.expectedWarnings) {
          if (!warningTypes.has(expectedWarning)) {
            failures.push(`warning expected ${expectedWarning}, got ${JSON.stringify([...warningTypes])}`);
          }
        }
      }
      if (task.expectedUnexplained?.length) {
        const unexplained = new Set(result.diagnosis?.unexplained || result.diagnostics?.unexplained || []);
        for (const expectedPath of task.expectedUnexplained) {
          if (!unexplained.has(expectedPath)) {
            failures.push(`unexplained expected ${expectedPath}, got ${JSON.stringify([...unexplained])}`);
          }
        }
      }
      if (task.expectedSuggestedExampleExists !== undefined) {
        const hasSuggestion = (result.diagnosis?.suggestedExamples || []).length > 0;
        if (hasSuggestion !== task.expectedSuggestedExampleExists) {
          failures.push(`suggested example existence expected ${task.expectedSuggestedExampleExists}, got ${hasSuggestion}`);
        }
      }
      if (task.expectedBatchApplied !== undefined && result.translator?.batchApplied !== task.expectedBatchApplied) {
        failures.push(`batchApplied expected ${task.expectedBatchApplied}, got ${result.translator?.batchApplied}`);
      }
      if (task.expectedSchemaDrift?.length) {
        const driftItems = [
          ...(result.diagnosis?.schemaDrift?.blocking || []),
          ...(result.diagnosis?.schemaDrift?.advisory || []),
          ...(result.diagnostics?.schemaDrift?.blocking || []),
          ...(result.diagnostics?.schemaDrift?.advisory || []),
        ];
        for (const expectedDrift of task.expectedSchemaDrift) {
          const found = driftItems.some(item => item.type === expectedDrift.type && item.path === expectedDrift.path);
          if (!found) {
            failures.push(`schema drift expected ${expectedDrift.type} at ${expectedDrift.path}, got ${JSON.stringify(driftItems)}`);
          }
        }
      }
      if (task.expectedBatchSummary) {
        const summary = result.batchSummary || {};
        for (const key of ["totalRows", "failureCount"]) {
          if (task.expectedBatchSummary[key] !== undefined && summary[key] !== task.expectedBatchSummary[key]) {
            failures.push(`batchSummary.${key} expected ${task.expectedBatchSummary[key]}, got ${summary[key]}`);
          }
        }
        for (const expectedGroup of task.expectedBatchSummary.groups || []) {
          const group = (summary.groups || []).find(item => item.type === expectedGroup.type && item.field === expectedGroup.field);
          if (!group) {
            failures.push(`batchSummary group expected ${expectedGroup.type} ${expectedGroup.field}`);
            continue;
          }
          if (expectedGroup.rows && !deepEqual(group.rows, expectedGroup.rows)) {
            failures.push(`batchSummary rows expected ${JSON.stringify(expectedGroup.rows)}, got ${JSON.stringify(group.rows)}`);
          }
          if (expectedGroup.sampleValue !== undefined && !deepEqual(group.sampleValue, expectedGroup.sampleValue)) {
            failures.push(`batchSummary sampleValue expected ${JSON.stringify(expectedGroup.sampleValue)}, got ${JSON.stringify(group.sampleValue)}`);
          }
        }
      }
      if (task.expectedChangeLedger) {
        const ledger = result.changeLedger || {};
        if (task.expectedChangeLedger.mode && ledger.mode !== task.expectedChangeLedger.mode) {
          failures.push(`changeLedger.mode expected ${task.expectedChangeLedger.mode}, got ${ledger.mode}`);
        }
        for (const expectedRow of task.expectedChangeLedger.rows || []) {
          const row = (ledger.rows || []).find(item => item.kind === expectedRow.kind && item.target === expectedRow.target && item.source === expectedRow.source);
          if (!row) {
            failures.push(`changeLedger row expected ${JSON.stringify(expectedRow)}, got ${JSON.stringify(ledger.rows || [])}`);
          }
        }
      }

      return {
        id: task.id,
        suite: task.suite,
        category: task.category,
        passed: failures.length === 0,
        failures,
        output: result.output,
        serializedOutput: result.serializedOutput,
        outputFormat: result.outputFormat,
        confidence: result.confidence,
        status: result.status,
        telemetry: { durationMs: Date.now() - started },
      };
    } catch (error) {
      return {
        id: task.id,
        suite: task.suite,
        category: task.category,
        passed: false,
        failures: [error?.message || "Unknown error"],
        telemetry: { durationMs: Date.now() - started },
      };
    }
  });

  return {
    total: results.length,
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).map(result => result.id),
    results,
    telemetry: results.map(result => result.telemetry),
  };
}
