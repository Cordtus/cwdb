// tests/index.test.js

import { jest } from '@jest/globals';
import { setupMocks } from './test-helpers.js';

// Setup all mocks
setupMocks();

// Import after mocking
import { createWebSocketConnection, log, initializeBlockHeight } from '../utils.js';
import { initializeDatabase } from '../initDb.js';
import {
  fetchCodeIds,
  fetchContractAddressesByCodeId,
  fetchContractMetadata,
  fetchContractHistory,
  identifyContractTypes,
  fetchTokensAndOwners
} from '../contractHelper.js';

// Dynamically import the index.js module to test the main functionality
const indexModule = jest.requireActual('../index.js');

describe('Main Application Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should ensure data and logs directories exist', async () => {
    // Set fs.existsSync to return false for testing directory creation
    jest.requireMock('fs').existsSync.mockReturnValue(false);
    
    // Import index.js to trigger the directory checks
    jest.isolateModules(() => {
      require('../index.js');
    });
    
    expect(jest.requireMock('fs').existsSync).toHaveBeenCalledWith('./data');
    expect(jest.requireMock('fs').existsSync).toHaveBeenCalledWith('./logs');
    expect(jest.requireMock('fs').mkdirSync).toHaveBeenCalledWith('./data');
    expect(jest.requireMock('fs').mkdirSync).toHaveBeenCalledWith('./logs');
  });

  test('should initialize block height and database', async () => {
    // Mock runIndexer function to avoid executing the full flow
    const runIndexerMock = jest.fn();
    
    // Execute the module code
    jest.isolateModules(() => {
      const indexModule = require('../index.js');
      indexModule.runIndexer = runIndexerMock;
      
      // Call the main function
      indexModule.runIndexer();
    });
    
    // Verify initialization functions were called
    expect(initializeBlockHeight).toHaveBeenCalled();
    expect(initializeDatabase).toHaveBeenCalled();
  });

  test('should run all indexing steps in order', async () => {
    // Execute runIndexer
    await indexModule.runIndexer();
    
    // Verify steps were called in the correct order
    const callOrder = [
      initializeBlockHeight, 
      initializeDatabase,
      fetchCodeIds,
      fetchContractAddressesByCodeId,
      fetchContractMetadata,
      fetchContractHistory,
      identifyContractTypes,
      fetchTokensAndOwners,
      createWebSocketConnection
    ];
    
    // Check order by comparing call indices
    const callIndices = callOrder.map(fn => fn.mock.invocationCallOrder[0]);
    
    // Verify each next call index is greater than the previous one
    for (let i = 1; i < callIndices.length; i++) {
      expect(callIndices[i]).toBeGreaterThan(callIndices[i-1]);
    }
  });

  test('should retry failed steps', async () => {
    // Mock a step to fail once, then succeed
    fetchContractMetadata.mockRejectedValueOnce(new Error('Test error')).mockResolvedValueOnce();
    
    // Execute runIndexer
    await indexModule.runIndexer();
    
    // Verify the step was retried
    expect(fetchContractMetadata).toHaveBeenCalledTimes(2);
    
    // Verify other steps were still executed
    expect(fetchContractHistory).toHaveBeenCalled();
  });

  test('should skip completed steps', async () => {
    // Clear existing mocks
    jest.clearAllMocks();
    
    // Set up a custom mock for checkProgress
    const checkProgressMock = jest.fn().mockImplementation((step) => {
      // Mark some steps as completed
      if (step === 'fetchCodeIds' || step === 'fetchContractsByCode') {
        return { completed: 1 };
      }
      return { completed: 0 };
    });
    
    // Restore the original mock for this test
    jest.requireMock('../utils.js').checkProgress = checkProgressMock;
    
    // Execute runIndexer
    await indexModule.runIndexer();
    
    // Verify completed steps were skipped
    expect(fetchCodeIds).not.toHaveBeenCalled();
    expect(fetchContractAddressesByCodeId).not.toHaveBeenCalled();
    
    // Verify other steps were executed
    expect(fetchContractMetadata).toHaveBeenCalled();
    expect(fetchContractHistory).toHaveBeenCalled();
  });

  test('should set up WebSocket connection after successful indexing', async () => {
    // Clear existing mocks
    jest.clearAllMocks();
    
    // Set up mocks to indicate all steps completed successfully
    jest.requireMock('../utils.js').checkProgress = jest.fn().mockReturnValue({ completed: 0 });
    
    // Execute runIndexer
    await indexModule.runIndexer();
    
    // Verify WebSocket connection was created
    expect(createWebSocketConnection).toHaveBeenCalledWith(
      'wss://rpc.mantrachain.io/websocket',
      expect.any(Function),
      expect.any(Function)
    );
  });

  test('should not set up WebSocket connection if any step fails', async () => {
    // Clear existing mocks
    jest.clearAllMocks();
    
    // Set up a mock to make a critical step fail all retries
    fetchContractMetadata.mockRejectedValue(new Error('Critical failure'));
    
    // Execute runIndexer
    await indexModule.runIndexer();
    
    // Verify WebSocket connection was not created
    expect(createWebSocketConnection).not.toHaveBeenCalled();
    
    // Verify error was logged
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Aborting indexing due to failure'), 'ERROR');
  });

  test('handleMessage function should log WebSocket messages', () => {
    // Execute message handler
    indexModule.handleMessage({ event: 'test_event', data: 'test_data' });
    
    // Verify message was logged
    expect(log).toHaveBeenCalledWith(expect.stringContaining('WebSocket message received'), 'DEBUG');
  });
});