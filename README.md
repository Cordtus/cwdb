#

 | C | O | S | M |
 |---|---|---|---|
 | W | A | S | M |
 | D | A | T | A |
 | B | A | S | E |

---

CosmWasm smart contract indexer for Cosmos-based blockchains. Queries CW721, CW404, CW1155, and CW20 contracts via native gRPC, extracting contract info, token data, and ownership records into a local SQLite database.

## Features

- Native gRPC client (no grpcurl or external proto files required)
- Indexes all code IDs, contract addresses, metadata, and migration history on-chain
- Identifies contract types (CW721, CW20, CW404, CW1155) via label parsing and error message introspection
- Fetches NFT tokens, metadata, and ownership for NFT contracts
- Fetches account balances for CW20 contracts
- Progress checkpointing -- resumes from last checkpoint if interrupted
- Batch database writes with transaction safety
- Configurable concurrency, pagination, and retry with exponential backoff
- TLS auto-detection (port 443 = TLS, otherwise insecure)

## Prerequisites

- Node.js >= 18
- A CosmWasm-enabled Cosmos chain node with gRPC enabled

## Setup

```sh
# Install dependencies
yarn install

# Copy and edit the config
cp config.example.js config.js
# Edit config.js with your gRPC endpoint and preferences

# Run the indexer
yarn start
```

## Configuration

Copy `config.example.js` to `config.js` (gitignored) and set your values:

```js
export const config = {
  blockHeight: "",          // empty = auto-fetch latest block height
  paginationLimit: 100,     // items per gRPC page
  concurrencyLimit: 4,      // parallel gRPC requests
  numWorkers: 4,            // reserved for future worker threads
  grpcAddress: "localhost:9090",  // chain gRPC endpoint; CWDB_GRPC_ADDRESS overrides
  timeout: 5000,            // gRPC request timeout (ms); CWDB_GRPC_TIMEOUT_MS overrides
  databasePath: "./data/indexer.db", // CWDB_DATABASE_PATH can override this
  logLevel: 'INFO',         // ERROR | INFO | DEBUG
  logToFile: true,          // write to ./logs/data_collection.log
  retryConfig: {
    retries: 2,
    delay: 750,
    backoffFactor: 2
  }
};
```

Chain-registry gRPC entries with `https://` are accepted and normalized for `@grpc/grpc-js`. Port `443` enables TLS automatically; any other host:port uses an insecure channel unless the endpoint includes an `https://` scheme.

Use `CWDB_GRPC_ADDRESS` to point a run at a local or temporary node without editing `config.js`:

```sh
CWDB_GRPC_ADDRESS=192.168.0.170:19090 yarn start
CWDB_GRPC_ADDRESS=192.168.0.170:19090 CWDB_GRPC_TIMEOUT_MS=30000 CWDB_LOG_LEVEL=ERROR yarn start
```

Polkachu examples from the Cosmos chain-registry:

```js
grpcAddress: "juno-grpc.polkachu.com:12690"
grpcAddress: "https://sei-grpc.polkachu.com:11990"
```

## Commands

```sh
yarn start              # run the full indexer pipeline
yarn dev                # run with file watching (nodemon)
yarn test               # run deterministic unit tests
```

### Live Pipeline Test

```sh
CWDB_GRPC_ADDRESS=192.168.0.170:19090 CWDB_DATABASE_PATH=/tmp/cwdb-pipeline.db CWDB_TEST_CONTRACTS=juno1... yarn test:pipeline
CWDB_GRPC_ADDRESS=192.168.0.170:19090 CWDB_DATABASE_PATH=/tmp/cwdb-pipeline.db yarn test:pipeline --contract juno1...
node test_index.js --init-db      # initialize database schema only
```

The live pipeline test initializes the database, seeds the provided contracts through gRPC `ContractInfo`, then runs metadata, history, type identification, and token/owner collection. It fails fast if no contract is supplied.

## Indexing Pipeline

The indexer runs 6 sequential steps, each resumable from its last checkpoint:

| Step | Description |
|------|-------------|
| `fetchCodeIds` | Paginates through all code IDs on-chain |
| `fetchContractsByCode` | Fetches contract addresses for each code ID (concurrent) |
| `fetchContractMetadata` | Fetches creator, admin, label; detects type from label or contract_info query |
| `fetchContractHistory` | Fetches init/migration history per contract (concurrent) |
| `identifyContractTypes` | Sends invalid query, parses error message to extract contract type |
| `fetchTokensAndOwners` | Fetches tokens + ownership for NFTs; fetches balances for CW20s |

Each step retries up to 3 times with exponential backoff before aborting.

## Architecture

```
Cosmos Chain (gRPC)
       |
       v
grpcClient.js          -- native @grpc/grpc-js + embedded protobuf definitions
       |
       v
contractCaller.js      -- 6-step indexing pipeline
       |
       v
utils.js               -- DB helpers, logging, progress tracking, retry logic
       |
       v
SQLite (data/indexer.db)  -- WAL mode, better-sqlite3
```

### Core Modules

| Module | Purpose |
|--------|---------|
| `grpcClient.js` | Native gRPC client with inline protobuf types for CosmWasm Query + Tendermint Service |
| `contractCaller.js` | All indexing step functions |
| `utils.js` | Database instance, logging, smart contract query wrapper, batch upsert, progress tracking |
| `initDb.js` | Schema definitions and database initialization |
| `config.js` | Runtime configuration (gitignored -- use `config.example.js` as template) |

## Database Schema

SQLite database at `./data/indexer.db` (WAL mode).

| Table | Purpose |
|-------|---------|
| `code_ids` | Code ID metadata (creator, instantiate_permission) |
| `contracts` | Contract addresses with type_id FK, creator, admin, label, text token supply/count |
| `contract_types` | Lookup table (cw721, cw20, cw404, cw1155) |
| `contract_history` | Init/migration history entries per contract |
| `contract_tokens` | NFT token data (token_uri, metadata) |
| `nft_owners` | NFT ownership (collection_address, token_id, owner) |
| `cw20_owners` | CW20 token balances stored as exact integer strings |
| `indexer_progress` | Checkpoint tracking for resumable runs |
| `operation_types` | Lookup for history operation types (INIT, MIGRATE, GENESIS) |

## Contract Type Detection

Types are identified in two passes:

1. **Label parsing** (`fetchContractMetadata`) -- checks if the contract label contains a known type keyword
2. **Error introspection** (`identifyContractTypes`) -- sends an invalid query `{"a":"b"}` and parses the error message (e.g., `Error parsing into type cw721_base::Msg:`) to extract the type

## Progress Tracking

The `indexer_progress` table stores per-step state (`completed`, `last_processed`, `last_fetched_token`). On restart, completed steps are skipped and in-progress steps resume from their last checkpoint.

## Error Handling

- Failed gRPC calls retry with exponential backoff and jitter (configurable via `retryConfig`)
- Each pipeline step retries up to 3 times before the indexer aborts
- Batch operations are wrapped in SQLite transactions for atomicity
- Errors are logged to console and `./logs/data_collection.log`

## Contributing

Submit issues or pull requests for bug fixes and enhancements.
