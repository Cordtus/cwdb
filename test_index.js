// test_index.js

import { 
  fetchContractMetadata,
  fetchContractHistory, 
  identifyContractTypes, 
  fetchTokensAndOwners, 
  fetchPointerData, 
  fetchAssociatedWallets, 
} from './contractHelper.js';
import { log, db, fetchData, initializeBlockHeight } from './utils.js';
import { config } from './config.js';
import { initializeDatabase } from './initDb.js';
import fs from 'fs';

// Ensure data and logs directories exist
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

async function fetchCodeIdForContract(contractAddress) {
  const url = `${config.restAddress}/cosmwasm/wasm/v1/contract/${contractAddress}`;
  const response = await fetchData(url);
  
  if (!response?.contract_info?.code_id) {
    throw new Error(`Failed to fetch code_id for contract ${contractAddress}`);
  }
  return response.contract_info.code_id;
}

async function seedContracts() {
  const contracts = [
    "sei1g2a0q3tddzs7vf7lk45c2tgufsaqerxmsdr2cprth3mjtuqxm60qdmravc",
    "sei1v90ly54qeu7497lzk2mnmp2h29sgtep8hs5ryvfqf8dwq5gc0t9srp6aey"
  ];

  try {
    log('Starting contract seeding process...', 'INFO');

    for (const contractAddress of contracts) {
      log(`Attempting to fetch code_id for ${contractAddress}`, 'DEBUG');
      const codeId = await fetchCodeIdForContract(contractAddress);
      
      db.transaction(() => {

        db.prepare(`
          INSERT OR IGNORE INTO code_ids (code_id, creator, instantiate_permission)
          VALUES (?, ?, ?)
        `).run(codeId, 'manual_seed', '{"permission":"Everybody","address":""}');
        log(`Inserted code_id ${codeId} for contract ${contractAddress}`, 'INFO');

        // Insert into contracts table
        db.prepare(`
          INSERT OR IGNORE INTO contracts (code_id, address, type, creator, admin, label, tokens_minted)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(codeId, contractAddress, null, 'manual_creator', null, 'manually_seeded', null);
        log(`Inserted contract ${contractAddress} with code_id ${codeId}`, 'INFO');
      })();
    }

    log('Contract seeding completed successfully.', 'INFO');
  } catch (error) {
    log(`Error during contract seeding: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function runTestIndexer() {
  try {
    await initializeBlockHeight();
    log('Test Indexer started', 'INFO');
    
    const steps = [
      { name: 'fetchContractMetadata', action: () => fetchContractMetadata(config.restAddress) },
      { name: 'fetchContractHistory', action: () => fetchContractHistory(config.restAddress) },
      { name: 'identifyContractTypes', action: () => identifyContractTypes(config.restAddress) },
      { name: 'fetchTokensAndOwners', action: () => fetchTokensAndOwners(config.restAddress) },
      { name: 'fetchPointerData', action: () => fetchPointerData(config.pointerApi) },
      { name: 'fetchAssociatedWallets', action: () => fetchAssociatedWallets(config.evmRpcAddress) }
    ];

    for (const step of steps) {
      log(`Starting test step: ${step.name}`, 'INFO');
      try {
        await step.action();
        log(`Test step ${step.name} completed successfully.`, 'INFO');
      } catch (error) {
        log(`Test step ${step.name} failed: ${error.message}`, 'ERROR');
        // Single retry
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

    log('All test steps completed successfully.', 'INFO');
  } catch (error) {
    log(`Test failed: ${error.message}`, 'ERROR');
    throw error;
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
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to seed contracts:', error);
      process.exit(1);
    });
} else {
  // Default: initialize DB, seed contracts, and run the indexer
  initializeDatabase();
  seedContracts()
    .then(() => runTestIndexer())
    .catch((error) => {
      log(`Test run failed: ${error.message}`, 'ERROR');
      process.exit(1);
    });
}
