// contractCaller.js
import {
	sendContractQueryGrpc,
	retryOperation,
	log,
	batchInsertOrUpdate,
	checkProgress,
	updateProgress,
	hasNextKey,
	db
} from './utils.js';
import { getOrCreateContractType, getOperationTypeId } from './initDb.js';
import pLimit from 'p-limit';
import { config } from './config.js';
import { grpcClient } from './grpcClient.js';

/**
 * Fetches all code IDs from the chain via gRPC and stores them in the database.
 */
export async function fetchCodeIds() {
	try {
		const progress = checkProgress('fetchCodeIds');
		if (progress.completed) {
			log('Skipping fetchCodeIds: Already completed', 'INFO');
			return;
		}

		let nextKey = null;
		let totalRecorded = 0;
		let batchCount = 0;
		let batchProgressUpdates = [];

		while (true) {
			const payload = {
				pagination: {
					limit: config.paginationLimit,
					...(nextKey && { key: nextKey })
				}
			};

			const response = await grpcClient["cosmwasm.wasm.v1.Query"].Codes(payload);

			if (!response.code_infos || response.code_infos.length === 0) {
				log('All code IDs recorded; no additional data found.', 'INFO');
				break;
			}

			const batchData = response.code_infos.map(info =>
				[info.code_id, info.creator, JSON.stringify(info.instantiate_permission)]
			);

			db.transaction(() => {
				batchInsertOrUpdate('code_ids', ['code_id', 'creator', 'instantiate_permission'], batchData, 'code_id');
			})();

			batchCount += 1;
			totalRecorded += batchData.length;

			log(`Batch ${batchCount}: Recorded ${batchData.length} code IDs.`, 'INFO');

			nextKey = response.pagination?.next_key || null;
			if (!hasNextKey(nextKey)) {
				log('No further pagination key found; pagination ended.', 'INFO');
				break;
			} else {
				log(`Pagination continues; moving to the next page for code IDs.`, 'INFO');
			}

			if (batchCount === 1 || batchCount % 20 === 0) {
				batchProgressUpdates.push({ step: 'fetchCodeIds', completed: 0, lastProcessed: response.code_infos[response.code_infos.length - 1].code_id });
			}
		}

		if (totalRecorded > 0) {
			log(`Total code IDs fetched and stored: ${totalRecorded}`, 'INFO');
			batchProgressUpdates.push({ step: 'fetchCodeIds', completed: 1 });
		} else {
			log('No new code IDs recorded.', 'INFO');
		}

		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
	} catch (error) {
		log(`Error in fetchCodeIds: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Fetches all contract addresses for each code ID via gRPC.
 */
export async function fetchContractAddressesByCodeId() {
	try {
		const progress = checkProgress('fetchContractsByCode');
		if (progress.completed) {
			log('Skipping fetchContractsByCode: Already completed', 'INFO');
			return;
		}

		const codeIds = db.prepare('SELECT code_id FROM code_ids').all().map(row => row.code_id);
		const startIndex = progress.last_processed ? codeIds.indexOf(progress.last_processed) + 1 : 0;
		const limit = pLimit(config.concurrencyLimit);
		let totalContracts = 0;
		let batchProgressUpdates = [];

		const fetchPromises = codeIds.slice(startIndex).map((code_id, index) => limit(async () => {
			log(`Fetching contracts for code_id ${code_id}`, 'INFO');

			let allContracts = [];
			let nextKey = null;
			let page = 1;

			while (true) {
				const payload = {
					code_id: code_id,
					pagination: {
						limit: config.paginationLimit,
						...(nextKey && { key: nextKey })
					}
				};

				log(`Fetching data for code_id ${code_id}, page ${page}`, 'DEBUG');

				const response = await grpcClient["cosmwasm.wasm.v1.Query"].ContractsByCode(payload);

				if (response.contracts && response.contracts.length > 0) {
					allContracts.push(...response.contracts);
					log(`Fetched ${response.contracts.length} items for code_id ${code_id} on page ${page}`, 'DEBUG');
				} else {
					log(`No more contracts found for code_id ${code_id} on page ${page}`, 'INFO');
					break;
				}

				if (response.contracts.length < config.paginationLimit) break;
				nextKey = response.pagination?.next_key || null;
				if (!hasNextKey(nextKey)) break;
				page += 1;
			}

			const contractCount = allContracts.length;
			totalContracts += contractCount;

			if (contractCount > 0) {
				const batchData = allContracts.map(addr => [code_id, addr, null]);
				await batchInsertOrUpdate('contracts', ['code_id', 'address', 'type_id'], batchData, 'address');
				log(`Recorded ${contractCount} contracts for code_id ${code_id}`, 'INFO');
			} else {
				log(`No contracts found for code_id ${code_id}`, 'INFO');
			}

			if (index === 0 || index % 20 === 0) {
				batchProgressUpdates.push({ step: 'fetchContractsByCode', completed: 0, lastProcessed: code_id });
			}
		}));

		await Promise.allSettled(fetchPromises);
		batchProgressUpdates.push({ step: 'fetchContractsByCode', completed: 1 });
		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
		log(`Completed fetching contract addresses for all code IDs. Total contracts recorded: ${totalContracts}`, 'INFO');
	} catch (error) {
		log(`Error in fetchContractAddressesByCodeId: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Fetches contract history for each contract address concurrently.
 */
export async function fetchContractHistory() {
	try {
		const contracts = db.prepare('SELECT address FROM contracts').all().map(row => row.address);
		const limit = pLimit(config.concurrencyLimit);
		let batchProgressUpdates = [];

		const historyPromises = contracts.map((contractAddress, index) => limit(async () => {
			log(`Fetching contract history for ${contractAddress}`, 'INFO');
			let nextKey = null;

			while (true) {
				const payload = {
					address: contractAddress,
					pagination: {
						limit: config.paginationLimit,
						...(nextKey && { key: nextKey })
					}
				};

				try {
					const response = await grpcClient["cosmwasm.wasm.v1.Query"].ContractHistory(payload);

					if (!response.entries || response.entries.length === 0) {
						log(`No history entries found for ${contractAddress}`, 'INFO');
						break;
					}

					const insertData = response.entries.map(entry => [
						contractAddress,
						entry.operation || '',
						entry.code_id || '',
						entry.updated?.block_height || '',
						JSON.stringify(entry.msg || {}).replace(/"/g, '""').replace(/\\/g, '\\\\'),
					]);

					await batchInsertOrUpdate(
						'contract_history',
						['contract_address', 'operation', 'code_id', 'updated', 'msg'],
						insertData,
						['contract_address', 'operation', 'code_id']
					);

					log(`Inserted ${response.entries.length} history entries for ${contractAddress}`, 'DEBUG');

					nextKey = response.pagination?.next_key || null;
					if (!hasNextKey(nextKey)) break;
				} catch (error) {
					log(`Error querying history for ${contractAddress}: ${error.message}`, 'ERROR');
					break;
				}
			}

			if (index === 0 || index % 20 === 0) {
				batchProgressUpdates.push({ step: 'fetchContractHistory', completed: 0, lastProcessed: contractAddress });
			}
		}));

		await Promise.allSettled(historyPromises);
		batchProgressUpdates.push({ step: 'fetchContractHistory', completed: 1 });
		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
		log('Completed fetching contract history for all contracts.', 'INFO');
	} catch (error) {
		log(`Error in fetchContractHistory: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Fetches metadata for each contract (creator, admin, label, type detection).
 */
export async function fetchContractMetadata() {
	const batchSize = 50;
	const delayBetweenBatches = 50;

	try {
		const progress = checkProgress('fetchContractMetadata');
		if (progress.completed) {
			log('Skipping fetchContractMetadata: Already completed', 'INFO');
			return;
		}

		const contractAddresses = db.prepare('SELECT address FROM contracts').all().map(row => row.address);
		const totalContracts = contractAddresses.length;
		const startIndex = progress.last_processed ? contractAddresses.indexOf(progress.last_processed) + 1 : 0;
		let batchProgressUpdates = [];

		log(`Starting fetchContractMetadata for ${totalContracts} contracts. Resuming from index ${startIndex}.`, 'INFO');

		const codeIdMap = new Map();
		const contractsByCodeId = db.prepare('SELECT code_id, address FROM contracts').all();
		contractsByCodeId.forEach(({ code_id, address }) => {
			if (!codeIdMap.has(code_id)) {
				codeIdMap.set(code_id, new Set());
			}
			codeIdMap.get(code_id).add(address);
		});

		for (let i = startIndex; i < totalContracts; i += batchSize) {
			const batch = contractAddresses.slice(i, i + batchSize);
			const limit = pLimit(config.concurrencyLimit);

			const fetchPromises = batch.map(contractAddress => limit(async () => {
				try {
					const payload = { address: contractAddress };
					const response = await grpcClient["cosmwasm.wasm.v1.Query"].ContractInfo(payload);

					if (response?.contract_info) {
						const { code_id, creator, admin, label } = response.contract_info;
						let contractType = null;

						if (label) {
							const labelLower = label.toLowerCase();
							if (labelLower.includes('cw721')) contractType = 'cw721';
							else if (labelLower.includes('cw20')) contractType = 'cw20';
							else if (labelLower.includes('cw1155')) contractType = 'cw1155';
							else if (labelLower.includes('cw404')) contractType = 'cw404';
						}

						if (!contractType) {
							try {
								const infoResponse = await sendContractQueryGrpc(contractAddress, { contract_info: {} }, false);
								if (infoResponse?.data?.data?.symbol) {
									contractType = 'cw20';
								}
							} catch {
								log(`Could not determine type from contract_info for ${contractAddress}`, 'DEBUG');
							}
						}

						const typeId = contractType ? getOrCreateContractType(db, contractType) : null;

						if (typeId && codeIdMap.has(String(code_id))) {
							const relatedContracts = Array.from(codeIdMap.get(String(code_id)));
							const batchData = relatedContracts.map(addr => [addr, code_id, creator, admin, label, typeId]);
							await batchInsertOrUpdate(
								'contracts',
								['address', 'code_id', 'creator', 'admin', 'label', 'type_id'],
								batchData,
								'address'
							);
							log(`Updated type_id ${typeId} for all contracts with code_id ${code_id}`, 'DEBUG');
						} else {
							await batchInsertOrUpdate(
								'contracts',
								['address', 'code_id', 'creator', 'admin', 'label'],
								[[contractAddress, code_id, creator, admin, label]],
								'address'
							);
						}

						return true;
					}
				} catch (error) {
					log(`Failed to fetch metadata for ${contractAddress}: ${error.message}`, 'ERROR');
				}
				return false;
			}));

			const results = await Promise.all(fetchPromises);
			const successCount = results.filter(Boolean).length;
			log(`Processed ${successCount}/${batch.length} contracts in current batch`, 'INFO');

			batchProgressUpdates.push({
				step: 'fetchContractMetadata',
				completed: 0,
				lastProcessed: batch[batch.length - 1]
			});

			await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
		}

		batchProgressUpdates.push({ step: 'fetchContractMetadata', completed: 1 });
		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
		log('Finished processing metadata for all contracts.', 'INFO');
	} catch (error) {
		log(`Error in fetchContractMetadata: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Identifies contract types by sending invalid queries and parsing error messages.
 */
export async function identifyContractTypes() {
	try {
		const contracts = db.prepare(`
			SELECT address
			FROM contracts
			WHERE type_id IS NULL
		`).all().map(row => row.address);

		if (!contracts.length) {
			log('No contracts need type identification.', 'INFO');
			return;
		}

		const progress = checkProgress('identifyContractTypes');
		const startIndex = progress.last_processed
			? contracts.indexOf(progress.last_processed) + 1
			: 0;

		const batchSize = 50;
		let batchData = [];
		let processedCount = 0;
		let batchProgressUpdates = [];
		const limit = pLimit(config.concurrencyLimit);

		const typePromises = contracts.slice(startIndex).map(contractAddress =>
			limit(async () => {
				let contractType = null;
				const testPayload = { "a": "b" };

				try {
					const response = await sendContractQueryGrpc(contractAddress, testPayload, true);
					if (response?.message) {
						log(`Debug: Full error message for ${contractAddress}: ${response.message}`, 'DEBUG');

						const match = response.message.match(/Error parsing into type (.+?):/);
						if (match) {
							const extractedType = match[1].toLowerCase();
							const knownTypes = ['cw721', 'cw20', 'cw404', 'cw1155'];
							const found = knownTypes.find(t => extractedType.includes(t));
							if (found) {
								contractType = found;
								log(`Identified contract type for ${contractAddress}: ${contractType}`, 'INFO');
							} else {
								log(`Extracted type "${extractedType}" not recognized for ${contractAddress}`, 'INFO');
							}
						} else {
							log(`No recognizable type in error message for contract ${contractAddress}`, 'INFO');
						}
					} else {
						log(`No 'message' field in response for contract ${contractAddress}`, 'DEBUG');
					}
				} catch (error) {
					if (error?.response?.status !== 400) {
						log(`Error determining contract type for ${contractAddress}: ${error.message}`, 'ERROR');
					}
				}

				if (contractType) {
					const typeId = getOrCreateContractType(db, contractType);
					batchData.push([contractAddress, typeId]);
				}
				processedCount++;

				if (batchData.length >= batchSize) {
					await batchInsertOrUpdate('contracts', ['address', 'type_id'], batchData, 'address');
					batchData = [];
					batchProgressUpdates.push({
						step: 'identifyContractTypes',
						completed: 0,
						lastProcessed: contractAddress
					});
				}

				if (processedCount % 100 === 0 || processedCount === contracts.length) {
					log(`Progress: Processed ${processedCount} / ${contracts.length} contracts`, 'INFO');
				}
			})
		);

		await Promise.allSettled(typePromises);

		if (batchData.length > 0) {
			await batchInsertOrUpdate('contracts', ['address', 'type_id'], batchData, 'address');
			log(`Final batch inserted contract types for ${batchData.length} contracts`, 'DEBUG');
		}

		batchProgressUpdates.push({ step: 'identifyContractTypes', completed: 1 });
		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
		log('Finished identifying contract types for all contracts.', 'INFO');
	} catch (error) {
		log(`Error in identifyContractTypes: ${error.message}`, 'ERROR');
		throw error;
	}
}

/**
 * Fetches tokens and ownership data for NFT and CW20 contracts.
 */
export async function fetchTokensAndOwners() {
	const delayBetweenBatches = 100;
	const concurrencyLimit = config.concurrencyLimit || 5;
	const limit = pLimit(concurrencyLimit);

	try {
		const progress = checkProgress('fetchTokensAndOwners');
		const contracts = db.prepare(`
			SELECT c.address, ct.type_name as type
			FROM contracts c
			JOIN contract_types ct ON c.type_id = ct.id
			WHERE ct.type_name IN ('cw721', 'cw1155', 'cw404', 'cw20_base', 'cw20')
		`).all();
		const startIndex = progress.last_processed ? contracts.findIndex(contract => contract.address === progress.last_processed) + 1 : 0;
		let batchProgressUpdates = [];

		for (let i = startIndex; i < contracts.length; i++) {
			const { address: contractAddress, type: contractType } = contracts[i];
			let allTokens = [];
			let ownershipData = [];
			let lastTokenFetched = null;

			log(`Fetching tokens for contract ${contractAddress} of type ${contractType}`, 'INFO');

			if (contractType === 'cw20_base' || contractType === 'cw20') {
				const tokenInfoResponse = await sendContractQueryGrpc(contractAddress, { token_info: {} }, false);
				log(`Token info response for ${contractAddress}: ${JSON.stringify(tokenInfoResponse)}`, 'DEBUG');

				const totalSupply = tokenInfoResponse?.data?.data?.total_supply;

				if (!totalSupply) {
					log(`No supply or unsupported contract spec for cw20 contract ${contractAddress}. Skipping...`, 'ERROR');
					batchProgressUpdates.push({ step: 'fetchTokensAndOwners', completed: 0, lastProcessed: contractAddress });
					continue;
				}

				log(`Recorded total supply for cw20 contract ${contractAddress}: ${totalSupply}`, 'INFO');
				await batchInsertOrUpdate('contracts', ['address', 'tokens_minted'], [[contractAddress, totalSupply]], 'address');

				let allAccounts = [];
				let paginationKey = null;

				do {
					const accountsQueryPayload = { all_accounts: { limit: config.paginationLimit, ...(paginationKey && { start_after: paginationKey }) } };
					const accountsResponse = await sendContractQueryGrpc(contractAddress, accountsQueryPayload, false);
					log(`Accounts response for ${contractAddress}: ${JSON.stringify(accountsResponse)}`, 'DEBUG');

					const accounts = accountsResponse?.data?.data?.accounts || [];
					if (accounts.length > 0) {
						allAccounts.push(...accounts);
						paginationKey = accounts[accounts.length - 1];
						log(`Fetched ${accounts.length} accounts for cw20 contract ${contractAddress}.`, 'DEBUG');
					} else {
						paginationKey = null;
					}
				} while (paginationKey);

				const cw20OwnershipPromises = allAccounts.map(account => limit(async () => {
					const balanceQueryPayload = { balance: { address: account } };
					const balanceResponse = await sendContractQueryGrpc(contractAddress, balanceQueryPayload, false);
					log(`Balance response for account ${account} in ${contractAddress}: ${JSON.stringify(balanceResponse)}`, 'DEBUG');

					const balance = balanceResponse?.data?.data?.balance;
					if (balance) {
						ownershipData.push([contractAddress, account, balance]);
						log(`Recorded balance for cw20 contract ${contractAddress}: owner=${account}, balance=${balance}`, 'DEBUG');
					} else {
						log(`Failed to retrieve balance for account ${account} in cw20 contract ${contractAddress}.`, 'ERROR');
					}
				}));

				await Promise.allSettled(cw20OwnershipPromises);

				if (ownershipData.length > 0) {
					await batchInsertOrUpdate('cw20_owners', ['contract_address', 'owner_address', 'balance'], ownershipData, ['contract_address', 'owner_address']);
					log(`Inserted ${ownershipData.length} ownership records into cw20_owners for ${contractAddress}`, 'INFO');
				}

				batchProgressUpdates.push({ step: 'fetchTokensAndOwners', completed: 0, lastProcessed: contractAddress });
				await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
				continue;
			}

			// Process NFT contract types (cw721, cw1155, cw404)
			while (true) {
				const tokenQueryPayload = { all_tokens: { limit: config.paginationLimit, ...(lastTokenFetched && { start_after: lastTokenFetched }) } };
				const response = await sendContractQueryGrpc(contractAddress, tokenQueryPayload, false);
				log(`Token response for ${contractAddress}: ${JSON.stringify(response)}`, 'DEBUG');

				const tokenIds = response?.data?.data?.tokens || [];
				if (tokenIds.length === 0) {
					log(`No more tokens found for contract ${contractAddress}`, 'INFO');
					break;
				}

				allTokens.push(...tokenIds);
				lastTokenFetched = tokenIds[tokenIds.length - 1];
				log(`Fetched ${tokenIds.length} tokens for contract ${contractAddress}`, 'DEBUG');

				const tokenData = tokenIds.map(tokenId => [contractAddress, tokenId]);
				await batchInsertOrUpdate('contract_tokens', ['contract_address', 'token_id'], tokenData, ['contract_address', 'token_id']);
			}

			if (allTokens.length > 0) {
				await batchInsertOrUpdate('contracts', ['address', 'tokens_minted'], [[contractAddress, allTokens.length]], 'address');
				log(`Updated tokens_minted for contract ${contractAddress} with total tokens: ${allTokens.length}`, 'INFO');

				const nftOwnerData = allTokens.map(tokenId => [contractAddress, tokenId]);
				await batchInsertOrUpdate('nft_owners', ['collection_address', 'token_id'], nftOwnerData, ['collection_address', 'token_id']);
				log(`Inserted ${nftOwnerData.length} records into nft_owners for contract ${contractAddress}`, 'INFO');

				const tokenPromises = allTokens.map(tokenId => limit(async () => {
					try {
						const nftInfoPayload = { all_nft_info: { token_id: tokenId } };
						const nftInfoResponse = await sendContractQueryGrpc(contractAddress, nftInfoPayload, false);

						if (nftInfoResponse?.data?.data) {
							const { access, info } = nftInfoResponse.data.data;
							const owner = access?.owner;
							const tokenUri = info?.token_uri;
							const metadata = info?.extension;

							const tokenTypeId = getOrCreateContractType(db, contractType);
							await batchInsertOrUpdate(
								'contract_tokens',
								['contract_address', 'token_id', 'contract_type_id', 'token_uri', 'metadata'],
								[[contractAddress, tokenId, tokenTypeId, tokenUri, JSON.stringify(metadata)]],
								['contract_address', 'token_id']
							);

							if (owner) {
								await batchInsertOrUpdate(
									'nft_owners',
									['collection_address', 'token_id', 'owner', 'contract_type_id'],
									[[contractAddress, tokenId, owner, tokenTypeId]],
									['collection_address', 'token_id']
								);
							}
						}
					} catch (error) {
						log(`Error fetching NFT info for token ${tokenId} in contract ${contractAddress}: ${error.message}`, 'ERROR');
					}
				}));

				await Promise.allSettled(tokenPromises);
			} else {
				log(`No tokens retrieved for contract ${contractAddress}. Skipping...`, 'INFO');
			}

			batchProgressUpdates.push({ step: 'fetchTokensAndOwners', completed: 0, lastProcessed: contractAddress });
			await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
		}

		batchProgressUpdates.push({ step: 'fetchTokensAndOwners', completed: 1 });
		batchProgressUpdates.forEach(update => updateProgress(update.step, update.completed, update.lastProcessed));
		log('Finished processing tokens and ownership for all contracts.', 'INFO');
	} catch (error) {
		log(`Error in fetchTokensAndOwners: ${error.message}`, 'ERROR');
		throw error;
	}
}
