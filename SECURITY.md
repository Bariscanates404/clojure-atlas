# Security

clojure-atlas reads repositories it does not trust, so a way to make it run code from the analyzed repository, read
outside it, or hang is a security bug here, not only a crash.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository
([direct link](https://github.com/Bariscanates404/clojure-atlas/security/advisories/new)). Do not open a public
issue for it.

Useful in a report: the version or commit, the operating system, the smallest repository or file that shows it, and
what happened (a command ran, a file outside the repository was read or written, the build never ended).

This is a personal project maintained in spare time, so there is no guaranteed response time, but every report is
read. A fix comes with a test that reproduces the problem, and the advisory is published once a fixed revision is
on `main`.

## What is in scope

- The analyzed repository making Atlas execute a command, a Git hook or filter, project TypeScript or any other code.
- Reading or writing files outside the analyzed repository and Atlas's own cache directory.
- The clj-kondo download: a binary that is run without matching the pinned SHA-256.
- A crafted graph file or MCP request that crashes the server or makes it use unbounded memory or time.
- The local HTTP server accepting requests without its bearer token, bypassing Host/Origin validation, or
  accessing a repository that was not registered at startup. See the [HTTP access boundaries](docs/GUIDE.md#transport-and-access-boundaries).

## What is not

- The project's own `.clj-kondo` hooks are interpreted by clj-kondo. That configuration is code you trust when you
  analyze a repository; the README says so.
- A `clj-kondo` found on `PATH` when the pinned download is unavailable is trusted as you installed it.
- What your AI client does with the answers Atlas returns.

How Atlas runs Git and clj-kondo is described in [docs/GUIDE.md](docs/GUIDE.md#security).
