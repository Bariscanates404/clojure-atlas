# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Setup

Node.js 22.18 or newer. The `.ts` sources run directly; there is no build step for development.

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
```

Run the CLI from a checkout with `node src/cli.ts build <dir>` and `node src/cli.ts mcp --graph <file>`.

## Coverage and benchmark

Clone the repos in [corpus.json](corpus.json) into one directory, each checked out at its pinned sha, then:

```sh
node scripts/coverage.ts <corpus-dir>       # builds every repo into <corpus-dir>/.graphs, writes docs/COVERAGE.md
node bench/score.ts <corpus-dir>            # scores bench/questions.json against those graphs
```

A change to the builder should keep both tables at least as good, and the diff of docs/COVERAGE.md goes in the
same pull request.

## Adding an adapter

1. Write a fixture first: a small Clojure codebase under `test/fixtures/<name>/` that uses the library the way
   real projects do, including the forms you will not support.
2. Write `test/fixtures/<name>/expected.txt` with every graph row it must produce, checked by hand against the
   fixture source.
3. List the fixture in `test/build-fixtures.test.ts`.
4. Write the adapter in `src/build/adapters/` and add it to `src/build/adapters/index.ts`. An adapter switches
   itself on from the code it sees, and gives every edge a band: STATIC_PROVEN only when both ends are resolved,
   HEURISTIC for a name match or a guess, UNKNOWN when it cannot be decided.
5. Run the tests and the coverage script; note any corpus repo whose numbers change.

You may also contribute just the fixture and the expected rows. That describes the library's semantics, and
someone can write the TypeScript.

## Reporting

A wrong or misleading answer is the most useful report: open an issue with the tool call, the answer and the smallest
Clojure that shows it. A security problem goes through [SECURITY.md](SECURITY.md), not a public issue. Everyone taking
part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Rules

- Every number in the docs comes from a real run.
- Examples come only from public open-source repos.
- An answer that cannot be proven says so; an empty answer says what was searched.
- Tests must be able to fail.
