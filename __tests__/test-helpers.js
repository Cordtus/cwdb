// tests/test-helpers.js

import { jest } from '@jest/globals';

// Valid mantra addresses for tests
export const validAddresses = {
  address1: "mantra1z7wqgylnvq0vvkrz5klrsrglppvkcgd7jvvnwl",
  address2: "mantra1jcr8sxl3vgj02jyc4tdlh8gycjut04yeq4mptd",
  address3: "mantra14z467uplx7marj8e3a9lm4v0hhkqgxpag442wu"
};

// Setup all mocks
export function setupMocks() {
  // Mock grpcClient with both cosmwasm and tendermint services
  jest.mock('../grpcClient.js', () => ({
    grpcClient: {
      "cosmwasm.wasm.v1.Query": {
        Codes: jest.fn().mockResolvedValue({
          code_infos: [
            { code_id: "1", creator: "test", instantiate_permission: { permission: "Everybody", address: "" } },
            { code_id: "2", creator: "test2", instantiate_permission: { permission: "Everybody", address: "" } }
          ],
          pagination: { next_key: null }
        }),
        ContractsByCode: jest.fn().mockImplementation(({code_id}) => {
          if (code_id === "1") {
            return Promise.resolve({
              contracts: [validAddresses.address1, validAddresses.address2],
              pagination: { next_key: null }
            });
          }
          if (code_id === "2") {
            return Promise.resolve({
              contracts: [validAddresses.address3],
              pagination: { next_key: null }
            });
          }
          return Promise.resolve({ contracts: [], pagination: { next_key: null }});
        }),
        ContractInfo: jest.fn().mockImplementation(({address}) => {
          if (address === validAddresses.address1) {
            return Promise.resolve({
              contract_info: {
                code_id: "1",
                creator: "test",
                admin: "",
                label: "test_contract_cw721"
              }
            });
          }
          if (address === validAddresses.address2) {
            return Promise.resolve({
              contract_info: {
                code_id: "1",
                creator: "test",
                admin: "admin_address",
                label: "test_contract_cw20"
              }
            });
          }
          if (address === validAddresses.address3) {
            return Promise.resolve({
              contract_info: {
                code_id: "2",
                creator: "test2",
                admin: "",
                label: "test_contract_cw1155"
              }
            });
          }
          throw new Error(`Contract not found: ${address}`);
        }),
        SmartContractState: jest.fn().mockImplementation(({address, query_data}) => {
          const decodedQuery = JSON.parse(Buffer.from(query_data, 'base64').toString());
          
          // Contract type identification logic
          if (address === validAddresses.address1 && decodedQuery.a) {
            throw new Error("Error parsing into type cw721_base::Msg: Invalid query");
          }
          
          if (address === validAddresses.address2 && decodedQuery.a) {
            throw new Error("Error parsing into type cw20_base::Msg: Invalid query");
          }
          
          // All tokens query logic
          if (address === validAddresses.address1 && decodedQuery.all_tokens) {
            return Promise.resolve({
              data: Buffer.from(JSON.stringify({
                tokens: ["1", "2", "3"]
              })).toString('base64')
            });
          }
          
          // NFT info query
          if (address === validAddresses.address1 && decodedQuery.all_nft_info) {
            const tokenId = decodedQuery.all_nft_info.token_id;
            return Promise.resolve({
              data: Buffer.from(JSON.stringify({
                access: { owner: `owner${tokenId}` },
                info: { 
                  token_uri: `https://example.com/token/${tokenId}`,
                  extension: { name: `Token ${tokenId}`, description: "Test NFT" } 
                }
              })).toString('base64')
            });
          }
          
          // CW20 token info
          if (address === validAddresses.address2 && decodedQuery.token_info) {
            return Promise.resolve({
              data: Buffer.from(JSON.stringify({
                name: "Test Token",
                symbol: "TEST",
                decimals: 6,
                total_supply: "1000000000"
              })).toString('base64')
            });
          }
          
          // CW20 accounts
          if (address === validAddresses.address2 && decodedQuery.all_accounts) {
            return Promise.resolve({
              data: Buffer.from(JSON.stringify({
                accounts: ["account1", "account2"]
              })).toString('base64')
            });
          }
          
          // CW20 balance
          if (address === validAddresses.address2 && decodedQuery.balance) {
            return Promise.resolve({
              data: Buffer.from(JSON.stringify({
                balance: "100000"
              })).toString('base64')
            });
          }
          
          return Promise.resolve({
            data: Buffer.from(JSON.stringify({})).toString('base64')
          });
        }),
        ContractHistory: jest.fn().mockResolvedValue({
          entries: [
            { 
              operation: "CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT", 
              code_id: "1", 
              updated: { block: { height: "100000" } },
              msg: { init_msg: { name: "Test Token", symbol: "TEST" } }
            }
          ],
          pagination: { next_key: null }
        })
      },
      // Add tendermint mock
      "tendermint.BlockService": {
        LatestBlock: jest.fn().mockResolvedValue({
          block: {
            header: {
              height: "1000000"
            }
          }
        })
      }
    }
  }));

  // Mock better-sqlite3
  jest.mock('better-sqlite3', () => {
    const mockRun = jest.fn().mockReturnValue({ changes: 1 });
    const mockGet = jest.fn().mockImplementation(() => null);
    const mockAll = jest.fn().mockReturnValue([
      { code_id: "1", address: validAddresses.address1 },
      { code_id: "1", address: validAddresses.address2 },
      { code_id: "2", address: validAddresses.address3 }
    ]);
    
    const mockPrepare = jest.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll
    });
    
    const mockTransaction = jest.fn(cb => {
      return () => {
        try {
          return cb();
        } catch (error) {
          console.error("Transaction error:", error);
          throw error;
        }
      };
    });
    
    const mockDb = {
      prepare: mockPrepare,
      transaction: mockTransaction,
      pragma: jest.fn(),
      exec: jest.fn(),
      close: jest.fn()
    };
    
    return jest.fn(() => mockDb);
  });

  // Mock utils
  jest.mock('../utils.js', () => {
    return {
      log: jest.fn(),
      db: {
        prepare: jest.fn().mockReturnValue({
          run: jest.fn(),
          get: jest.fn().mockImplementation((step) => {
            if (step === 'fetchCodeIds') return { completed: 0, last_processed: null };
            if (step === 'fetchContractsByCode') return { completed: 0, last_processed: null };
            if (step === 'fetchContractMetadata') return { completed: 0, last_processed: null };
            if (step === 'fetchContractHistory') return { completed: 0, last_processed: null };
            if (step === 'identifyContractTypes') return { completed: 0, last_processed: null };
            if (step === 'fetchTokensAndOwners') return { completed: 0, last_processed: null };
            return null;
          }),
          all: jest.fn().mockReturnValue([
            { address: validAddresses.address1, type: "cw721" },
            { address: validAddresses.address2, type: "cw20_base" }
          ])
        }),
        transaction: jest.fn(fn => () => fn())
      },
      fetchDataGrpc: jest.fn(),
      sendContractQueryGrpc: jest.fn().mockImplementation((address, payload, skip400ErrorLog) => {
        // Contract type identification
        if (payload.a) {
          if (address === validAddresses.address1) {
            return Promise.resolve({
              data: null,
              error: "Error parsing into type cw721_base::Msg: Invalid query",
              message: "Error parsing into type cw721_base::Msg: Invalid query"
            });
          }
          if (address === validAddresses.address2) {
            return Promise.resolve({
              data: null,
              error: "Error parsing into type cw20_base::Msg: Invalid query",
              message: "Error parsing into type cw20_base::Msg: Invalid query"
            });
          }
        }
        
        // Token queries
        if (address === validAddresses.address1 && payload.all_tokens) {
          return Promise.resolve({
            data: { data: { tokens: ["1", "2", "3"] } },
            error: null
          });
        }
        
        if (address === validAddresses.address2 && payload.token_info) {
          return Promise.resolve({
            data: { data: { total_supply: "1000000000" } },
            error: null
          });
        }
        
        if (address === validAddresses.address2 && payload.all_accounts) {
          return Promise.resolve({
            data: { data: { accounts: ["account1", "account2"] } },
            error: null
          });
        }
        
        return Promise.resolve({
          data: { data: {} },
          error: null
        });
      }),
      retryOperation: jest.fn(fn => fn()),
      batchInsertOrUpdate: jest.fn(),
      checkProgress: jest.fn().mockReturnValue({ completed: 0, last_processed: null }),
      updateProgress: jest.fn(),
      createWebSocketConnection: jest.fn(),
      initializeBlockHeight: jest.fn()
    };
  });

  // Mock config
  jest.mock('../config.js', () => ({
    config: {
      paginationLimit: 100,
      concurrencyLimit: 5,
      blockHeight: 1000000,
      timeout: 5000,
      logLevel: 'INFO',
      grpcAddress: 'grpc.mantrachain.io:443',
      wsAddress: 'wss://rpc.mantrachain.io/websocket'
    }
  }));

  // Mock WebSocket
  jest.mock('ws', () => {
    const eventHandlers = {};
    
    const mockWs = {
      on: jest.fn().mockImplementation((event, callback) => {
        eventHandlers[event] = callback;
        return mockWs;
      }),
      simulateEvent: (event, data) => {
        if (eventHandlers[event]) {
          eventHandlers[event](data);
        }
      }
    };
    
    return {
      WebSocket: jest.fn(() => mockWs)
    };
  });

  // Mock child_process for grpcClient tests
  jest.mock('child_process', () => ({
    exec: jest.fn().mockImplementation((cmd, callback) => {
      callback(null, { stdout: JSON.stringify({ result: 'success' }) });
    })
  }));

  // Mock util
  jest.mock('util', () => ({
    promisify: jest.fn(fn => (...args) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    })
  }));

  // Mock fs
  jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue('')
  }));

  // Mock p-limit
  jest.mock('p-limit', () => {
    return jest.fn().mockImplementation(() => {
      return (fn) => fn();
    });
  });
}