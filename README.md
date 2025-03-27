# CosmWasm Indexer

 | C | O | S | M |
 |---|---|---|---|
 | W | A | S | M |
 | D | A | T | A |
 | B | A | S | E |

---

Simple indexer for CosmWasm-based blockchains that queries CW contracts, focusing on CW721, CW404, and other NFT contracts. Gathers contract information, token details, ownership, and related data to store in a local SQLite database.

## Features

- Uses gRPC for all communication with the blockchain
- Fetches code IDs and associated contract addresses
- Identifies contract types for filtering and categorization
- Fetches tokens from NFT contracts (CW721, CW404, etc.) with paginated querying
- Tracks progress and resumes indexing from the last checkpoint if interrupted
- Supports batch insertion for database efficiency
- Provides optional real-time updates using WebSocket connections

## Prerequisites

- Node.js (version >= 14.x)
- SQLite3
- `grpcurl` command installed and available in PATH
- Access to chain gRPC endpoints

## Configuration

The main configuration is in `config.js`:

```js
// config.js

export const config = {
  blockHeight: "",
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  restAddress: "https://api.example.io",  // Keeping as fallback
  grpcAddress: "grpc.example.io:443",     // Primary endpoint for GRPC
  wsAddress: "wss://rpc.example.io/websocket",
  timeout: 5000,
  logLevel: 'INFO',
  logToFile: false,
  retryConfig: {
    retries: 1,
    delay: 500,
    backoffFactor: 2
  }
};
```

## Database Schema

The following tables are used in the SQLite database:

- `indexer_progress`: Tracks progress for each indexing step
- `code_ids`: Stores code ID metadata
- `contracts`: Stores contract addresses and types
- `contract_tokens`: Stores token data for each contract
- `contract_history`: Stores history details for each contract
- `nft_owners`: Stores ownership details for each token
- `cw20_owners`: Stores CW20 token balances

## Running the Indexer

Operating is extremely simple:

1. Make sure `grpcurl` is installed and in your PATH
2. Complete `config.js` with appropriate chain endpoints
3. Install dependencies
4. Run:

```sh
yarn install && yarn start
```

## Running Tests

A simple test script is provided to verify the indexing functionality with a limited dataset:

```sh
yarn single-contract
```

This will run through the entire indexing process using manually seeded contract addresses for quicker testing and debugging.

## Using the gRPC Client

This version of the indexer uses a dynamically generated gRPC client that provides JavaScript functions for all CosmWasm methods available on the target chain:

```javascript
import { grpcClient } from './grpcClient.js';

// Example usage
const result = await grpcClient["cosmwasm.wasm.v1.Query"].Code({ code_id: 123 });
console.log(result);
```

## Progress Tracking

The `indexer_progress` table tracks the last processed contract and token during each stage, allowing resuming after interruption without losing progress.

## Error Handling

- Failed operations are retried up to 3 times, with an exponential backoff (default delay of 500ms, doubling each attempt)
- Errors are logged with appropriate level
- Errors during batch processing are logged, and the indexing process continues

### Contributing

Please submit issues or a pull request for any bug fixes or enhancements.
