// config.js

export const config = {
  blockHeight: null,
  paginationLimit: 100,
  concurrencyLimit: 8,
  numWorkers: 6,
  restAddress: "http://rpc.sei-main-eu.ccvalidators.com:8082",
  wsAddress: "http://rpc.sei-main-eu.ccvalidators.com:8086",
  evmRpcAddress: "http://rpc.sei-main-eu.ccvalidators.com:8085",
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
