// Library API: load a code-graph file once and call the same queries the MCP serves.
export {
  BANDS, FORMAT, SUPPORTED_VERSIONS, VERSION, GraphFormatError, graphFromJson, indexGraph, loadGraph, parseDocument,
  type Band, type Capability, type Graph, type GraphDocument, type GraphEdge, type GraphNode,
} from './graph.ts';
export {
  attributeUsage, blastRadius, callers, canonicalRoute, contextForChange, eventFlow, parseChange, testsFor, findRoutes, MAX_DEPTH, permissionExpression,
  permissionRoutes, resolve, routeAuthz, testsCovering, type QueryResult, type Row, type Section,
} from './queries.ts';
export {
  arityFor, keyFlow, keySiblings, signatureImpact, siblingAnalysis, signatureOf, similarKeys, type ArityDesc, type SignatureChange, type TableRow,
} from './keyflow.ts';
export { render, type RenderOptions } from './render.ts';
export { DEFAULT_MAX_DISTANCE, staleness, type Staleness, type StalenessOptions } from './staleness.ts';
export { callTool, handleMessage } from './server.ts';
