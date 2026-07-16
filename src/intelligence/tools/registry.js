import { jsonTransformTool } from "../json-transform/index.js";
import { regexBuilderTool } from "../regex-builder/index.js";
import { traceTool } from "../trace/index.js";
import { assertToolContract } from "../contracts.js";

export const INTELLIGENCE_TOOLS = [jsonTransformTool, regexBuilderTool, traceTool];

for (const tool of INTELLIGENCE_TOOLS) assertToolContract(tool);

export const INTELLIGENCE_ROUTES = INTELLIGENCE_TOOLS.map(tool => ({
  path: tool.metadata().route,
  toolId: tool.metadata().id,
  title: tool.metadata().title,
  status: tool.metadata().status,
  lifecycle: tool.metadata().lifecycle,
}));

export const INTELLIGENCE_SUBPAGE_ROUTES = INTELLIGENCE_TOOLS.flatMap(tool =>
  tool.metadata().routes.map(route => ({
    ...route,
    toolId: tool.metadata().id,
    status: tool.metadata().status,
    lifecycle: tool.metadata().lifecycle,
  }))
);

export function getIntelligenceTool(id) {
  return INTELLIGENCE_TOOLS.find(tool => tool.metadata().id === id) || null;
}

export function getIntelligenceToolByRoute(route) {
  return INTELLIGENCE_TOOLS.find(tool => tool.metadata().routes.some(r => r.path === route)) || null;
}
