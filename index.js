// index.js
import {
	fetchCodeIds,
	fetchContractAddressesByCodeId,
	fetchContractMetadata,
	fetchContractHistory,
	identifyContractTypes,
	fetchTokensAndOwners
} from './contractCaller.js';
import {
	log,
	checkProgress,
	updateProgress,
	initializeBlockHeight
} from './utils.js';
import { config } from './config.js';
import { initializeDatabase } from './initDb.js';
import { closeConnections } from './grpcClient.js';
import { resolveGrpcAddress } from './grpcAddress.js';
import fs from 'fs';

// Ensure data and logs directories exist
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

/**
 * Runs the full indexer pipeline.
 */
async function runIndexer() {
	try {
		await initializeBlockHeight();

		log(`CosmWasm gRPC Indexer started with log level: ${config.logLevel}`, 'INFO');
		log(`gRPC endpoint: ${resolveGrpcAddress(config)}`, 'INFO');
		initializeDatabase();
		log('Database initialized successfully.', 'INFO');

		const steps = [
			{ name: 'fetchCodeIds', action: () => fetchCodeIds() },
			{ name: 'fetchContractsByCode', action: () => fetchContractAddressesByCodeId() },
			{ name: 'fetchContractMetadata', action: () => fetchContractMetadata() },
			{ name: 'fetchContractHistory', action: () => fetchContractHistory() },
			{ name: 'identifyContractTypes', action: () => identifyContractTypes() },
			{ name: 'fetchTokensAndOwners', action: () => fetchTokensAndOwners() }
		];

		let allStepsCompleted = true;
		let batchProgressUpdates = [];

		for (const step of steps) {
			let retries = 3;
			let completed = false;

			while (retries > 0 && !completed) {
				const progress = checkProgress(step.name);
				log(`Progress for ${step.name}: completed=${progress.completed}`, 'DEBUG');

				if (!progress.completed) {
					log(`Starting step: ${step.name}`, 'INFO');
					try {
						log(`Executing action for step: ${step.name}`, 'DEBUG');
						await step.action();

						batchProgressUpdates.push({ step: step.name, completed: 1 });
						completed = true;
						log(`Completed step: ${step.name}`, 'INFO');

						if (batchProgressUpdates.length >= 5) {
							batchProgressUpdates.forEach(({ step, completed }) => {
								updateProgress(step, completed);
							});
							batchProgressUpdates = [];
							log(`Batch progress updates committed for steps`, 'INFO');
						}
					} catch (error) {
						retries--;
						log(`Error during step "${step.name}": ${error.message}. Retries left: ${retries}`, 'ERROR');
						log(`Stack trace for error in step "${step.name}": ${error.stack}`, 'DEBUG');
						if (retries === 0) {
							allStepsCompleted = false;
							log(`Failed step "${step.name}" after multiple retries.`, 'ERROR');
							break;
						}
					}
				} else {
					completed = true;
					log(`Skipping step: ${step.name} (already completed)`, 'INFO');
				}
			}

			if (!completed) {
				log(`Aborting indexing due to failure in step: ${step.name}`, 'ERROR');
				allStepsCompleted = false;
				break;
			}
		}

		if (batchProgressUpdates.length > 0) {
			batchProgressUpdates.forEach(({ step, completed }) => {
				updateProgress(step, completed);
			});
			log(`Final batch progress updates committed for steps`, 'INFO');
		}

		if (allStepsCompleted) {
			log('All indexing steps completed successfully.', 'INFO');
		} else {
			log('Not all steps were completed successfully.', 'ERROR');
		}
	} catch (error) {
		log(`Failed to run indexer: ${error.message}`, 'ERROR');
		if (error.stack) {
			log(`Stack trace: ${error.stack}`, 'DEBUG');
		}
	} finally {
		closeConnections();
	}
}

runIndexer().catch((error) => {
	log(`Failed to initialize and run the indexer: ${error.message}`, 'ERROR');
	if (error.stack) {
		log(`Stack trace: ${error.stack}`, 'DEBUG');
	}
	closeConnections();
});
