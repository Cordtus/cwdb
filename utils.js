// utils.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { grpcClient, hasNextKey } from './grpcClient.js';

// ES module-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize the SQLite database
const configuredDbPath = process.env.CWDB_DATABASE_PATH || config.databasePath || './data/indexer.db';
const dbPath = path.isAbsolute(configuredDbPath)
	? configuredDbPath
	: path.join(__dirname, configuredDbPath);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

export { db };

/**
 * Logs a message at the specified level.
 * @param {string} message - Log message
 * @param {string} level - Log level: ERROR, INFO, or DEBUG
 */
export function log(message, level = 'INFO') {
	const logLevels = { 'ERROR': 0, 'INFO': 1, 'DEBUG': 2 };
	const envLogLevel = process.env.CWDB_LOG_LEVEL?.trim().toUpperCase();
	const configuredLogLevel = config.logLevel || 'INFO';
	const currentLogLevel = logLevels[envLogLevel] !== undefined ? envLogLevel : configuredLogLevel;

	if (logLevels[level] > logLevels[currentLogLevel]) return;

	const timestamp = new Date().toISOString();
	const formattedMessage = `[${timestamp}] [${level}] ${message}`;

	if (level === 'ERROR' || currentLogLevel === 'DEBUG' || (level === 'INFO' && currentLogLevel !== 'ERROR')) {
		console.log(formattedMessage);
	}

	if (config.logToFile && level !== 'DEBUG') {
		const logDir = './logs';
		const logFile = path.join(logDir, 'data_collection.log');

		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
		fs.appendFileSync(logFile, formattedMessage + '\n');
	}
}

/**
 * Fetches and sets the latest block height if not configured.
 */
export async function initializeBlockHeight() {
	if (!config.blockHeight || config.blockHeight === "") {
		try {
			const response = await grpcClient["cosmos.base.tendermint.v1beta1.Service"].GetLatestBlock({});
			const height = response?.sdk_block?.header?.height;
			if (height) {
				config.blockHeight = typeof height === 'number' ? height : parseInt(height, 10);
				log(`Block height not specified. Using fetched blockHeight: ${config.blockHeight}`, 'INFO');
			} else {
				throw new Error('Could not extract block height from response');
			}
		} catch (error) {
			log(`Failed to fetch block height: ${error.message}`, 'ERROR');
			throw error;
		}
	} else {
		config.blockHeight = typeof config.blockHeight === 'number'
			? config.blockHeight
			: parseInt(config.blockHeight, 10);
		log(`Using configured blockHeight: ${config.blockHeight}`, 'INFO');
	}
}

/**
 * Retry function with exponential backoff and jitter.
 * @param {Function} operation - Async operation to retry
 * @param {number} retries - Max retry attempts
 * @param {number} delay - Initial delay in ms
 * @param {number} backoffFactor - Multiplier for each retry
 * @returns {*} Operation result or null on failure
 */
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
	return null;
}

/**
 * Sends a smart contract query via gRPC SmartContractState.
 * @param {string} contractAddress - The contract address to query
 * @param {Object} payload - The query payload (will be JSON-encoded then base64'd)
 * @param {boolean} skip400ErrorLog - If true, suppresses error logging
 * @returns {Object} {data, error, message}
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

		const response = await grpcClient["cosmwasm.wasm.v1.Query"].SmartContractState(grpcPayload);

		if (response && response.data) {
			log(`Received gRPC response for contract ${contractAddress}`, 'DEBUG');
			const decoded = JSON.parse(Buffer.from(response.data, 'base64').toString());
			return { data: { data: decoded }, error: null, message: null };
		}

		return { data: null, error: "No data in response", message: null };
	} catch (error) {
		const errorMsg = error.details || error.message;
		if (!skip400ErrorLog) {
			log(`Error querying contract ${contractAddress} via gRPC: ${errorMsg}`, 'ERROR');
		}
		return { data: null, error: errorMsg, message: errorMsg };
	}
}

/**
 * Helper function to batch database operations (insert or update).
 * @param {string} tableName - Target table
 * @param {string[]} columns - Column names
 * @param {Array[]} values - Rows of values
 * @param {string|string[]} uniqueColumns - Column(s) for conflict resolution
 */
export function batchInsertOrUpdate(tableName, columns, values, uniqueColumns) {
	if (!Array.isArray(values) || values.length === 0) {
		log('No values provided for batch insertion or update.', 'DEBUG');
		return;
	}

	const uniqueCols = Array.isArray(uniqueColumns) ? uniqueColumns : [uniqueColumns];
	const nonUniqueCols = columns.filter(col => !uniqueCols.includes(col));

	const placeholders = columns.map(() => '?').join(', ');
	const onConflictSet = nonUniqueCols.length > 0
		? `ON CONFLICT(${uniqueCols.join(', ')}) DO UPDATE SET ${nonUniqueCols.map(col => `${col} = excluded.${col}`).join(', ')}`
		: `ON CONFLICT(${uniqueCols.join(', ')}) DO NOTHING`;

	const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ${onConflictSet}`;
	const stmt = db.prepare(sql);

	const transaction = db.transaction((rows) => {
		for (const row of rows) {
			try {
				const sanitizedRow = row.map((val) => {
					if (typeof val === 'object' && val !== null) {
						return JSON.stringify(val);
					}
					return val !== null ? val : null;
				});
				stmt.run(sanitizedRow);
			} catch (error) {
				log(`Failed to upsert row in ${tableName}: ${error.message}`, 'ERROR');
				throw error;
			}
		}
	});

	try {
		transaction(values);
		log(`Upserted ${values.length} rows in ${tableName}`, 'DEBUG');
	} catch (error) {
		log(`Failed to process rows in ${tableName}: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Checks indexer progress for a given step.
 * @param {string} step - Step name
 * @returns {Object} {completed, last_processed, last_fetched_token}
 */
export function checkProgress(step) {
	try {
		const row = db.prepare('SELECT completed, last_processed, last_fetched_token FROM indexer_progress WHERE step = ?').get(step);
		if (row) return row;
		return { completed: 0, last_processed: null, last_fetched_token: null };
	} catch (error) {
		log(`Error checking progress for step ${step}: ${error.message}`, 'ERROR');
		return { completed: 0, last_processed: null, last_fetched_token: null };
	}
}

/**
 * Updates indexer progress for a given step.
 * @param {string} step - Step name
 * @param {number} completed - 1 if completed, 0 if in progress
 * @param {string|null} lastProcessed - Last processed item identifier
 * @param {string|null} lastFetchedToken - Last fetched token identifier
 */
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

// Re-export hasNextKey for convenience
export { hasNextKey };
