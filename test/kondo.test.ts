// Locating clj-kondo (the pinned native release fetched once into the cache, checked by sha256, else clj-kondo on PATH)
// and running it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ASSETS, cacheRoot, downloader, HOST, KONDO_VERSION, locateKondo, unzipEntry, type KondoHost } from '../src/build/kondo-binary.ts';
import { analyze, chunkFiles } from '../src/build/kondo.ts';

// A minimal zip holding the given files (one deflated, one stored), written by hand.
function zipOf(files: [string, Buffer, boolean][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data, deflate] of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const cache = mkdtempSync(path.join(tmpdir(), 'atlas-kondo-'));
after(() => rmSync(cache, { recursive: true, force: true }));

const release = zipOf([['clj-kondo', Buffer.from('#!/bin/sh\n'), true]]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// A host whose download and `--version` are recorded; `runs` lists the commands that answer --version.
function host(over: Partial<KondoHost> & { runs?: string[]; dir: string }) {
  const log = { downloads: [] as string[], warnings: [] as string[] };
  const h: KondoHost = {
    platform: 'testos', arch: 'x1', assets: { 'testos-x1': ['testos-x1', sha(release)] }, cacheDir: path.join(cache, over.dir),
    download: async (url) => {
      log.downloads.push(url);
      return release;
    },
    version: (cmd) => ((over.runs ?? []).some((r) => cmd.endsWith(r)) ? `clj-kondo v-${path.basename(path.dirname(cmd))}` : null),
    warn: (m) => log.warnings.push(m),
    ...over,
  };
  return { h, log };
}

describe('kondo binary', () => {
  it('pins one release asset with a sha256 per supported platform', () => {
    assert.equal(KONDO_VERSION, '2025.10.23');
    assert.deepEqual(Object.keys(ASSETS).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    for (const [, digest] of Object.values(ASSETS)) assert.match(digest, /^[0-9a-f]{64}$/);
  });

  it('extracts a deflated or stored entry by name and refuses a missing one or a non-zip', () => {
    const zip = zipOf([['README', Buffer.from('r'), false], ['clj-kondo', Buffer.from('binary'.repeat(50)), true]]);
    assert.equal(unzipEntry(zip, 'clj-kondo').toString(), 'binary'.repeat(50));
    assert.equal(unzipEntry(zip, 'README').toString(), 'r');
    assert.throws(() => unzipEntry(zip, 'nope'), /not in the archive/);
    assert.throws(() => unzipEntry(Buffer.from('plain text, long enough to hold an end record'), 'x'), /not a zip archive/);
  });

  it('fetches the pinned release once into the cache, executable, and reuses it', async () => {
    const { h, log } = host({ dir: 'ok', runs: ['clj-kondo'] });
    const k = await locateKondo(h);
    const target = path.join(cache, 'ok', `clj-kondo-${KONDO_VERSION}-testos-x1`, 'clj-kondo');
    assert.deepEqual(k, { command: target, version: `clj-kondo v-clj-kondo-${KONDO_VERSION}-testos-x1` });
    assert.equal(readFileSync(target, 'utf8'), '#!/bin/sh\n');
    assert.equal(statSync(target).mode & 0o111, 0o111);
    assert.deepEqual(log.downloads, [`https://github.com/clj-kondo/clj-kondo/releases/download/v${KONDO_VERSION}/clj-kondo-${KONDO_VERSION}-testos-x1.zip`]);
    await locateKondo(h);
    assert.equal(log.downloads.length, 1);
  });

  it('refuses a download whose sha256 is not the pinned one, writes nothing, and uses clj-kondo on PATH', async () => {
    const { h, log } = host({ dir: 'bad', runs: ['clj-kondo'], assets: { 'testos-x1': ['testos-x1', '0'.repeat(64)] } });
    assert.equal((await locateKondo(h)).command, 'clj-kondo');
    assert.match(log.warnings.join('\n'), /sha256 [0-9a-f]{64}, expected 0{64}; refusing to run it; using clj-kondo on PATH/);
    assert.equal(existsSync(path.join(cache, 'bad')), false);
    const none = host({ dir: 'bad2', assets: { 'testos-x1': ['testos-x1', '0'.repeat(64)] } });
    await assert.rejects(locateKondo(none.h), /refusing to run it, and there is no clj-kondo on PATH/);
  });

  it('says on stderr that it is downloading, before it does', async () => {
    const { h, log } = host({ dir: 'say', runs: ['clj-kondo'] });
    await locateKondo(h);
    assert.match(log.warnings[0], /^downloading clj-kondo 2025\.10\.23 \(testos-x1\) once, to /);
  });

  it('falls back to clj-kondo on PATH without a native release or a download, and says why', async () => {
    const unsupported = host({ dir: 'none', platform: 'plan9', runs: ['clj-kondo'] });
    assert.equal((await locateKondo(unsupported.h)).command, 'clj-kondo');
    assert.match(unsupported.log.warnings[0], /has no native release for plan9-x1; using clj-kondo on PATH/);
    const offline = host({ dir: 'offline', runs: ['clj-kondo'], download: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
    assert.equal((await locateKondo(offline.h)).command, 'clj-kondo');
    assert.match(offline.log.warnings[1], /cannot download .*\(getaddrinfo ENOTFOUND\); using clj-kondo on PATH/);
  });

  it('stops with the reason when nothing can run', async () => {
    await assert.rejects(locateKondo(host({ dir: 'n1', platform: 'plan9' }).h), /no native release for plan9-x1, and there is no clj-kondo on PATH/);
    await assert.rejects(locateKondo(host({ dir: 'n2' }).h), /clj-kondo does not run; delete it and run again/);
  });
});

describe('the real host', () => {
  it('downloads the bytes of a 200 answer and names the status of any other', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/ok') res.end('zip bytes');
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.equal((await HOST.download(`${base}/ok`)).toString(), 'zip bytes');
      await assert.rejects(HOST.download(`${base}/missing`), /^Error: HTTP 404$/);
    } finally {
      server.close();
    }
  });

  it('answers the version of a command that runs, null for one that is missing or cannot run', () => {
    assert.match(HOST.version(process.execPath) ?? '', /^v\d+\./);
    assert.equal(HOST.version(path.join(cache, 'no-such-kondo')), null);
    const notExecutable = path.join(cache, 'plain-file');
    writeFileSync(notExecutable, 'x');
    assert.equal(HOST.version(notExecutable), null);
  });
});

describe('the cache directory', () => {
  it('uses an absolute XDG_CACHE_HOME or LOCALAPPDATA, and treats an empty or relative one as unset', () => {
    assert.equal(cacheRoot({ XDG_CACHE_HOME: '/x/cache' }, 'linux', '/home/u'), '/x/cache');
    assert.equal(cacheRoot({ XDG_CACHE_HOME: '' }, 'linux', '/home/u'), '/home/u/.cache');
    assert.equal(cacheRoot({ XDG_CACHE_HOME: 'rel/cache' }, 'darwin', '/home/u'), '/home/u/.cache');
    assert.equal(cacheRoot({}, 'linux', '/home/u'), '/home/u/.cache');
    assert.equal(cacheRoot({ LOCALAPPDATA: 'C:\\L' }, 'win32', '/h'), path.join('/h', 'AppData', 'Local'));
  });
});

describe('a download that never ends', () => {
  it('gives up after the timeout so the PATH fallback is reached', async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const started = Date.now();
      await assert.rejects(downloader(300)(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`));
      assert.ok(Date.now() - started < 5000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('chunking the command line', () => {
  it('keeps every run under the file count and the character budget, in order, and loses nothing', () => {
    const files = Array.from({ length: 1000 }, (_, i) => `${'d/'.repeat(100)}file-${i}.clj`);
    const runs = chunkFiles(files);
    assert.deepEqual(runs.flat(), files);
    for (const run of runs) {
      assert.ok(run.length <= 300);
      assert.ok(run.reduce((n, f) => n + f.length + 1, 0) <= 24_000);
    }
    assert.ok(runs.length > Math.ceil(1000 / 300));
    assert.deepEqual(chunkFiles([]), []);
    assert.deepEqual(chunkFiles(['a'.repeat(30)], 300, 10), [['a'.repeat(30)]]);
  });
});

describe('analyze', () => {
  it('stops with the command when it cannot start, and with the exit code when it prints no analysis', async () => {
    await assert.rejects(analyze(path.join(cache, 'no-such-kondo'), cache, ['a.clj'], {}), /cannot run .*no-such-kondo: spawn .* ENOENT/);
    const silent = path.join(cache, 'silent-kondo');
    writeFileSync(silent, '#!/bin/sh\necho "WARNING: noise" >&2\necho "it broke" >&2\nexit 7\n', { mode: 0o755 });
    await assert.rejects(analyze(silent, cache, ['a.clj', 'b.clj'], {}), /clj-kondo exited 7 without analysis on 2 file\(s\) from a\.clj: it broke$/);
  });
});
