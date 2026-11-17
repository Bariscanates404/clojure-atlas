// Takes working-tree snapshots off the main thread, so a shared HTTP server keeps answering while git and hashing run.
import { parentPort } from 'node:worker_threads';
import { snapshotOf } from "./snapshot.js";
parentPort.on('message', ({ id, root, analyzer }) => {
    try {
        parentPort.postMessage({ id, snapshot: snapshotOf(root, analyzer) });
    }
    catch (err) {
        parentPort.postMessage({ id, error: err.message });
    }
});
