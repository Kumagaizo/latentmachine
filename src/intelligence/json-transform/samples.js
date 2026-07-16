export const DEFAULT_JSON_TRANSFORM_SAMPLE_ID = "hubspot-contacts";

export const JSON_TRANSFORM_SAMPLE_GROUPS = [
  { id: "cross-format", label: "Data", description: "Everyday CSV, JSON, and API cleanup workflows" },
  { id: "workflow", label: "Workflows", description: "Reusable business workflow translations" },
  { id: "contract", label: "Contracts", description: "Reusable payload contracts that stay safe on known shapes and flag drift when data changes" },
  { id: "infra", label: "Infrastructure", description: "Cloud, config, .env, Terraform, and Kubernetes transforms" },
];

export const JSON_TRANSFORM_SAMPLES = [
  {
    id: "json-to-csv",
    label: "Product JSON",
    group: "cross-format",
    description: "Turn product records into CSV rows for spreadsheet review",
    examples: [
      {
        input: { id: "gid://shopify/Product/100", title: "Solar Lamp", sku: "SL-1", price: "49.99", tags: ["Outdoor", "Solar"], status: "ACTIVE" },
        output: "product_id,title,sku,price,tags,status\n100,Solar Lamp,SL-1,49.99,Outdoor | Solar,ACTIVE",
        outputFormat: "csv",
      },
      {
        input: { id: "gid://shopify/Product/200", title: "Desk Chair", sku: "DC-2", price: "129.00", tags: ["Office", "Furniture"], status: "DRAFT" },
        output: "product_id,title,sku,price,tags,status\n200,Desk Chair,DC-2,129.00,Office | Furniture,DRAFT",
        outputFormat: "csv",
      },
    ],
    newInput: { id: "gid://shopify/Product/300", title: "Travel Mug", sku: "TM-3", price: "24.50", tags: ["Kitchen", "Travel"], status: "ACTIVE" },
    outputFormat: "csv",
  },
  {
    id: "stripe-accounting-csv",
    label: "Stripe payout",
    group: "cross-format",
    description: "Translate nested payment JSON into an accounting CSV row",
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
  },
  {
    id: "spreadsheet-to-api",
    label: "CSV to API",
    group: "cross-format",
    description: "Translate spreadsheet rows into nested API payloads",
    examples: [
      {
        input: "Name,Email,Role\nAna Lopez,ANA@EXAMPLE.COM,admin",
        inputFormat: "csv",
        output: { user: { name: "Ana Lopez", email: "ana@example.com" }, role: "admin" },
      },
      {
        input: "Name,Email,Role\nBo Smith,BO@TEST.COM,viewer",
        inputFormat: "csv",
        output: { user: { name: "Bo Smith", email: "bo@test.com" }, role: "viewer" },
      },
    ],
    newInput: "Name,Email,Role\nTim Berg,TIM@SITE.COM,editor\nMina Cho,MINA@SITE.COM,admin",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "hubspot-contacts",
    label: "HubSpot contacts",
    group: "cross-format",
    description: "Clean CRM exports into API-ready contact JSON",
    examples: [
      {
        input: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n101,Ana,Lopez,ANA@EXAMPLE.COM,+1 (415) 555-0101,customer",
        inputFormat: "csv",
        output: { id: "101", name: "Ana Lopez", email: "ana@example.com", phone: "+14155550101", stage: "customer" },
      },
      {
        input: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n202,Bo,Smith,BO@EXAMPLE.COM,+44 20 7946 0958,lead",
        inputFormat: "csv",
        output: { id: "202", name: "Bo Smith", email: "bo@example.com", phone: "+442079460958", stage: "lead" },
      },
    ],
    newInput: "Record ID,First Name,Last Name,Email,Phone,Lifecycle Stage\n303,Tim,Berg,TIM@EXAMPLE.COM,(650) 555-9876,customer",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "xml-orders",
    label: "XML orders",
    group: "cross-format",
    description: "Extract attributes and child elements from XML into JSON",
    examples: [
      {
        input: "<order id=\"o1\"><customer>Ana</customer><total>119.50</total><status>paid</status></order>",
        inputFormat: "xml",
        output: { order_id: "o1", customer: "Ana", total: 119.5, paid: true },
      },
      {
        input: "<order id=\"o2\"><customer>Bo</customer><total>59.00</total><status>due</status></order>",
        inputFormat: "xml",
        output: { order_id: "o2", customer: "Bo", total: 59, paid: false },
      },
    ],
    newInput: "<order id=\"o3\"><customer>Tim</customer><total>240.75</total><status>paid</status></order>",
    newInputFormat: "xml",
    outputFormat: "json",
  },
  {
    id: "k8s-config-yaml",
    label: "Kubernetes YAML",
    group: "cross-format",
    description: "Extract deployment details from a Kubernetes manifest",
    examples: [
      {
        input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web-app\n  namespace: production\n  labels:\n    app: web\nspec:\n  replicas: 3\n  template:\n    spec:\n      containers:\n        - name: web\n          image: myapp:1.2.3",
        inputFormat: "yaml",
        output: { name: "web-app", namespace: "production", app: "web", replicas: 3, image: "myapp:1.2.3" },
      },
      {
        input: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n  namespace: staging\n  labels:\n    app: api\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - name: api\n          image: myapp:2.0.0",
        inputFormat: "yaml",
        output: { name: "api", namespace: "staging", app: "api", replicas: 1, image: "myapp:2.0.0" },
      },
    ],
    newInput: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: worker\n  namespace: production\n  labels:\n    app: worker\nspec:\n  replicas: 5\n  template:\n    spec:\n      containers:\n        - name: worker\n          image: myapp:2.1.0",
    newInputFormat: "yaml",
    outputFormat: "json",
  },
  {
    id: "yaml-config-flatten",
    label: "YAML config",
    group: "cross-format",
    description: "Flatten service configuration YAML into JSON",
    examples: [
      {
        input: "database:\n  host: localhost\n  port: 5432\n  name: app\ncache:\n  host: localhost\n  port: 6379",
        inputFormat: "yaml",
        output: { db_host: "localhost", db_port: 5432, db_name: "app", cache_host: "localhost", cache_port: 6379 },
      },
      {
        input: "database:\n  host: db.internal\n  port: 5432\n  name: analytics\ncache:\n  host: redis.internal\n  port: 6380",
        inputFormat: "yaml",
        output: { db_host: "db.internal", db_port: 5432, db_name: "analytics", cache_host: "redis.internal", cache_port: 6380 },
      },
    ],
    newInput: "database:\n  host: prod-db.internal\n  port: 5432\n  name: billing\ncache:\n  host: prod-redis.internal\n  port: 6379",
    newInputFormat: "yaml",
    outputFormat: "json",
  },
  {
    id: "yaml-user-batch",
    label: "YAML users",
    group: "cross-format",
    description: "Transform a YAML list of user records as a batch",
    examples: [
      {
        input: "name: Ana Lopez\nemail: ANA@EXAMPLE.COM\nrole: admin",
        inputFormat: "yaml",
        output: { person: "Ana Lopez", email: "ana@example.com", access: "admin" },
      },
      {
        input: "name: Bo Smith\nemail: BO@EXAMPLE.COM\nrole: viewer",
        inputFormat: "yaml",
        output: { person: "Bo Smith", email: "bo@example.com", access: "viewer" },
      },
    ],
    newInput: "- name: Tim Berg\n  email: TIM@SITE.COM\n  role: editor\n- name: Mina Cho\n  email: MINA@SITE.COM\n  role: admin",
    newInputFormat: "yaml",
    outputFormat: "json",
  },
  {
    id: "messy-csv-cleanup",
    label: "Airtable cleanup",
    group: "cross-format",
    description: "Clean names, emails, booleans, and headers in exported table data",
    examples: [
      {
        input: "Name,Owner Email,Tags,Status\n\"  Launch Plan \",ANA@EXAMPLE.COM,strategy | planning,Active",
        inputFormat: "csv",
        output: "title,owner_email,tags,is_active\nLaunch Plan,ana@example.com,strategy | planning,true",
        outputFormat: "csv",
      },
      {
        input: "Name,Owner Email,Tags,Status\n\"Roadmap Review\",BO@EXAMPLE.COM,product | q3,Inactive",
        inputFormat: "csv",
        output: "title,owner_email,tags,is_active\nRoadmap Review,bo@example.com,product | q3,false",
        outputFormat: "csv",
      },
      {
        input: "Name,Owner Email,Tags,Status\n\"Project   Brief\",MINA@EXAMPLE.COM,content | draft,Active",
        inputFormat: "csv",
        output: "title,owner_email,tags,is_active\nProject Brief,mina@example.com,content | draft,true",
        outputFormat: "csv",
      },
    ],
    newInput: "Name,Owner Email,Tags,Status\n\" QA Checklist \",TIM@EXAMPLE.COM,quality | release,Active",
    newInputFormat: "csv",
    outputFormat: "csv",
  },
  {
    id: "tsv-user-import",
    label: "TSV users",
    group: "cross-format",
    description: "Normalize tab-separated user exports without changing tools",
    examples: [
      {
        input: "User ID\tEmail\tLogin Count\n001\tANA@EXAMPLE.COM\t12",
        inputFormat: "csv",
        output: { user_id: "001", email: "ana@example.com", login_count: 12 },
      },
      {
        input: "User ID\tEmail\tLogin Count\n002\tBO@EXAMPLE.COM\t8",
        inputFormat: "csv",
        output: { user_id: "002", email: "bo@example.com", login_count: 8 },
      },
    ],
    newInput: "User ID\tEmail\tLogin Count\n003\tTIM@EXAMPLE.COM\t24",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "shopify-product-csv",
    label: "Shopify product",
    group: "cross-format",
    description: "Flatten a single-variant Shopify product JSON into a product import CSV",
    examples: [
      {
        input: { id: 101, title: "Desk Lamp", status: "active", variants: [{ sku: "DL-001", price: "39.00", inventory_quantity: 12 }] },
        output: "product_id,title,sku,status\n101,Desk Lamp,DL-001,ACTIVE",
        outputFormat: "csv",
      },
      {
        input: { id: 202, title: "Wall Shelf", status: "draft", variants: [{ sku: "WS-002", price: "55.00", inventory_quantity: 4 }] },
        output: "product_id,title,sku,status\n202,Wall Shelf,WS-002,DRAFT",
        outputFormat: "csv",
      },
      {
        input: { id: 404, title: "Garden Hose", status: "active", variants: [{ sku: "GH-004", price: "25.00", inventory_quantity: 2 }] },
        output: "product_id,title,sku,status\n404,Garden Hose,GH-004,ACTIVE",
        outputFormat: "csv",
      },
    ],
    newInput: { id: 303, title: "Cable Box", status: "active", variants: [{ sku: "CB-003", price: "18.00", inventory_quantity: 24 }] },
    outputFormat: "csv",
  },
  {
    id: "cms-migration",
    label: "CMS migration",
    group: "workflow",
    description: "WordPress export to Webflow CMS import",
    examples: [
      {
        input: { id: 10, title: { rendered: "Solar Guide" }, slug: "solar-guide", date: "2024-03-15T09:30:00", status: "publish" },
        output: "post_id,title,slug,published_at,status\n10,Solar Guide,solar-guide,2024-03-15,publish",
        outputFormat: "csv",
      },
      {
        input: { id: 20, title: { rendered: "Heat Pump" }, slug: "heat-pump", date: "2024-06-01T14:00:00", status: "draft" },
        output: "post_id,title,slug,published_at,status\n20,Heat Pump,heat-pump,2024-06-01,draft",
        outputFormat: "csv",
      },
    ],
    newInput: { id: 30, title: { rendered: "Battery Storage" }, slug: "battery-storage", date: "2024-09-20T08:00:00", status: "publish" },
    outputFormat: "csv",
  },
  {
    id: "support-tickets",
    label: "Support tickets",
    group: "workflow",
    description: "Turn a ticket export into normalized JSON, including tag arrays",
    examples: [
      {
        input: "Ticket ID,Requester,Priority,Tags\nT-1,Ana,urgent,\"billing; vip\"",
        inputFormat: "csv",
        output: { id: "T-1", requester: "Ana", priority: "urgent", tags: ["billing", "vip"] },
      },
      {
        input: "Ticket ID,Requester,Priority,Tags\nT-2,Bo,normal,\"bug; product\"",
        inputFormat: "csv",
        output: { id: "T-2", requester: "Bo", priority: "normal", tags: ["bug", "product"] },
      },
    ],
    newInput: "Ticket ID,Requester,Priority,Tags\nT-3,Tim,urgent,\"account; vip\"\nT-4,Mina,normal,\"docs; product\"",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "api-normalization",
    label: "Webhook cleanup",
    group: "workflow",
    description: "Normalize webhook payloads from different sources",
    examples: [
      {
        input: { user: { first: "Ana", last: "Lopez" }, account: { id: "a1" }, login_count: "12" },
        output: { name: "Ana Lopez", accountId: "a1", logins: 12 },
      },
      {
        input: { user: { first: "Bo", last: "Smith" }, account: { id: "a2" }, login_count: "5" },
        output: { name: "Bo Smith", accountId: "a2", logins: 5 },
      },
    ],
    newInput: { user: { first: "Tim", last: "Berg" }, account: { id: "a3" }, login_count: "28" },
  },
  {
    id: "inventory-cleanup",
    label: "Inventory import",
    group: "workflow",
    description: "Normalize product records for import",
    examples: [
      {
        input: { sku: "WP-001", product_name: "widget pro", price: "29.99", in_stock: "true" },
        output: { sku: "WP-001", name: "Widget Pro", price: 29.99, available: true },
      },
      {
        input: { sku: "WP-002", product_name: "gadget mini", price: "14.50", in_stock: "false" },
        output: { sku: "WP-002", name: "Gadget Mini", price: 14.5, available: false },
      },
    ],
    newInput: { sku: "WP-003", product_name: "sensor basic", price: "9.00", in_stock: "true" },
  },
  {
    id: "invoice-import",
    label: "Invoice import",
    group: "workflow",
    description: "Convert invoice CSV rows into nested finance JSON",
    examples: [
      { input: "invoice_id,customer,net,tax,status\nINV-1,Ana,100,19,paid", inputFormat: "csv", output: { invoice: { id: "INV-1", customer: "Ana" }, gross: 119, paid: true } },
      { input: "invoice_id,customer,net,tax,status\nINV-2,Bo,50,9,due", inputFormat: "csv", output: { invoice: { id: "INV-2", customer: "Bo" }, gross: 59, paid: false } },
    ],
    newInput: "invoice_id,customer,net,tax,status\nINV-3,Tim,80,15,paid",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "semicolon-export",
    label: "Semicolon CSV",
    group: "workflow",
    description: "Handle European spreadsheet exports without changing modes",
    examples: [
      { input: "Name;Email;Score\nAna;ANA@EXAMPLE.COM;1200", inputFormat: "csv", output: { name: "Ana", email: "ana@example.com", score: 1200 } },
      { input: "Name;Email;Score\nBo;BO@EXAMPLE.COM;940", inputFormat: "csv", output: { name: "Bo", email: "bo@example.com", score: 940 } },
    ],
    newInput: "Name;Email;Score\nTim;TIM@EXAMPLE.COM;880",
    newInputFormat: "csv",
    outputFormat: "json",
  },
  {
    id: "analytics-events",
    label: "Analytics events",
    group: "workflow",
    description: "Flatten nested event JSON into CSV for analysis",
    examples: [
      { input: { event: "signup", user: { id: "u1" }, timestamp: "2024-03-15T09:30:00Z", properties: { plan: "pro" } }, output: "event,user_id,event_date,plan\nsignup,u1,2024-03-15,pro", outputFormat: "csv" },
      { input: { event: "purchase", user: { id: "u2" }, timestamp: "2024-06-01T14:00:00Z", properties: { plan: "starter" } }, output: "event,user_id,event_date,plan\npurchase,u2,2024-06-01,starter", outputFormat: "csv" },
    ],
    newInput: { event: "signup", user: { id: "u3" }, timestamp: "2024-09-20T08:00:00Z", properties: { plan: "enterprise" } },
    outputFormat: "csv",
  },
  {
    id: "make-order-webhook",
    label: "Make webhook",
    group: "workflow",
    description: "Unwrap Make webhook metadata into an order payload",
    examples: [
      {
        input: { scenario: { id: "9001" }, bundle: { input: { order: { id: "ORD-100", customer: { email: "ana@example.com" }, total: "129.99", items: [{ sku: "DL-001", qty: 1 }] } } }, metadata: { execution_id: "exec-100" } },
        output: { scenario_id: "9001", execution_id: "exec-100", order_id: "ORD-100", customer_email: "ana@example.com", total: "129.99", skus: ["DL-001"] },
      },
      {
        input: { scenario: { id: "9002" }, bundle: { input: { order: { id: "ORD-200", customer: { email: "bo@example.com" }, total: "59.00", items: [{ sku: "WS-002", qty: 2 }] } } }, metadata: { execution_id: "exec-200" } },
        output: { scenario_id: "9002", execution_id: "exec-200", order_id: "ORD-200", customer_email: "bo@example.com", total: "59.00", skus: ["WS-002"] },
      },
    ],
    newInput: { scenario: { id: "9003" }, bundle: { input: { order: { id: "ORD-300", customer: { email: "tim@example.com" }, total: "240.75", items: [{ sku: "CB-003", qty: 2 }, { sku: "HD-010", qty: 1 }] } } }, metadata: { execution_id: "exec-300" } },
    outputFormat: "json",
  },
  {
    id: "n8n-webhook-csv",
    label: "n8n webhook",
    group: "workflow",
    description: "Turn nested n8n webhook JSON into event CSV",
    examples: [
      {
        input: { body: { event: "signup", user: { id: "u001", email: "ana@example.com", plan: "pro" }, timestamp: "2024-03-15T09:30:00Z" }, query: { source: "website" } },
        output: "event,user_id,email,plan,event_date,source\nsignup,u001,ana@example.com,pro,2024-03-15,website",
        outputFormat: "csv",
      },
      {
        input: { body: { event: "purchase", user: { id: "u002", email: "bo@example.com", plan: "starter" }, timestamp: "2024-06-01T14:00:00Z" }, query: { source: "campaign" } },
        output: "event,user_id,email,plan,event_date,source\npurchase,u002,bo@example.com,starter,2024-06-01,campaign",
        outputFormat: "csv",
      },
    ],
    newInput: { body: { event: "signup", user: { id: "u003", email: "tim@example.com", plan: "enterprise" }, timestamp: "2024-09-20T08:00:00Z" }, query: { source: "website" } },
    outputFormat: "csv",
  },
  {
    id: "contract-value-map-drift",
    label: "Status mapping",
    group: "contract",
    description: "Map known status values and flag new statuses when payloads drift",
    examples: [
      { input: { id: "u1", status: "active" }, output: { id: "u1", state: "enabled" } },
      { input: { id: "u2", status: "archived" }, output: { id: "u2", state: "disabled" } },
    ],
    newInput: [
      { id: "u3", status: "active" },
      { id: "u4", status: "archived" },
      { id: "u5", status: "archived" },
    ],
    outputFormat: "json",
  },
  {
    id: "contract-missing-required-field",
    label: "Required fields",
    group: "contract",
    description: "Reuse a contact contract that blocks payloads missing required fields",
    examples: [
      { input: { user: { id: "u1", name: "Ana", email: "ana@example.com" } }, output: { id: "u1", name: "Ana", email: "ana@example.com" } },
      { input: { user: { id: "u2", name: "Bo", email: "bo@example.com" } }, output: { id: "u2", name: "Bo", email: "bo@example.com" } },
    ],
    newInput: { user: { id: "u3", name: "Tim", email: "tim@example.com" } },
    outputFormat: "json",
  },
  {
    id: "contract-schema-new-field",
    label: "Extra field",
    group: "contract",
    description: "Show harmless schema drift when a new unused field appears",
    examples: [
      { input: { name: "Ana", email: "ana@example.com" }, output: { contact: "Ana", email: "ana@example.com" } },
      { input: { name: "Bo", email: "bo@example.com" }, output: { contact: "Bo", email: "bo@example.com" } },
    ],
    newInput: { name: "Tim", email: "tim@example.com", source: "web-form" },
    outputFormat: "json",
  },
  {
    id: "aws-s3-records",
    label: "AWS S3 records",
    group: "infra",
    description: "Normalize S3 notification records into internal event JSON",
    examples: [
      {
        input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectCreated:Put", eventTime: "2024-05-01T10:00:00Z", s3: { bucket: { name: "app-uploads" }, object: { key: "inbox%2Fsummer+trip.jpg", size: 2048, eTag: "etag-1", versionId: "v1", sequencer: "001" } } }] },
        output: [{ source: "aws:s3", event: "ObjectCreated:Put", bucket: "app-uploads", key: "inbox/summer trip.jpg", size: 2048, e_tag: "etag-1", version_id: "v1", sequencer: "001", occurred_at: "2024-05-01T10:00:00Z" }],
      },
      {
        input: { Records: [{ eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-02T11:30:00Z", s3: { bucket: { name: "audit-logs" }, object: { key: "old%2Ftax+form.pdf", size: 512, eTag: "etag-2", versionId: "v2", sequencer: "002" } } }] },
        output: [{ source: "aws:s3", event: "ObjectRemoved:Delete", bucket: "audit-logs", key: "old/tax form.pdf", size: 512, e_tag: "etag-2", version_id: "v2", sequencer: "002", occurred_at: "2024-05-02T11:30:00Z" }],
      },
    ],
    newInput: { Records: [
      { eventSource: "aws:s3", eventName: "ObjectCreated:Post", eventTime: "2024-05-03T12:45:00Z", s3: { bucket: { name: "media" }, object: { key: "photos%2Fhero+banner.png", size: 8192, eTag: "etag-3", versionId: "v3", sequencer: "003" } } },
      { eventSource: "aws:s3", eventName: "ObjectRemoved:Delete", eventTime: "2024-05-04T13:00:00Z", s3: { bucket: { name: "media" }, object: { key: "old%2Farchive+copy.zip", size: 4096, eTag: "etag-4", versionId: "v4", sequencer: "004" } } },
    ] },
    outputFormat: "json",
  },
  {
    id: "vercel-env-config",
    label: "Vercel .env",
    group: "infra",
    description: "Extract deployment config from a Vercel or Next.js .env file",
    examples: [
      {
        input: "NEXT_PUBLIC_APP_URL=https://staging.example.com/app\nNEXT_PUBLIC_ANALYTICS_ID=G-STAGE123\nVERCEL_ENV=preview\nDATABASE_URL=postgres://stage_user:pass@stage-db.example.com:5432/app",
        inputFormat: "env",
        output: { app_url: "https://staging.example.com/app", analytics_id: "G-STAGE123", environment: "preview", database_url: "postgres://stage_user:pass@stage-db.example.com:5432/app" },
      },
      {
        input: "NEXT_PUBLIC_APP_URL=https://app.example.com/dashboard\nNEXT_PUBLIC_ANALYTICS_ID=G-PROD456\nVERCEL_ENV=production\nDATABASE_URL=postgres://prod_user:pass@prod-db.example.com:5432/app",
        inputFormat: "env",
        output: { app_url: "https://app.example.com/dashboard", analytics_id: "G-PROD456", environment: "production", database_url: "postgres://prod_user:pass@prod-db.example.com:5432/app" },
      },
    ],
    newInput: "NEXT_PUBLIC_APP_URL=https://app.example.com/dashboard?tab=overview#team\nNEXT_PUBLIC_ANALYTICS_ID=G-LIVE789\nVERCEL_ENV=production\nDATABASE_URL=postgres://live_user:p%40ss@live-db.example.com:5432/app?sslmode=require",
    newInputFormat: "env",
    outputFormat: "json",
  },
  {
    id: "toml-service-config",
    label: "TOML config",
    group: "infra",
    description: "Flatten service configuration TOML into deployment JSON",
    examples: [
      {
        input: "[service]\nname = \"api\"\nport = 3000\nenabled = true\n\n[database]\nhost = \"stage-db.internal\"\n\n[[routes]]\npath = \"/api\"\nupstream = \"api:3000\"",
        inputFormat: "toml",
        output: { service: "api", port: 3000, enabled: true, database_host: "stage-db.internal" },
      },
      {
        input: "[service]\nname = \"web\"\nport = 8080\nenabled = false\n\n[database]\nhost = \"prod-db.internal\"\n\n[[routes]]\npath = \"/app\"\nupstream = \"web:8080\"",
        inputFormat: "toml",
        output: { service: "web", port: 8080, enabled: false, database_host: "prod-db.internal" },
      },
    ],
    newInput: "[service]\nname = \"worker\"\nport = 9000\nenabled = true\n\n[database]\nhost = \"jobs-db.internal\"\n\n[[routes]]\npath = \"/jobs\"\nupstream = \"worker:9000\"",
    newInputFormat: "toml",
    outputFormat: "json",
  },
  {
    id: "docker-env-runtime",
    label: "Docker .env",
    group: "infra",
    description: "Remap Docker Compose env_file values into runtime variable names",
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
    newInput: "APP_ENV=staging\nAPI_PORT=4173\nAPI_BASE_URL=https://staging-api.example.com/v1\nLOG_LEVEL=debug",
    newInputFormat: "env",
    outputFormat: "env",
  },
  {
    id: "json-to-env-runtime",
    label: "JSON to .env",
    group: "infra",
    description: "Generate a flat runtime .env file from structured app config",
    examples: [
      {
        input: { service: { name: "api", env: "staging", port: 3000 }, database: { url: "postgres://stage-db/app" }, logging: { level: "info" } },
        output: "APP_NAME=api\nNODE_ENV=staging\nPORT=3000\nDATABASE_URL=postgres://stage-db/app\nLOG_LEVEL=info\n",
        outputFormat: "env",
      },
      {
        input: { service: { name: "worker", env: "production", port: 8080 }, database: { url: "postgres://prod-db/app" }, logging: { level: "warn" } },
        output: "APP_NAME=worker\nNODE_ENV=production\nPORT=8080\nDATABASE_URL=postgres://prod-db/app\nLOG_LEVEL=warn\n",
        outputFormat: "env",
      },
    ],
    newInput: { service: { name: "scheduler", env: "production", port: 9000 }, database: { url: "postgres://jobs-db/app" }, logging: { level: "debug" } },
    outputFormat: "env",
  },
  {
    id: "eventbridge-ec2",
    label: "EventBridge EC2",
    group: "infra",
    description: "Convert EventBridge state-change events into a stable event envelope",
    examples: [
      {
        input: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-01T09:00:00Z", detail: { "instance-id": "i-001", state: "running" } },
        output: { source: "aws.ec2", type: "EC2 Instance State-change Notification", resource_id: "i-001", state: "running", occurred_at: "2024-04-01T09:00:00Z" },
      },
      {
        input: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-02T10:15:00Z", detail: { "instance-id": "i-002", state: "stopped" } },
        output: { source: "aws.ec2", type: "EC2 Instance State-change Notification", resource_id: "i-002", state: "stopped", occurred_at: "2024-04-02T10:15:00Z" },
      },
    ],
    newInput: { source: "aws.ec2", "detail-type": "EC2 Instance State-change Notification", time: "2024-04-03T11:30:00Z", detail: { "instance-id": "i-003", state: "pending" } },
    outputFormat: "json",
  },
  {
    id: "step-functions-status",
    label: "Step Functions",
    group: "infra",
    description: "Flatten Step Functions execution details for job-status pipelines",
    examples: [
      {
        input: { detail: { status: "SUCCEEDED", executionArn: "arn:aws:states:eu-central-1:123:execution:ImportOrders:run-100", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:ImportOrders", startDate: "2024-04-01T09:00:00Z", stopDate: "2024-04-01T09:05:00Z" } },
        output: { execution_arn: "arn:aws:states:eu-central-1:123:execution:ImportOrders:run-100", state_machine_arn: "arn:aws:states:eu-central-1:123:stateMachine:ImportOrders", status: "SUCCEEDED", started_at: "2024-04-01T09:00:00Z", finished_at: "2024-04-01T09:05:00Z" },
      },
      {
        input: { detail: { status: "FAILED", executionArn: "arn:aws:states:eu-central-1:123:execution:SyncInventory:run-200", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:SyncInventory", startDate: "2024-04-02T10:00:00Z", stopDate: "2024-04-02T10:02:00Z" } },
        output: { execution_arn: "arn:aws:states:eu-central-1:123:execution:SyncInventory:run-200", state_machine_arn: "arn:aws:states:eu-central-1:123:stateMachine:SyncInventory", status: "FAILED", started_at: "2024-04-02T10:00:00Z", finished_at: "2024-04-02T10:02:00Z" },
      },
    ],
    newInput: { detail: { status: "RUNNING", executionArn: "arn:aws:states:eu-central-1:123:execution:BuildReport:run-300", stateMachineArn: "arn:aws:states:eu-central-1:123:stateMachine:BuildReport", startDate: "2024-04-03T11:00:00Z", stopDate: "2024-04-03T11:08:00Z" } },
    outputFormat: "json",
  },
  {
    id: "terraform-module",
    label: "Terraform module",
    group: "infra",
    description: "Reshape flat Terraform JSON inputs into a nested module schema",
    examples: [
      { input: { instance_type: "t3.large", subnet_id: "subnet-1", enable_monitoring: "true" }, output: { compute: { type: "t3.large", subnet: "subnet-1", monitoring: true } } },
      { input: { instance_type: "m6i.large", subnet_id: "subnet-2", enable_monitoring: "false" }, output: { compute: { type: "m6i.large", subnet: "subnet-2", monitoring: false } } },
    ],
    newInput: { instance_type: "c7g.large", subnet_id: "subnet-3", enable_monitoring: "true" },
    outputFormat: "json",
  },
  {
    id: "kubernetes-resources",
    label: "Kubernetes resources",
    group: "infra",
    description: "Expand shorthand resource policy JSON into limits and requests",
    examples: [
      { input: { name: "api", resources: { cpu: "500m", memory: "256Mi" } }, output: { name: "api", resources: { limits: { cpu: "500m", memory: "256Mi" }, requests: { cpu: "250m", memory: "128Mi" } } } },
      { input: { name: "worker", resources: { cpu: "1000m", memory: "512Mi" } }, output: { name: "worker", resources: { limits: { cpu: "1000m", memory: "512Mi" }, requests: { cpu: "500m", memory: "256Mi" } } } },
    ],
    newInput: { name: "cron", resources: { cpu: "750m", memory: "1024Mi" } },
    outputFormat: "json",
  },
  {
    id: "github-actions-yaml",
    label: "GitHub Actions",
    group: "infra",
    description: "Extract workflow metadata from GitHub Actions YAML",
    examples: [
      {
        input: "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20",
        inputFormat: "yaml",
        output: { workflow: "CI", runner: "ubuntu-latest", node: 20 },
      },
      {
        input: "name: Release\njobs:\n  build:\n    runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22",
        inputFormat: "yaml",
        output: { workflow: "Release", runner: "ubuntu-22.04", node: 22 },
      },
    ],
    newInput: "name: Nightly\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24",
    newInputFormat: "yaml",
    outputFormat: "json",
  },
  {
    id: "docker-compose-yaml",
    label: "Docker Compose",
    group: "infra",
    description: "Summarize Docker Compose service configuration",
    examples: [
      {
        input: "services:\n  api:\n    image: app:1.0\n    ports:\n      - \"3000:3000\"\n    environment:\n      APP_ENV: staging",
        inputFormat: "yaml",
        output: "service:\n  name: api\n  image: app:1.0\n  port: 3000:3000\n  env: staging\n",
        outputFormat: "yaml",
      },
      {
        input: "services:\n  api:\n    image: app:2.0\n    ports:\n      - \"8080:8080\"\n    environment:\n      APP_ENV: production",
        inputFormat: "yaml",
        output: "service:\n  name: api\n  image: app:2.0\n  port: 8080:8080\n  env: production\n",
        outputFormat: "yaml",
      },
    ],
    newInput: "services:\n  api:\n    image: registry.example.com/api:3.0\n    ports:\n      - \"8080:8080\"\n    environment:\n      APP_ENV: production",
    newInputFormat: "yaml",
    outputFormat: "yaml",
  },
];
