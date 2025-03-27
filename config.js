// config.js

export const config = {
  blockHeight: "",
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  restAddress: "https://api.juno.basementnodes.ca",
  grpcAddress: "grpc.juno.basementnodes.ca:443",
  wsAddress: "wss://rpc.juno.basementnodes.ca/websocket",
  timeout: 5000,
  logLevel: 'DEBUG',
  logToFile: true,
  retryConfig: {
    retries: 1,
    delay: 500,
    backoffFactor: 2
  }
};