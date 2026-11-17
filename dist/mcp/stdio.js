// The stdio JSON-RPC 2.0 core of the MCP server (one message per line): initialize, ping, tools/list and
// tools/call. @modelcontextprotocol/sdk is not a dependency, and these four methods are all a read-only
// tool server needs. A server hands over its identity, its tool list and one `callTool`; a tool may answer
// synchronously or with a promise.
// Newest first: a client asking for a version not listed gets the newest, and decides whether it can speak it.
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const reply = (id, result) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
// Argument names a tool requires that the call leaves blank (a string or a list with a non-blank string).
export function missingArguments(required, args) {
    const present = (v) => (typeof v === 'string' ? !!v.trim() : Array.isArray(v) && v.some((x) => typeof x === 'string' && x.trim()));
    return required.filter((k) => !present(args[k]));
}
const typeOf = (v) => (Array.isArray(v) ? 'array' : typeof v);
// What is wrong with one argument value, or null.
function problem(k, schema, v) {
    const got = typeOf(v);
    if (schema.type !== 'array') {
        if (schema.type && got !== schema.type)
            return `${k} must be a ${schema.type}, got ${got}`;
        return schema.enum && !schema.enum.includes(v) ? `${k} must be one of ${schema.enum.join(', ')}, got ${JSON.stringify(v)}` : null;
    }
    // a lone string stands for a list of one string, as the tools read it
    if (!Array.isArray(v))
        return schema.items?.type === 'string' && got === 'string' ? null : `${k} must be a list, got ${got}`;
    const wrong = schema.items?.type ? v.find((x) => typeOf(x) !== schema.items?.type) : undefined;
    return wrong === undefined ? null : `${k} must be a list of ${schema.items?.type}, got a list with a ${typeOf(wrong)}`;
}
// What is wrong with the arguments a call passes, one sentence each: a present (non-null) value of the wrong type or
// outside its enum. Arguments the schema does not list are left alone.
export function invalidArguments(props, args) {
    return Object.entries(props).flatMap(([k, schema]) => {
        const v = args[k];
        const p = v === undefined || v === null ? null : problem(k, schema, v);
        return p === null ? [] : [p];
    });
}
export function stdioServer(def) {
    const toolFailed = (id, name, err) => {
        process.stderr.write(`${def.name}: ${name} failed: ${err.stack ?? err}\n`);
        return reply(id, { content: [{ type: 'text', text: `${name} failed: ${err.message}` }], isError: true });
    };
    function handleMessage(ctx, msg) {
        if (typeof msg !== 'object' || msg === null || Array.isArray(msg))
            return fail(null, -32600, 'invalid request');
        const req = msg;
        const isNotification = req.id === undefined;
        if (!isNotification && req.id !== null && typeof req.id !== 'string' && typeof req.id !== 'number')
            return fail(null, -32600, 'invalid request: id must be a string, a number or null');
        if (req.jsonrpc !== '2.0')
            return isNotification ? null : fail(req.id, -32600, 'invalid request: jsonrpc must be "2.0"');
        if (typeof req.method !== 'string')
            return isNotification ? null : fail(req.id, -32600, 'invalid request: no method');
        // JSON-RPC: a notification (no id) is never answered, whatever its method
        if (isNotification)
            return null;
        switch (req.method) {
            case 'initialize': {
                const requested = req.params?.protocolVersion;
                return reply(req.id, {
                    protocolVersion: typeof requested === 'string' && SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL,
                    capabilities: { tools: {} },
                    serverInfo: { name: def.name, version: def.version },
                    ...(def.instructions !== undefined ? { instructions: def.instructions } : {}),
                });
            }
            case 'ping':
                return reply(req.id, {});
            case 'tools/list':
                return reply(req.id, { tools: def.listTools() });
            case 'tools/call': {
                const name = req.params?.name;
                const args = (req.params?.arguments ?? {});
                if (typeof name !== 'string')
                    return fail(req.id, -32602, 'tools/call needs params.name');
                if (!def.listTools().some((t) => t.name === name))
                    return fail(req.id, -32602, `unknown tool ${name}`);
                const done = ({ text, isError }) => reply(req.id, { content: [{ type: 'text', text }], isError });
                try {
                    const out = def.callTool(ctx, name, args);
                    return out instanceof Promise ? out.then(done, (err) => toolFailed(req.id, name, err)) : done(out);
                }
                catch (err) {
                    return toolFailed(req.id, name, err);
                }
            }
            default:
                return fail(req.id, -32601, `method not found: ${req.method}`);
        }
    }
    function handleLine(ctx, line) {
        if (!line.trim())
            return null;
        let msg;
        try {
            msg = JSON.parse(line.startsWith('\uFEFF') ? line.slice(1) : line);
        }
        catch (err) {
            process.stderr.write(`${def.name}: unparsable message: ${err.message}\n`);
            return fail(null, -32700, 'parse error');
        }
        return handleMessage(ctx, msg);
    }
    function serve(ctx) {
        const lines = lineSplitter((line) => {
            void Promise.resolve(handleLine(ctx, line)).then((res) => {
                if (res)
                    process.stdout.write(`${JSON.stringify(res)}\n`);
            });
        });
        // a client that closed our stdout is gone: end quietly instead of dying on the unhandled write error
        process.stdout.on('error', (err) => {
            if (err.code === 'EPIPE')
                process.exit(0);
            process.stderr.write(`${def.name}: cannot write to stdout: ${err.message}\n`);
            process.exit(1);
        });
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => lines.push(chunk));
        process.stdin.on('end', () => lines.end());
    }
    return { handleMessage, handleLine, serve };
}
// Splits a stream on "\n" only (a trailing "\r" is dropped). readline also breaks on U+2028 and U+2029, which JSON
// allows unescaped inside strings, so a valid request would arrive as two unparsable halves.
export function lineSplitter(onLine) {
    let buf = '';
    const emit = (l) => onLine(l.endsWith('\r') ? l.slice(0, -1) : l);
    return {
        push: (chunk) => {
            buf += chunk;
            let i = buf.indexOf('\n');
            while (i >= 0) {
                emit(buf.slice(0, i));
                buf = buf.slice(i + 1);
                i = buf.indexOf('\n');
            }
        },
        end: () => {
            if (buf !== '')
                emit(buf);
            buf = '';
        },
    };
}
