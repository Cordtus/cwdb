// config.example.js
// Copy to config.js and update values for your environment.

export const config = {
	// Fixed block height to query at (empty string = auto-fetch latest)
	blockHeight: "",

	// Pagination limit per gRPC request
	paginationLimit: 100,

	// Max concurrent gRPC requests
	concurrencyLimit: 4,

	// Reserved for future worker thread support
	numWorkers: 4,

	// gRPC endpoint for a CosmWasm-enabled Cosmos chain.
	// CWDB_GRPC_ADDRESS can override this for local-node and live test runs.
	// Chain-registry entries are accepted as host:port or https://host:port.
	// Examples:
	//   "juno-grpc.polkachu.com:12690"
	//   "https://sei-grpc.polkachu.com:11990"
	// Port 443 or https:// enables TLS automatically; other ports use insecure
	grpcAddress: "localhost:9090",

	// gRPC request timeout in milliseconds; CWDB_GRPC_TIMEOUT_MS can override this
	timeout: 5000,

	// SQLite output path; CWDB_DATABASE_PATH can override this for tests
	databasePath: "./data/indexer.db",

	// Log level: ERROR, INFO, or DEBUG; CWDB_LOG_LEVEL can override this
	logLevel: 'INFO',

	// Write logs to ./logs/data_collection.log
	logToFile: true,

	// Retry configuration for failed operations
	retryConfig: {
		retries: 2,       // max retry attempts
		delay: 750,       // initial delay in ms
		backoffFactor: 2  // multiplier per retry (750ms -> 1500ms -> ...)
	}
};
