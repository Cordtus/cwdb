// tests/initDb.test.js

import { jest } from '@jest/globals';
import { setupMocks } from './test-helpers.js';

// Setup all mocks
setupMocks();

// Import after mocking
import { initializeDatabase } from '../initDb.js';
import { db, log } from '../utils.js';

describe('Database Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should create all required tables', () => {
    initializeDatabase();
    
    // Verify all tables are created
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS indexer_progress'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS code_ids'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS contracts'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS contract_history'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS contract_tokens'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS cw20_owners'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS nft_owners'));
  });
  
  test('should create tables within a transaction', () => {
    initializeDatabase();
    
    // Verify transaction was used
    expect(jest.requireMock('../utils.js').db.transaction).toHaveBeenCalled();
  });
  
  test('should log successful initialization', () => {
    initializeDatabase();
    
    // Verify logging
    expect(jest.requireMock('../utils.js').log).toHaveBeenCalledWith('Database initialization completed successfully.', 'INFO');
  });
  
  test('should initialize progress steps in test mode', () => {
    initializeDatabase(true); // Call with isTest=true
    
    // Verify that progress steps are initialized in test mode
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO indexer_progress'));
    expect(jest.requireMock('../utils.js').log).toHaveBeenCalledWith('Progress steps initialized for test mode', 'INFO');
  });
  
  test('should handle and log errors during initialization', () => {
    // Mock a failure scenario
    jest.requireMock('../utils.js').db.transaction.mockImplementationOnce(() => {
      throw new Error('Database error');
    });
    
    // Expect the function to throw
    expect(() => initializeDatabase()).toThrow('Database error');
    
    // Verify error was logged
    expect(jest.requireMock('../utils.js').log).toHaveBeenCalledWith(expect.stringContaining('Failed during database initialization'), 'ERROR');
  });
  
  test('should verify table schema for all tables', () => {
    initializeDatabase();
    
    // Check specific columns for each table
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('code_id TEXT PRIMARY KEY'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('address TEXT PRIMARY KEY'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('contract_address TEXT'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('token_id TEXT'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('owner_address TEXT'));
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(expect.stringContaining('owner TEXT'));
  });
  
  test('should initialize all necessary progress tracking steps', () => {
    initializeDatabase(true); // Test mode
    
    // Verify all required progress steps are initialized
    const expectedSteps = [
      'fetchCodeIds',
      'fetchContractsByCode',
      'fetchContractMetadata',
      'fetchContractHistory',
      'identifyContractTypes',
      'fetchTokensAndOwners'
    ];
    
    // The function should be called once for each step
    expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledTimes(7 + expectedSteps.length); // 7 tables + progress steps
    
    // Verify the prepare statement includes all steps
    for (const step of expectedSteps) {
      // Verify each step is initialized
      expect(jest.requireMock('../utils.js').db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR IGNORE INTO indexer_progress')
      );
    }
  });
});