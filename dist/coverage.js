export function coverageRow(doc, graphBytes) {
    const u = doc.stats.usages;
    const inProject = u.resolved + u.unresolved;
    return {
        repo: doc.source.repo_name ?? '?',
        sha: doc.source.sha,
        filesExpected: doc.stats.files.expected,
        files: doc.stats.files.sources,
        syntaxErrorFiles: doc.stats.syntax_errors.files,
        definitions: doc.stats.definitions,
        resolved: u.resolved,
        unresolved: u.unresolved,
        unknown: u.unknown,
        resolutionRate: inProject ? (100 * u.resolved) / inProject : null,
        // edges an adapter added; nodes for one that adds no edges (key tables)
        adapters: Object.fromEntries(Object.entries(doc.stats.adapters).map(([k, a]) => [k, doc.capabilities.find((c) => c.name === k)?.edge_kinds?.length ? a.edges
                : a.nodes])),
        nodes: doc.nodes.length,
        edges: doc.edges.length,
        unknownEdges: doc.edges.filter((e) => e.band === 'unknown').length,
        droppedEdges: doc.stats.dropped_edges ?? 0,
        buildMs: doc.stats.build_ms ?? 0,
        graphBytes,
    };
}
export const pct = (x) => (x === null ? 'n/a' : `${x.toFixed(1)}%`);
const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
export function coverageTable(rows) {
    const adapters = [...new Set(rows.flatMap((r) => Object.keys(r.adapters)))];
    const head = ['repo', 'files expected', 'files analyzed', 'syntax-error files', 'definitions', 'resolved', 'unresolved', 'resolution rate',
        'unknown namespace', ...adapters, 'unknown edges', 'dropped edges', 'build', 'graph'];
    const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
    for (const r of rows) {
        lines.push(`| ${[
            r.repo, r.filesExpected, r.files, r.syntaxErrorFiles, r.definitions, r.resolved, r.unresolved, pct(r.resolutionRate), r.unknown,
            ...adapters.map((a) => r.adapters[a] ?? 0), r.unknownEdges, r.droppedEdges, `${(r.buildMs / 1000).toFixed(1)} s`, kb(r.graphBytes),
        ].join(' | ')} |`);
    }
    return lines.join('\n');
}
