// tests/grpcClient.test.js

import { jest } from '@jest/globals';
import { setupMocks } from './test-helpers.js';

// Setup all mocks
setupMocks();

// Import after mocking
import { grpcClient } from '../grpcClient.js';

describe('gRPC Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should call grpcurl with the correct command', async () => {
    const payload = { code_id: '1' };
    await grpcClient["cosmwasm.wasm.v1.Query"].Code(payload);
    
    expect(jest.requireMock('child_process').exec).toHaveBeenCalledWith(
      expect.stringContaining('grpcurl -d \'{"code_id":"1"}\''),
      expect.any(Function)
    );
    
    expect(jest.requireMock('child_process').exec).toHaveBeenCalledWith(
      expect.stringContaining('cosmwasm.wasm.v1.Query/Code'),
      expect.any(Function)
    );
  });
  
  test('should parse and return the JSON response', async () => {
    const payload = { code_id: '1' };
    const result = await grpcClient["cosmwasm.wasm.v1.Query"].Code(payload);
    
    expect(result).toEqual({ result: 'success' });
  });
  
  test('should throw an error when grpcurl command fails', async () => {
    // Setup failing exec mock
    jest.requireMock('child_process').exec.mockImplementationOnce((cmd, callback) => {
      callback(new Error('Failed to execute grpcurl command'), { stdout: '' });
    });
    
    const payload = { code_id: '1' };
    
    await expect(grpcClient["cosmwasm.wasm.v1.Query"].Code(payload))
      .rejects.toThrow('Failed to call cosmwasm.wasm.v1.Query/Code');
  });
  
  test('should throw an error when JSON parsing fails', async () => {
    // Setup invalid JSON response
    jest.requireMock('child_process').exec.mockImplementationOnce((cmd, callback) => {
      const stdout = 'invalid json';
      callback(null, { stdout });
    });
    
    const payload = { code_id: '1' };
    
    await expect(grpcClient["cosmwasm.wasm.v1.Query"].Code(payload))
      .rejects.toThrow();
  });
  
  test('should handle complex nested JSON payloads', async () => {
    const complexPayload = {
      pagination: {
        limit: 100,
        key: Buffer.from('somekey').toString('base64')
      },
      height: 123456,
      options: {
        include_inactive: true
      }
    };
    
    await grpcClient["cosmwasm.wasm.v1.Query"].Codes(complexPayload);
    
    // Verify the JSON was stringified correctly
    expect(jest.requireMock('child_process').exec).toHaveBeenCalledWith(
      expect.stringContaining(JSON.stringify(complexPayload)),
      expect.any(Function)
    );
  });
  
  test('should connect to the correct gRPC server address', async () => {
    // The GRPC_SERVER constant is defined in grpcClient.js
    const payload = { code_id: '1' };
    await grpcClient["cosmwasm.wasm.v1.Query"].Code(payload);
    
    expect(jest.requireMock('child_process').exec).toHaveBeenCalledWith(
      expect.stringContaining('grpc.mantrachain.io:443'),
      expect.any(Function)
    );
  });
});