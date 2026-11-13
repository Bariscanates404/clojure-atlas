// One spelling for path parameters (:id, {id}, *rest), so a path written either way matches. The build keys routes
// and requests with it and the MCP lookup canonicalizes a query with it: both sides must agree on every path.
export const canonicalPath = (p: string): string => p.replace(/\{[^}]*\}|:[^/]+|\*[^/]*/g, '{p}');
