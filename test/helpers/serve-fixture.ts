// A stdio server that answers ping, for the tests that run it as a child process.
import { stdioServer } from '../../src/mcp/stdio.ts';

stdioServer<object>({ name: 'fixture', version: '0', listTools: () => [], callTool: () => ({ text: '', isError: false }) }).serve({});
