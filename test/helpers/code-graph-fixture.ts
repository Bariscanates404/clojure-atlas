// Tiny in-memory code-graph builder for the MCP tests: synthetic names only, no real graph file.
import type { Band, Capability, Graph, GraphDocument, GraphEdge, GraphNode } from '../../src/mcp/graph.ts';
import { indexGraph } from '../../src/mcp/graph.ts';

export const ALL_CAPS: Capability[] = [
  'definitions', 'routes', 'route_authz', 'events', 'data_attributes', 'selectors', 'browser_tests', 'requests', 'implementations',
].map((name) => ({ name, status: 'available' as const }));

export class GraphBuilder {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  caps: Capability[] = ALL_CAPS.map((c) => ({ ...c }));
  sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  private line = 1;

  node(kind: string, name: string, extra: Partial<GraphNode> = {}): string {
    const id = extra.id ?? `${kind}:${name}`;
    this.nodes.push({ id, kind, name, file: `src/${kind}.x`, line: this.line++, ...extra });
    return id;
  }

  def(name: string, component = 'components/core', extra: Partial<GraphNode> = {}): string {
    const file = extra.file ?? `${component}/src/${name.replace(/[/.]/g, '_')}.clj`;
    return this.node('definition', name, { component, file, ...extra });
  }

  edge(from: string, kind: string, to: string, extra: Partial<GraphEdge> & { band?: Band } = {}): this {
    this.edges.push({ from, to, kind, band: 'static_proven', file: 'src/site.x', line: this.line++, ...extra });
    return this;
  }

  route(method: string, path: string, base = 'app', mount = '/api'): string {
    return this.node('route', `${method} ${mount}${path} @${base}`, {
      id: `route:${method} ${path} @${base}${mount}`,
      attrs: { method: method.toLowerCase(), path, full_path: `${mount}${path}`, base, mount },
    });
  }

  doc(): GraphDocument {
    return {
      format: 'code-graph',
      version: 1,
      source: { repo_name: 'demo', ref: 'main', sha: this.sha, built_at: '2026-01-01T00:00:00Z' },
      capabilities: this.caps,
      nodes: this.nodes,
      edges: this.edges,
    };
  }

  build(): Graph {
    return indexGraph(this.doc());
  }
}

export const graph = (f: (b: GraphBuilder) => void): Graph => {
  const b = new GraphBuilder();
  f(b);
  return b.build();
};
