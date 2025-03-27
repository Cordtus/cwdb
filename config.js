// config.js

export const config = {
  blockHeight: "",
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  rpcAddress: "http://localhost:26657",
  restAddress: "http://localhost:1317",
  grpcAddress: "localhost:9090",
  timeout: 5000,
  logLevel: 'INFO',
  logToFile: false,
  retryConfig: {
    retries: 1,
    delay: 500,
    backoffFactor: 2
  }
};
