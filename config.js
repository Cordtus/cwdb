// config.js

export const config = {
  blockHeight: null,
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  restAddress: "http://rpc.sei-main-eu.ccvalidators.com",
  wsAddress: "http://rpc.sei-main-eu.ccvalidators.com",
  evmRpcAddress: "http://rpc.sei-main-eu.ccvalidators.com",
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
