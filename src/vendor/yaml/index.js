/**
 * yaml v2.9.0 - YAML 1.2 parser and serializer for JavaScript
 * Author: Eemeli Aro (https://github.com/eemeli/yaml)
 * License: ISC
 *
 * Vendored into this project because YAML parsing is too complex and
 * dangerous to implement from scratch. This file is a frozen copy.
 * The project has zero runtime dependencies; this is owned source code.
 */

// `export * as default from ...` fails on Webpack v4
// https://github.com/eemeli/yaml/issues/228
import * as YAML from './dist/index.js'
export default YAML
export * from './dist/index.js'
