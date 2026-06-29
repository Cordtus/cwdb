# Repository Guidelines

## Project Structure & Module Organization

CWDB is a Node.js ES module indexer for CosmWasm contracts. The entry point is `index.js`, which runs the six-step indexing pipeline. Chain query logic lives in `contractCaller.js`, native gRPC/protobuf setup in `grpcClient.js`, SQLite helpers in `utils.js`, and schema setup in `initDb.js`. `test_index.js` is the test harness. Runtime state is written to `data/indexer.db` and logs under `logs/`; these outputs are not source files.

## Build, Test, and Development Commands

- `yarn install`: install dependencies from `yarn.lock`.
- `cp config.example.js config.js`: create local runtime configuration before running the indexer.
- `yarn start`: run the full indexing pipeline with `node index.js`; use `CWDB_LOG_LEVEL=ERROR` for quiet live runs.
- `yarn dev`: run the indexer through `nodemon` for local iteration.
- `yarn test`: run deterministic unit tests with Node's built-in test runner.
- `CWDB_GRPC_ADDRESS=host:port CWDB_DATABASE_PATH=/tmp/cwdb-pipeline.db CWDB_TEST_CONTRACTS=juno1... yarn test:pipeline`: run the live gRPC harness against explicit seed contracts using an isolated SQLite file.
- `node test_index.js --init-db`: initialize the SQLite schema only.
- `yarn lint` / `yarn lint:fix`: run ESLint over JavaScript files.

## Coding Style & Naming Conventions

Use ES module syntax (`import`/`export`) and keep functions focused around one pipeline or storage responsibility. Preserve the indentation style of the file you touch; most pipeline files use tabs, while some schema code uses spaces. Use camelCase for functions and variables, descriptive step names matching `indexer_progress`, and uppercase string log levels (`ERROR`, `INFO`, `DEBUG`). Do not reformat unrelated files.

## Testing Guidelines

Unit tests live under `tests/` and cover deterministic data shaping and config parsing. For schema, progress, or live query changes, run `yarn test`, then `yarn test:pipeline` with an explicit contract and `CWDB_GRPC_ADDRESS` when gRPC is available. Use `node test_index.js --init-db` for schema-only validation. Keep live endpoints, seed addresses, and generated SQLite data out of commits.

## Commit & Pull Request Guidelines

Recent history uses short imperative messages such as `replace REST/grpcurl with native gRPC client` and `update handling+validation of bech32 addresses`. Keep commits scoped and mention the affected module or behavior. Pull requests should describe the pipeline impact, list config or database changes, link related issues, and include verification output for `yarn lint`, `yarn test`, or any skipped command with the reason.

## Security & Configuration Tips

Treat `config.js`, `.env`, `data/*.db`, and `logs/*.log` as local artifacts. Start from `config.example.js`, avoid committing live node endpoints or wallet-related data, and keep retry/concurrency changes conservative for public gRPC services.
