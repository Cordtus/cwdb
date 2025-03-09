// config.js

export const config = {
  blockHeight: "",
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  restAddress: "https://api.sei.basementnodes.ca",
  wsAddress: "wss://evm-rpc-ws.sei.basementnodes.ca",
  evmRpcAddress: "https://evm-rpc.sei.basementnodes.ca",
  pointerApi: "https://pointer.basementnodes.ca",
  timeout: 5000,
  logLevel: 'INFO',
  logToFile: false,
  retryConfig: {
    retries: 1,
    delay: 500,
    backoffFactor: 2
  }
};
