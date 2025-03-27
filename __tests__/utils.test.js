// tests/utils.test.js

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { setupMocks } from './test-helpers.js';

// Setup all mocks
setupMocks();

// Import after mocking
import {
  log,
  fetchDataGrpc,
  fetchPaginatedDataGrpc,
  sendContractQueryGrpc,
  retryOperation,
  batchInsertOrUpdate,
  checkProgress,
  updateProgress,
  createWebSocketConnection,
  initializeBlockHeight
} from '../utils.js';

describe('Utility Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('log function', () => {
    const originalConsoleLog = console.log;
    const mockConsoleLog = jest.fn();
    
    beforeEach(() => {
      console.log = mockConsoleLog;
      jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    });
    
    afterEach(() => {
      console.log = originalConsoleLog;
      jest.restoreAllMocks();
    });
    
    test('should log INFO messages when log level is INFO', () => {
      log('Test message', 'INFO');
      expect(mockConsoleLog).toHaveBeenCalled();
      expect(mockConsoleLog.mock.calls[0][0]).toContain('[INFO] Test message');
    });
    
    test('should not log DEBUG messages when log level is INFO', () => {
      log('Debug message', 'DEBUG');
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });
    
    test('should log ERROR messages regardless of log level', () => {
      log('Error message', 'ERROR');
      expect(mockConsoleLog).toHaveBeenCalled();
      expect(mockConsoleLog.mock.calls[0][0]).toContain('[ERROR] Error message');
    });
  });

  describe('retryOperation function', () => {
    test('should retry failed operations up to the specified number of times', async () => {
      const mockOperation = jest.fn();
      let calls = 0;
      mockOperation.mockImplementation(() => {
        calls++;
        if (calls < 3) {
          throw new Error('Operation failed');
        }
        return 'success';
      });
      
      const result = await retryOperation(mockOperation, 3, 10, 1);
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });
    
    test('should return null if operation fails after all retries', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));
      const result = await retryOperation(mockOperation, 2, 10, 1);
      expect(result).toBeNull();
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });
    
    test('should return immediately if operation succeeds on first try', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const result = await retryOperation(mockOperation);
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchDataGrpc function', () => {
    test('should call the correct gRPC method with payload', async () => {
      const result = await fetchDataGrpc('code', { code_id: '1' });
      expect(result).toEqual({
        contract_info: {
          code_id: "1",
          creator: "test",
          admin: "",
          label: "test_contract"
        }
      });
    });
    
    test('should handle latest_block method correctly', async () => {
      const result = await fetchDataGrpc('latest_block', {});
      expect(result).toEqual({
        block: {
          header: {
            height: "1000000"
          }
        }
      });
    });
    
    test('should retry on errors', async () => {
      const mockGrpcError = new Error('gRPC call failed');
      const originalGrpcClient = { ...global.grpcClient };
      
      // Override the mock for this test
      global.grpcClient = {
        "cosmwasm.wasm.v1.Query": {
          Code: jest.fn()
            .mockRejectedValueOnce(mockGrpcError)
            .mockResolvedValueOnce({ code_id: "1" })
        }
      };
      
      const result = await fetchDataGrpc('code', { code_id: '1' }, 2);
      
      // Restore original mock
      global.grpcClient = originalGrpcClient;
      
      expect(result).toEqual({ code_id: "1" });
    });
  });

  describe('fetchPaginatedDataGrpc function', () => {
    beforeEach(() => {
      // Reset mock implementation for each test
      jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].Codes
        .mockResolvedValueOnce({
          code_infos: [{ code_id: "1" }, { code_id: "2" }],
          pagination: { next_key: "next-page" }
        })
        .mockResolvedValueOnce({
          code_infos: [{ code_id: "3" }, { code_id: "4" }],
          pagination: { next_key: null }
        });
    });
    
    test('should fetch paginated data and concatenate results', async () => {
      const result = await fetchPaginatedDataGrpc('Codes', 'code_infos');
      expect(result).toHaveLength(4);
      expect(result).toEqual([
        { code_id: "1" }, 
        { code_id: "2" },
        { code_id: "3" }, 
        { code_id: "4" }
      ]);
    });
    
    test('should handle empty response gracefully', async () => {
      // Override implementation for this test
      jest.requireMock('../grpcClient.js').grpcClient["cosmwasm.wasm.v1.Query"].Codes
        .mockResolvedValueOnce({
          code_infos: [],
          pagination: { next_key: null }
        });
        
      const result = await fetchPaginatedDataGrpc('Codes', 'code_infos');
      expect(result).toEqual([]);
    });
  });

  describe('sendContractQueryGrpc function', () => {
    test('should encode query and decode response correctly', async () => {
      const result = await sendContractQueryGrpc(
        'mantra1z7wqgylnvq0vvkrz5klrsrglppvkcgd7jvvnwl', 
        { balance: { address: 'mantra1z7wqgylnvq0vvkrz5klrsrglppvkcgd7jvvnwl' } },
        false
      );
      
      expect(result.data.data).toEqual({ success: true, balance: "100" });
      expect(result.error).toBeNull();
    });
    
    test('should handle errors gracefully', async () => {
      const result = await sendContractQueryGrpc(
        'mantra1z7wqgylnvq0vvkrz5klrsrglppvkcgd7jvvnwl',
        { error: true },
        false
      );
      
      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    });
    
    test('should not log 400 errors when skip400ErrorLog is true', async () => {
      const spyLog = jest.spyOn(console, 'log');
      
      await sendContractQueryGrpc(
        'mantra1z7wqgylnvq0vvkrz5klrsrglppvkcgd7jvvnwl',
        { error: true },
        true
      );
      
      expect(spyLog).not.toHaveBeenCalled();
    });
  });

  describe('batchInsertOrUpdate function', () => {
    let mockDb;
    let mockInsert;
    let mockUpdate;
    let mockGet;
    
    beforeEach(() => {
      mockInsert = { run: jest.fn() };
      mockUpdate = { run: jest.fn() };
      mockGet = jest.fn();
      
      mockDb = {
        prepare: jest.fn().mockImplementation((query) => {
          if (query.includes('INSERT')) return mockInsert;
          if (query.includes('UPDATE')) return mockUpdate;
          return { get: mockGet };
        }),
        transaction: jest.fn().mockImplementation(fn => {
          return () => fn([]);
        })
      };
      
      // Replace the imported db with our mock
      jest.mock('../utils.js', () => ({
        ...jest.requireActual('../utils.js'),
        db: mockDb
      }));
    });
    
    test('should handle empty values array gracefully', () => {
      batchInsertOrUpdate('test_table', ['col1', 'col2'], [], 'col1');
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });
    
    test('should prepare insert and update statements', () => {
      mockGet.mockReturnValue(null); // No existing row
      
      batchInsertOrUpdate(
        'test_table',
        ['col1', 'col2'],
        [['value1', 'value2']],
        'col1'
      );
      
      expect(mockDb.prepare).toHaveBeenCalledTimes(3); // SELECT, INSERT, UPDATE
      expect(mockDb.transaction).toHaveBeenCalled();
    });
    
    test('should handle composite unique constraints', () => {
      mockGet.mockReturnValue(null);
      
      batchInsertOrUpdate(
        'test_table',
        ['col1', 'col2', 'col3'],
        [['value1', 'value2', 'value3']],
        ['col1', 'col2']
      );
      
      // Should call prepare with a WHERE clause containing both columns
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE col1 = ? AND col2 = ?')
      );
    });
  });

  describe('createWebSocketConnection function', () => {
    let mockWs;
    let onOpenCallback;
    let onMessageCallback;
    let onErrorCallback;
    let onCloseCallback;
    
    beforeEach(() => {
      onOpenCallback = jest.fn();
      onMessageCallback = jest.fn();
      onErrorCallback = jest.fn();
      onCloseCallback = jest.fn();
      
      mockWs = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'open') onOpenCallback = callback;
          if (event === 'message') onMessageCallback = callback;
          if (event === 'error') onErrorCallback = callback;
          if (event === 'close') onCloseCallback = callback;
        })
      };
      
      jest.requireMock('ws').WebSocket.mockReturnValue(mockWs);
    });
    
    test('should register all event callbacks', () => {
      const mockMessageHandler = jest.fn();
      const mockErrorHandler = jest.fn();
      
      createWebSocketConnection('wss://example.com', mockMessageHandler, mockErrorHandler);
      
      expect(mockWs.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
    
    test('should parse and handle message data correctly', () => {
      const mockMessageHandler = jest.fn();
      
      createWebSocketConnection('wss://example.com', mockMessageHandler);
      
      // Simulate receiving a message
      onMessageCallback(JSON.stringify({ type: 'test', data: '123' }));
      
      expect(mockMessageHandler).toHaveBeenCalledWith({ type: 'test', data: '123' });
    });
    
    test('should handle message parsing errors gracefully', () => {
      const mockMessageHandler = jest.fn();
      const consoleSpy = jest.spyOn(console, 'log');
      
      createWebSocketConnection('wss://example.com', mockMessageHandler);
      
      // Simulate receiving invalid JSON
      onMessageCallback('invalid-json');
      
      expect(mockMessageHandler).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse WebSocket message'));
    });
  });

  describe('checkProgress and updateProgress functions', () => {
    let mockDb;
    let mockGet;
    let mockRun;
    
    beforeEach(() => {
      mockGet = jest.fn();
      mockRun = jest.fn();
      
      mockDb = {
        prepare: jest.fn().mockReturnValue({
          get: mockGet,
          run: mockRun
        })
      };
      
      // Replace the imported db with our mock
      jest.mock('../utils.js', () => ({
        ...jest.requireActual('../utils.js'),
        db: mockDb
      }));
    });
    
    test('checkProgress should query the database with the step name', () => {
      mockGet.mockReturnValue({ completed: 1, last_processed: 'test_id', last_fetched_token: null });
      
      const result = checkProgress('test_step');
      
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE step = ?'));
      expect(mockGet).toHaveBeenCalledWith('test_step');
      expect(result).toEqual({ completed: 1, last_processed: 'test_id', last_fetched_token: null });
    });
    
    test('checkProgress should return default values if no row found', () => {
      mockGet.mockReturnValue(null);
      
      const result = checkProgress('test_step');
      
      expect(result).toEqual({ completed: 0, last_processed: null, last_fetched_token: null });
    });
    
    test('updateProgress should insert or replace a progress record', () => {
      updateProgress('test_step', 1, 'test_id', 'test_token');
      
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE'));
      expect(mockRun).toHaveBeenCalledWith('test_step', 1, 'test_id', 'test_token');
    });
    
    test('updateProgress should use default values when not provided', () => {
      updateProgress('test_step');
      
      expect(mockRun).toHaveBeenCalledWith('test_step', 1, null, null);
    });
  });

  describe('initializeBlockHeight function', () => {
    test('should fetch block height when not specified in config', async () => {
      // Modify config for this test
      const originalConfig = { ...jest.requireMock('../config.js').config };
      jest.requireMock('../config.js').config.blockHeight = '';
      
      await initializeBlockHeight();
      
      expect(jest.requireMock('../config.js').config.blockHeight).toBe(1000000);
      
      // Restore original config
      jest.requireMock('../config.js').config = originalConfig;
    });
    
    test('should keep existing block height when specified in config', async () => {
      // Modify config for this test
      const originalConfig = { ...jest.requireMock('../config.js').config };
      jest.requireMock('../config.js').config.blockHeight = 2000000;
      
      await initializeBlockHeight();
      
      expect(jest.requireMock('../config.js').config.blockHeight).toBe(2000000);
      
      // Restore original config
      jest.requireMock('../config.js').config = originalConfig;
    });
    
    test('should handle errors when fetching block height', async () => {
      // Modify config for this test
      const originalConfig = { ...jest.requireMock('../config.js').config };
      jest.requireMock('../config.js').config.blockHeight = '';
      
      // Mock the fetchDataGrpc to throw an error
      const originalFetchDataGrpc = fetchDataGrpc;
      global.fetchDataGrpc = jest.fn().mockRejectedValue(new Error('Failed to fetch block height'));
      
      await expect(initializeBlockHeight()).rejects.toThrow('Failed to fetch block height');
      
      // Restore originals
      global.fetchDataGrpc = originalFetchDataGrpc;
      jest.requireMock('../config.js').config = originalConfig;
    });
  });
});