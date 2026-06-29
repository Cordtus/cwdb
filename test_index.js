// test_index.js

import {
	fetchContractMetadata,
	fetchContractHistory,
	identifyContractTypes,
	fetchTokensAndOwners
} from './contractCaller.js';
import { log, db, initializeBlockHeight } from './utils.js';
import { initializeDatabase } from './initDb.js';
import { grpcClient, closeConnections } from './grpcClient.js';
import { resolveSeedContracts } from './testHarness.js';
import fs from 'fs';

// Ensure data and logs directories exist
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

/**
 * Fetches the code_id for a contract address via gRPC ContractInfo.
 * @param {string} contractAddress - Contract bech32 address
 * @returns {number} The code_id
 */
async function fetchCodeIdForContract(contractAddress) {
	const response = await grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo({
		address: contractAddress
	});

	if (!response?.contract_info?.code_id) {
		throw new Error(`Failed to fetch code_id for contract ${contractAddress}`);
	}
	return response.contract_info.code_id;
}

/**
 * Seeds specific contracts into the database for targeted testing.
 */
async function seedContracts() {
	const contracts = resolveSeedContracts();

	try {
		log('Starting contract seeding process...', 'INFO');

		for (const contractAddress of contracts) {
			if (!contractAddress) continue;

			log(`Attempting to fetch code_id for ${contractAddress}`, 'DEBUG');
			const codeId = await fetchCodeIdForContract(contractAddress);

			db.transaction(() => {
				db.prepare(`
					INSERT OR IGNORE INTO code_ids (code_id, creator, instantiate_permission)
					VALUES (?, ?, ?)
				`).run(codeId, 'manual_seed', '{"permission":"Everybody","addresses":[]}');
				log(`Inserted code_id ${codeId} for contract ${contractAddress}`, 'INFO');

				db.prepare(`
					INSERT OR IGNORE INTO contracts (code_id, address, type_id, creator, admin, label, tokens_minted)
					VALUES (?, ?, ?, ?, ?, ?, ?)
				`).run(codeId, contractAddress, null, 'manual_creator', null, 'manually_seeded', null);
				log(`Inserted contract ${contractAddress} with code_id ${codeId}`, 'INFO');
			})();
		}

		log('Contract seeding completed successfully.', 'INFO');
		return contracts;
	} catch (error) {
		log(`Error during contract seeding: ${error.message}`, 'ERROR');
		throw error;
	}
}

function validatePipelineResults(contracts) {
	const placeholders = contracts.map(() => '?').join(', ');
	const rows = db.prepare(`
		SELECT c.address, c.tokens_minted, ct.type_name
		FROM contracts c
		LEFT JOIN contract_types ct ON c.type_id = ct.id
		WHERE c.address IN (${placeholders})
	`).all(...contracts);

	if (rows.length !== contracts.length) {
		throw new Error(`Expected ${contracts.length} seeded contracts, found ${rows.length}`);
	}

	for (const row of rows) {
		if (!row.type_name) {
			throw new Error(`Contract ${row.address} was not assigned a contract type`);
		}

		const historyCount = db.prepare('SELECT COUNT(*) AS count FROM contract_history WHERE contract_address = ?').get(row.address).count;
		if (historyCount === 0) {
			throw new Error(`Contract ${row.address} has no contract history rows`);
		}

		if ((row.type_name === 'cw20' || row.type_name === 'cw20_base') && row.tokens_minted === null) {
			throw new Error(`CW20 contract ${row.address} has no total supply recorded`);
		}
	}
}

/**
 * Runs the test indexer pipeline on seeded contracts.
 */
async function runTestIndexer(contracts) {
	try {
		await initializeBlockHeight();
		log('Test Indexer started', 'INFO');

		const steps = [
			{ name: 'fetchContractMetadata', action: () => fetchContractMetadata() },
			{ name: 'fetchContractHistory', action: () => fetchContractHistory() },
			{ name: 'identifyContractTypes', action: () => identifyContractTypes() },
			{ name: 'fetchTokensAndOwners', action: () => fetchTokensAndOwners() }
		];

		for (const step of steps) {
			log(`Starting test step: ${step.name}`, 'INFO');
			try {
				await step.action();
				log(`Test step ${step.name} completed successfully.`, 'INFO');
			} catch (error) {
				log(`Test step ${step.name} failed: ${error.message}`, 'ERROR');
				try {
					log(`Retrying step: ${step.name}`, 'INFO');
					await step.action();
					log(`Test step ${step.name} completed successfully on retry.`, 'INFO');
				} catch (retryError) {
					log(`Test step ${step.name} failed on retry: ${retryError.message}`, 'ERROR');
					throw retryError;
				}
			}
		}

		validatePipelineResults(contracts);
		log('All test steps completed successfully.', 'INFO');
	} catch (error) {
		log(`Test failed: ${error.message}`, 'ERROR');
		throw error;
	} finally {
		closeConnections();
	}
}

// Handle command line arguments
if (process.argv.includes('--init-db')) {
	initializeDatabase();
	console.log('Database initialization complete.');
	process.exit(0);
}

if (process.argv.includes('--seed-contracts')) {
	initializeDatabase();
	seedContracts()
		.then(() => {
			console.log('Contract seeding complete.');
			closeConnections();
			process.exit(0);
		})
		.catch((error) => {
			console.error('Failed to seed contracts:', error);
			closeConnections();
			process.exit(1);
		});
} else {
	// Default: initialize DB, seed contracts, and run the indexer
	initializeDatabase(true);
	seedContracts()
		.then((contracts) => runTestIndexer(contracts))
		.catch((error) => {
			log(`Test run failed: ${error.message}`, 'ERROR');
			closeConnections();
			process.exit(1);
		});
}
