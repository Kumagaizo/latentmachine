/**
 * Public Transformation Contract API.
 *
 * The publish preparation step rewrites this source import to the bundled
 * engine snapshot so consumers never depend on the monorepo layout.
 */
export * from "../../../src/intelligence/contracts/index.js";
