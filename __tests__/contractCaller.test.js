// tests/contractCaller.test.js

import { jest } from '@jest/globals';
import { validAddresses, setupMocks } from './test-helpers.js';

// Setup all mocks
setupMocks();

// Import the functions to test after all mocks are set up
import {
  fetchCodeIds,
  fetchContractAddressesByCodeId,
  fetchContractMetadata,
  fetchContractHistory,
  identifyContractTypes,
  fetchTokensAndOwners
} from '../contractHelper.js';

describe('Contract Helper Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchCodeIds', () => {
    test('should fetch and record code IDs', async () => {
      await fetchCodeIds();
      
      // Verify the gRPC call was made
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].Codes)
        .toHaveBeenCalledWith({ pagination: { limit: 100 } });
      
      // Verify the batchInsertOrUpdate was called with correct data
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'code_ids',
        ['code_id', 'creator', 'instantiate_permission'],
        expect.arrayContaining([
          ["1", "test", '{"permission":"Everybody","address":""}'],
          ["2", "test2", '{"permission":"Everybody","address":""}']
        ]),
        'code_id'
      );
      
      // Verify progress update
      expect(jest.requireMock('../utils.js').updateProgress).toHaveBeenCalledWith(
        'fetchCodeIds', 1, undefined, undefined
      );
    });
    
    test('should skip if already completed', async () => {
      // Setup mock to return completed
      jest.requireMock('../utils.js').checkProgress.mockReturnValueOnce({ completed: 1 });
      
      await fetchCodeIds();
      
      // Verify that no gRPC calls were made
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].Codes)
        .not.toHaveBeenCalled();
    });
  });

  describe('fetchContractAddressesByCodeId', () => {
    test('should fetch contracts for each code ID', async () => {
      await fetchContractAddressesByCodeId();
      
      // Verify ContractsByCode was called for each code ID
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractsByCode)
        .toHaveBeenCalledWith({ code_id: "1", pagination: { limit: 100 } });
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractsByCode)
        .toHaveBeenCalledWith({ code_id: "2", pagination: { limit: 100 } });
      
      // Verify batchInsertOrUpdate was called with the correct data
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contracts',
        ['code_id', 'address', 'type'],
        expect.arrayContaining([
          ["1", validAddresses.address1, null],
          ["1", validAddresses.address2, null]
        ]),
        'address'
      );
      
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contracts',
        ['code_id', 'address', 'type'],
        expect.arrayContaining([
          ["2", validAddresses.address3, null]
        ]),
        'address'
      );
      
      // Verify progress update
      expect(jest.requireMock('../utils.js').updateProgress).toHaveBeenCalledWith(
        'fetchContractsByCode', 1, undefined, undefined
      );
    });
    
    test('should skip if already completed', async () => {
      // Setup mock to return completed
      jest.requireMock('../utils.js').checkProgress.mockReturnValueOnce({ completed: 1 });
      
      await fetchContractAddressesByCodeId();
      
      // Verify no queries were made
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractsByCode)
        .not.toHaveBeenCalled();
    });
  });

  describe('fetchContractMetadata', () => {
    test('should fetch metadata for each contract', async () => {
      await fetchContractMetadata();
      
      // Verify ContractInfo was called for each address
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo)
        .toHaveBeenCalledWith({ address: validAddresses.address1 });
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo)
        .toHaveBeenCalledWith({ address: validAddresses.address2 });
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo)
        .toHaveBeenCalledWith({ address: validAddresses.address3 });
      
      // Verify batchInsertOrUpdate was called with the correct data for each contract
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledTimes(3);
      
      // Verify progress update was called
      expect(jest.requireMock('../utils.js').updateProgress).toHaveBeenCalledWith(
        'fetchContractMetadata', 1, undefined, undefined
      );
    });
    
    test('should skip if already completed', async () => {
      // Setup mock to return completed
      jest.requireMock('../utils.js').checkProgress.mockReturnValueOnce({ completed: 1 });
      
      await fetchContractMetadata();
      
      // Verify no queries were made
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo)
        .not.toHaveBeenCalled();
    });
  });

  describe('fetchContractHistory', () => {
    test('should fetch history for each contract', async () => {
      await fetchContractHistory();
      
      // Verify ContractHistory was called for each address
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractHistory)
        .toHaveBeenCalledWith({ address: validAddresses.address1, pagination: { limit: 100 } });
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractHistory)
        .toHaveBeenCalledWith({ address: validAddresses.address2, pagination: { limit: 100 } });
      expect(jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].ContractHistory)
        .toHaveBeenCalledWith({ address: validAddresses.address3, pagination: { limit: 100 } });
      
      // Verify batchInsertOrUpdate was called
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contract_history',
        ['contract_address', 'operation', 'code_id', 'updated', 'msg'],
        expect.arrayContaining([
          expect.arrayContaining([validAddresses.address1, "CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT", "1", "100000"])
        ]),
        ['contract_address', 'operation', 'code_id']
      );
      
      // Verify progress update
      expect(jest.requireMock('../utils.js').updateProgress).toHaveBeenCalledWith(
        'fetchContractHistory', 1, undefined, undefined
      );
    });
  });

  describe('identifyContractTypes', () => {
    test('should identify contract types by sending test queries', async () => {
      await identifyContractTypes();
      
      // Verify sendContractQueryGrpc was called for each contract
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address1, { "a": "b" }, true);
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address2, { "a": "b" }, true);
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address3, { "a": "b" }, true);
      
      // Verify batchInsertOrUpdate was called with the correct data
      // Should detect cw721 from the error message
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contracts',
        ['address', 'type'],
        expect.arrayContaining([[validAddresses.address1, "cw721"]]),
        'address'
      );
      
      // Should detect cw20 from the error message
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contracts',
        ['address', 'type'],
        expect.arrayContaining([[validAddresses.address2, "cw20"]]),
        'address'
      );
      
      // Verify progress update
      expect(jest.requireMock('../utils.js').updateProgress).toHaveBeenCalledWith(
        'identifyContractTypes', 1, undefined, undefined
      );
    });
  });

  describe('fetchTokensAndOwners', () => {
    test('should fetch tokens and owners for CW721 contracts', async () => {
      await fetchTokensAndOwners();
      
      // Verify sendContractQueryGrpc was called for token listing
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address1, { all_tokens: { limit: 100 } }, false);
      
      // Verify tokens were inserted
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contract_tokens',
        ['contract_address', 'token_id'],
        expect.arrayContaining([
          [validAddresses.address1, "1"],
          [validAddresses.address1, "2"],
          [validAddresses.address1, "3"]
        ]),
        ['contract_address', 'token_id']
      );
      
      // Verify nft_owners were inserted
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'nft_owners',
        ['collection_address', 'token_id'],
        expect.arrayContaining([
          [validAddresses.address1, "1"],
          [validAddresses.address1, "2"],
          [validAddresses.address1, "3"]
        ]),
        ['collection_address', 'token_id']
      );
      
      // Verify tokens_minted was updated
      expect(jest.requireMock('../utils.js').batchInsertOrUpdate).toHaveBeenCalledWith(
        'contracts',
        ['address', 'tokens_minted'],
        [[validAddresses.address1, 3]],
        'address'
      );
      
      // Verify token details were fetched
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address1, { all_nft_info: { token_id: "1" } }, false);
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address1, { all_nft_info: { token_id: "2" } }, false);
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address1, { all_nft_info: { token_id: "3" } }, false);
    });
    
    test('should fetch token info for CW20 contracts', async () => {
      await fetchTokensAndOwners();
      
      // Verify token_info query was made
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address2, { token_info: {} }, false);
      
      // Verify accounts query was made
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address2, { all_accounts: { limit: 100 } }, false);
      
      // Verify balance queries were made for each account
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address2, { balance: { address: "account1" } }, false);
      expect(jest.requireMock('../utils.js').sendContractQueryGrpc)
        .toHaveBeenCalledWith(validAddresses.address2, { balance: { address: "account2" } }, false);
    });
  });
});