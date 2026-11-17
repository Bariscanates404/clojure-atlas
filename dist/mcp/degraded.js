const SHOWN = 3;
const EDN_FILE = /\.edn$/;
export const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
export function degradation(doc) {
    const stats = doc.stats;
    const withErrors = typeof stats?.syntax_errors?.files === 'number' ? stats.syntax_errors.files : 0;
    const recoveredFiles = typeof stats?.syntax_errors?.recovered === 'number' ? stats.syntax_errors.recovered : 0;
    const recoveredNames = strings(stats?.syntax_errors?.recovered_names);
    const files = Math.max(0, withErrors - recoveredFiles);
    const names = strings(stats?.syntax_errors?.names).filter((n) => !recoveredNames.includes(n));
    const recovered = { files: recoveredFiles, names: recoveredNames };
    const edges = typeof stats?.dropped_edges === 'number' ? stats.dropped_edges : 0;
    const largeNames = strings(stats?.files?.skipped_large_names);
    const large = { files: typeof stats?.files?.skipped_large === 'number' ? stats.files.skipped_large : 0, names: largeNames,
        edn: typeof stats?.files?.skipped_large_edn === 'number' ? stats.files.skipped_large_edn : largeNames.filter((n) => EDN_FILE.test(n)).length };
    const counted = (n, names) => ({ files: typeof n === 'number' ? n : 0, names: strings(names) });
    const timedOut = counted(stats?.files?.timed_out, stats?.files?.timed_out_names);
    const unread = counted(stats?.files?.unread, stats?.files?.unread_names);
    const why = stats?.files?.unread_why;
    const unreadWhy = Object.fromEntries(Object.entries(why && typeof why === 'object' ? why : {}).filter(([, v]) => typeof v === 'string'));
    const duplicates = Array.isArray(stats?.duplicate_namespaces)
        ? stats.duplicate_namespaces.flatMap((d) => (typeof d?.ns === 'string' ? [d.ns] : []))
        : [];
    return files > 0 || recovered.files > 0 || edges > 0 || large.files > 0 || duplicates.length > 0 || timedOut.files > 0 || unread.files > 0
        ? { files, names, recovered, edges, large, duplicates, timedOut, unread, unreadWhy } : null;
}
const listed = (names, total) => `${names.slice(0, SHOWN).join(', ')}${total > SHOWN ? ', ...' : ''}`;
const UNREAD_REASONS = [
    ['hidden-or-build-folder', 'sit in a hidden path, node_modules or a module-root build folder'],
    ['symlink', 'are symbolic links, which the build does not follow'],
    ['deleted', 'are deleted in the working tree'],
];
// Tracked Clojure files the build never analyzed, one part per recorded reason; a file with no recorded reason (an older graph, or
// a name past the cap) is told by the reasons it could have.
function unreadParts(d) {
    const out = [];
    let counted = 0;
    for (const [reason, text] of UNREAD_REASONS) {
        const names = d.unread.names.filter((n) => d.unreadWhy[n] === reason);
        counted += names.length;
        if (names.length)
            out.push(`${names.length} tracked Clojure file(s) ${text} (${listed(names, names.length)}), so their definitions and calls are missing`);
    }
    const rest = d.unread.names.filter((n) => !UNREAD_REASONS.some(([r]) => d.unreadWhy[n] === r));
    const left = d.unread.files - counted;
    if (left > 0) {
        out.push(`${left} tracked Clojure file(s) were not analyzed, as git tracks them but the file walk did not read them, whether they sit in a hidden path, ` +
            `node_modules or a build folder, are symbolic links, or are deleted in the working ` +
            `tree${rest.length ? ` (${listed(rest, left)})` : ''}, so their definitions and calls are missing`);
    }
    return out;
}
// One line, same words in the build log, graph_info and every answer.
export function degradedLine(d) {
    const parts = [];
    if (d.files) {
        parts.push(`${d.files} file(s) could not be parsed${d.names.length ? ` (${listed(d.names, d.files)})` : ''}, so their definitions and calls are missing`);
    }
    if (d.recovered.files) {
        parts.push(`${d.recovered.files} file(s) have syntax errors but were ` +
            `analyzed${d.recovered.names.length ? ` (${listed(d.recovered.names, d.recovered.files)})` : ''}; some forms in them may be missing`);
    }
    const sourceLarge = d.large.names.filter((n) => !EDN_FILE.test(n));
    const ednLarge = d.large.names.filter((n) => EDN_FILE.test(n));
    if (d.large.files - d.large.edn > 0) {
        const shown = sourceLarge.length ? ` (${listed(sourceLarge, d.large.files - d.large.edn)})` : '';
        parts.push(`${d.large.files - d.large.edn} file(s) over 2 MB were skipped${shown}, so their definitions and calls are missing`);
    }
    if (d.large.edn > 0) {
        const shown = ednLarge.length ? ` (${listed(ednLarge, d.large.edn)})` : '';
        parts.push(`${d.large.edn} .edn file(s) over 2 MB were skipped${shown}, so the data, keys and config they hold are missing`);
    }
    if (d.timedOut.files) {
        parts.push(`${d.timedOut.files} file(s) were not analyzed because clj-kondo did not finish on them (${listed(d.timedOut.names, d.timedOut.files)}), so ` +
            `their definitions and calls are missing`);
    }
    parts.push(...unreadParts(d));
    if (d.duplicates.length) {
        const shown = listed(d.duplicates, d.duplicates.length);
        parts.push(`${d.duplicates.length} namespace(s) defined in more than one file (${shown}) share one node each, so calls into them are heuristic`);
    }
    if (d.edges)
        parts.push(`${d.edges} edge(s) dropped because an end was not a node`);
    return `DEGRADED: ${parts.join('; ')}; an empty or missing answer may be a gap in the graph, not absence`;
}
const matching = (names, query) => {
    if (!names.length)
        return [];
    const q = query.trim().replace(/^definition:/, '');
    const ns = q.split('/')[0];
    const rel = ns.replace(/\./g, '/').replace(/-/g, '_');
    return names.filter((n) => n === q || (rel !== '' && new RegExp(`(^|/)${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.clj[sc]?$`).test(n)));
};
// The unparsed files a name could live in: "demo.broken/oops" or "demo.broken" matches src/demo/broken.clj (also
// with underscores for dashes), a repo path matches itself.
export const unparsedFor = (d, query) => matching(d?.names ?? [], query);
// The files with syntax errors that were still analyzed, a name could live in: a form kondo could not read may be the one missing.
export const recoveredFor = (d, query) => matching(d?.recovered.names ?? [], query);
// The files a name could live in that were never analyzed: killed by the timeout, or tracked but outside the file walk.
export const unanalyzedFor = (d, query) => ({ timedOut: matching(d?.timedOut.names ?? [], query), unread: matching(d?.unread.names ?? [], query) });
// The same for the files skipped as too large.
export const skippedFor = (d, query) => matching(d?.large.names ?? [], query);
