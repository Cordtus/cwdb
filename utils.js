// utils.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { WebSocket } from 'ws';
import { grpcClient } from './grpcClient.js';

// ES module-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize the SQLite database
const db = new Database(path.join(__dirname, './data/indexer.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Export the db instance for use in other modules
export { db };

export function log(message, level = 'INFO') {
  const logLevels = { 'ERROR': 0, 'INFO': 1, 'DEBUG': 2 };
  const currentLogLevel = config.logLevel || 'INFO';

  // Skip logging if the message level is below the current log level
  if (logLevels[level] > logLevels[currentLogLevel]) return;

  // Format the log message
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;

  // Log to console based on level
  if (level === 'ERROR' || currentLogLevel === 'DEBUG' || (level === 'INFO' && currentLogLevel !== 'ERROR')) {
    console.log(formattedMessage);
  }

  // Write to file if enabled and not DEBUG level to avoid duplicate log file entries
  if (config.logToFile && level !== 'DEBUG') {
    const logDir = './logs';
    const logFile = path.join(logDir, 'data_collection.log');

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    // Log directly to file without additional console confirmation
    fs.appendFileSync(logFile, formattedMessage + '\n');
  }
}

export async function initializeBlockHeight() {
  if (!config.blockHeight || config.blockHeight === "") {  // check for falsy/empty
    try {
      // Using gRPC instead of REST for block height
      const response = await fetchDataGrpc("latest_block", {});
      config.blockHeight = parseInt(response.block.header.height, 10);
      log(`Block height not specified. Using fetched blockHeight: ${config.blockHeight}`, 'INFO');
    } catch (error) {
      log(`Failed to fetch block height: ${error.message}`, 'ERROR');
      throw error;
    }
  } else {
    log(`Using configured blockHeight: ${config.blockHeight}`, 'INFO');
  }
}

// Retry function with exponential backoff and jitter
export async function retryOperation(operation, retries = 3, delay = 1000, backoffFactor = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      log(`Retrying operation (${i + 1}/${retries}) after failure: ${error.message}`, 'INFO');
      const jitter = Math.random() * delay;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      delay *= backoffFactor;
    }
  }
  log(`Operation failed after ${retries} retries.`, 'ERROR');
  return null; // Avoid throwing an error, return null to let main functions handle it
}

/**
 * Sends a smart contract query to the gRPC endpoint.
 * 
 * @param {string} contractAddress - The contract address to query.
 * @param {Object} payload - The query payload.
 * @param {boolean} skip400ErrorLog - If true, completely ignores 400 status errors.
 * @returns {Object} - The parsed response from the contract query, or an error object if the request failed.
 */
export async function sendContractQueryGrpc(contractAddress, payload, skip400ErrorLog = false) {
  try {
    log(`Sending gRPC contract query to: ${contractAddress}`, 'DEBUG');
    log(`Payload: ${JSON.stringify(payload)}`, 'DEBUG');

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const grpcPayload = {
      address: contractAddress,
      query_data: encodedPayload
    };

    // If block height is specified, add it to the query
    if (config.blockHeight) {
      grpcPayload.height = config.blockHeight.toString();
    }

    const response = await grpcClient["cosmwasm.wasm.v1.Query"].SmartContractState(grpcPayload);
    
    if (response && response.data) {
      log(`Received gRPC response for contract ${contractAddress}`, 'DEBUG');
      return { data: { data: JSON.parse(Buffer.from(response.data, 'base64').toString()) }, error: null, message: null };
    }
    
    return { data: null, error: "No data in response", message: null };
  } catch (error) {
    if (!skip400ErrorLog) {
      log(`Error querying contract ${contractAddress} via gRPC: ${error.message}`, 'ERROR');
    }
    return { data: null, error: error.message, message: error.message };
  }
}

// Legacy method for backward compatibility
export async function sendContractQuery(restAddress, contractAddress, payload, usePost = false, skip400ErrorLog = false) {
  return sendContractQueryGrpc(contractAddress, payload, skip400ErrorLog);
}

/**
 * Fetch data using gRPC client
 * @param {string} method - The gRPC method to call
 * @param {Object} payload - The payload for the gRPC call
 */
export async function fetchDataGrpc(method, payload, retries = 3) {
  return retryOperation(async () => {
    try {
      // Map REST methods to gRPC methods
      const methodMapping = {
        "code": "Code",
        "contracts": "ContractsByCode",
        "latest_block": "LatestBlock", // This might need to come from a different service
        "contract_info": "ContractInfo",
        "contract_history": "ContractHistory"
      };

      const grpcMethod = methodMapping[method] || method;
      
      // Determine which service to use
      let service = "cosmwasm.wasm.v1.Query";
      if (method === "latest_block") {
        service = "tendermint.BlockService"; // Might need adjustment
      }

      log(`Calling gRPC method ${service}.${grpcMethod} with payload: ${JSON.stringify(payload)}`, 'DEBUG');
      const response = await grpcClient[service][grpcMethod](payload);
      log(`gRPC response received: ${JSON.stringify(response)}`, 'DEBUG');
      
      return response;
    } catch (error) {
      log(`Error fetching data via gRPC: ${error.message}`, 'ERROR');
      throw error;
    }
  }, retries);
}

// Legacy method for backward compatibility
export async function fetchData(url, options = {}) {
  // Extract endpoint from URL for mapping to gRPC methods
  const endpoint = url.split('/').pop();
  
  // Convert URL/REST parameters to gRPC payload format
  // This is a simplified approach and might need adjustments
  let payload = {};
  
  if (url.includes('/code/')) {
    const codeId = url.split('/code/')[1].split('/')[0];
    payload = { code_id: codeId };
    
    if (url.includes('/contracts')) {
      // Handling pagination for contracts endpoint
      if (options.pagination && options.pagination.key) {
        payload.pagination = { key: options.pagination.key };
      }
      if (options.pagination && options.pagination.limit) {
        payload.pagination = { ...payload.pagination, limit: options.pagination.limit };
      }
      return fetchDataGrpc("contracts", payload);
    }
    
    return fetchDataGrpc("code", payload);
  } else if (url.includes('/contract/')) {
    const contractAddress = url.split('/contract/')[1].split('/')[0];
    payload = { address: contractAddress };
    
    if (url.includes('/history')) {
      return fetchDataGrpc("contract_history", payload);
    }
    
    return fetchDataGrpc("contract_info", payload);
  } else if (url.includes('/block')) {
    return fetchDataGrpc("latest_block", {});
  }
  
  // Fallback to REST if we can't map the endpoint
  return axios(url, options).then(res => res.data);
}

// Fetch paginated data using gRPC
export async function fetchPaginatedDataGrpc(method, key, options = {}) {
  const {
    limit = 100,
    retries = 3,
    delay = 1000,
    backoffFactor = 2,
    nextKey = null,
    params = {}
  } = options;

  let allData = [];
  let pageKey = nextKey;
  let pageCount = 0;

  log(`Fetching data for ${method}`, 'INFO');

  while (true) {
    // Prepare pagination parameters for gRPC
    const payload = {
      ...params,
      pagination: {
        limit: limit,
        ...(pageKey && { key: pageKey })
      }
    };

    try {
      // Call gRPC method with pagination
      const response = await fetchDataGrpc(method, payload);
      
      if (!response) {
        log(`Unexpected response structure for ${method}`, 'ERROR');
        return allData;
      }

      // Extract data based on key - may need adjustment based on gRPC response structure
      const dataBatch = Array.isArray(response[key]) ? response[key] : [];
      allData = allData.concat(dataBatch);

      pageCount += 1;
      
      // Extract next key from pagination
      pageKey = response.pagination?.next_key || null;

      if (!pageKey) break; // Stop if no next_key is present

      // Only log pagination if multiple pages are encountered
      if (pageCount > 1) {
        log(`Fetching additional page (${pageCount}) for ${method}`, 'INFO');
      }

      if (dataBatch.length < limit) break;
    } catch (error) {
      log(`Error fetching paginated data from ${method}: ${error.message}`, 'ERROR');
      return allData;
    }
  }

  log(`Fetched ${allData.length} items for ${method}`, 'INFO');
  return allData;
}

// Legacy method for backward compatibility
export async function fetchPaginatedData(url, key, options = {}) {
  // Map URL to gRPC method
  let method;
  let params = {};
  
  if (url.includes('/cosmwasm/wasm/v1/code')) {
    method = "Codes";
    
    // Extract code_id from URL if present
    const matches = url.match(/\/code\/(\d+)\/contracts/);
    if (matches && matches[1]) {
      method = "ContractsByCode";
      params.code_id = matches[1];
    }
  }
  
  return fetchPaginatedDataGrpc(method, key, {
    ...options,
    params
  });
}

// Helper function to batch database operations
export function batchInsertOrUpdate(tableName, columns, values, uniqueColumns) {
  if (!Array.isArray(values) || values.length === 0) {
    log('No values provided for batch insertion or update.', 'DEBUG');
    return;
  }

  const placeholders = values[0].map(() => '?').join(', ');
  const updateConditions = Array.isArray(uniqueColumns)
    ? uniqueColumns.map((col) => `${col} = ?`).join(' AND ')
    : `${uniqueColumns} = ?`;

  const sqlInsert = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES (${placeholders})
  `;
  const sqlUpdate = `
    UPDATE ${tableName}
    SET ${columns.map((col) => `${col} = ?`).join(', ')}
    WHERE ${updateConditions}
  `;

  const insert = db.prepare(sqlInsert);
  const update = db.prepare(sqlUpdate);

  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      try {
        // Determine the unique values based on uniqueColumns
        const uniqueValues = Array.isArray(uniqueColumns)
          ? uniqueColumns.map((col) => row[columns.indexOf(col)])
          : [row[columns.indexOf(uniqueColumns)]];

        // Safely handle JSON strings, NULL values, and strings
        const sanitizedRow = row.map((val, idx) => {
          if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val); // Escape JSON strings
          }
          return val !== null ? val : null;
        });

        log(`Processing row: ${sanitizedRow}`, 'DEBUG');

        // Check if an existing row matches the unique column(s)
        const existingRow = db
          .prepare(`SELECT * FROM ${tableName} WHERE ${updateConditions}`)
          .get(...uniqueValues);

        if (existingRow) {
          update.run([...sanitizedRow, ...uniqueValues]);
          log(
            `Updated row in ${tableName} where ${updateConditions} with values ${JSON.stringify(uniqueValues)}`,
            'DEBUG'
          );
        } else {
          insert.run(sanitizedRow);
          log(`Inserted new row into ${tableName}`, 'DEBUG');
        }
      } catch (error) {
        log(`Failed to insert or update row in ${tableName}: ${error.message}`, 'ERROR');
      }
    }
  });

  try {
    transaction(values);
    log(`Successfully processed ${values.length} rows in ${tableName}`, 'DEBUG');
  } catch (error) {
    log(`Failed to process rows in ${tableName}: ${error.message}`, 'ERROR');
    throw error; // Re-throw the error to allow higher-level handling
  }
}

export function createWebSocketConnection(url, onMessageCallback, onErrorCallback) {
  const ws = new WebSocket(url);

  ws.on('open', () => {
    log(`WebSocket connection established to ${url}`, 'INFO');
  });

  ws.on('message', (data) => {
    try {
      const parsedData = JSON.parse(data);
      log(`Received WebSocket message: ${JSON.stringify(parsedData)}`, 'DEBUG');
      onMessageCallback(parsedData);
    } catch (error) {
      log(`Failed to parse WebSocket message: ${error.message}`, 'ERROR');
    }
  });

  ws.on('error', (error) => {
    log(`WebSocket error on ${url}: ${error.message}`, 'ERROR');
    if (onErrorCallback) onErrorCallback(error);
  });

  ws.on('close', () => {
    log(`WebSocket connection closed for ${url}`, 'INFO');
  });

  return ws;
}

// Helper function to check progress in the database
export function checkProgress(step) {
  try {
    const row = db.prepare('SELECT completed, last_processed, last_fetched_token FROM indexer_progress WHERE step = ?').get(step);
    if (row) {
      return row;
    }
    return { completed: 0, last_processed: null, last_fetched_token: null };
  } catch (error) {
    log(`Error checking progress for step ${step}: ${error.message}`, 'ERROR');
    return { completed: 0, last_processed: null, last_fetched_token: null }; // Return default progress
  }
}

// Helper function to update progress in the database
export function updateProgress(step, completed = 1, lastProcessed = null, lastFetchedToken = null) {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO indexer_progress (step, completed, last_processed, last_fetched_token) VALUES (?, ?, ?, ?)`
    ).run(step, completed, lastProcessed, lastFetchedToken);
    log(`Progress updated for step ${step}`, 'DEBUG');
  } catch (error) {
    log(`Error updating progress for step ${step}: ${error.message}`, 'ERROR');
  }
}