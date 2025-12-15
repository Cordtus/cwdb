// databaseInit.js
import { log, db } from './utils.js';

export function initializeDatabase(isTest = false) {
  const createTableStatements = [
    // Lookup tables first
    `CREATE TABLE IF NOT EXISTS contract_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT UNIQUE NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS operation_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_name TEXT UNIQUE NOT NULL
    )`,

    // Core tables with proper data types
    `CREATE TABLE IF NOT EXISTS indexer_progress (
      step TEXT PRIMARY KEY,
      completed INTEGER DEFAULT 0,
      last_processed TEXT,
      last_fetched_token TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS code_ids (
      code_id INTEGER PRIMARY KEY,
      creator CHAR(68) NOT NULL,
      instantiate_permission TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS contracts (
      address CHAR(68) PRIMARY KEY,
      code_id INTEGER NOT NULL,
      type_id INTEGER,
      creator CHAR(68),
      admin CHAR(68),
      label TEXT,
      tokens_minted INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (code_id) REFERENCES code_ids(code_id),
      FOREIGN KEY (type_id) REFERENCES contract_types(id)
    )`,

    `CREATE TABLE IF NOT EXISTS contract_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_address CHAR(68) NOT NULL,
      operation_id INTEGER NOT NULL,
      code_id INTEGER NOT NULL,
      updated_at TIMESTAMP,
      msg TEXT,
      FOREIGN KEY (contract_address) REFERENCES contracts(address),
      FOREIGN KEY (operation_id) REFERENCES operation_types(id),
      FOREIGN KEY (code_id) REFERENCES code_ids(code_id)
    )`,

    `CREATE TABLE IF NOT EXISTS contract_tokens (
      contract_address CHAR(68) NOT NULL,
      token_id TEXT NOT NULL,
      contract_type_id INTEGER,
      token_uri TEXT,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (contract_address, token_id),
      FOREIGN KEY (contract_address) REFERENCES contracts(address),
      FOREIGN KEY (contract_type_id) REFERENCES contract_types(id)
    )`,

    `CREATE TABLE IF NOT EXISTS cw20_owners (
      contract_address CHAR(68) NOT NULL,
      owner_address CHAR(68) NOT NULL,
      balance NUMERIC NOT NULL DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (contract_address, owner_address),
      FOREIGN KEY (contract_address) REFERENCES contracts(address)
    )`,

    `CREATE TABLE IF NOT EXISTS nft_owners (
      collection_address CHAR(68) NOT NULL,
      token_id TEXT NOT NULL,
      owner CHAR(68) NOT NULL,
      contract_type_id INTEGER,
      acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_address, token_id),
      FOREIGN KEY (collection_address) REFERENCES contracts(address),
      FOREIGN KEY (contract_type_id) REFERENCES contract_types(id)
    )`,

    `CREATE TABLE IF NOT EXISTS pointer_data (
      contract_address CHAR(68) PRIMARY KEY,
      pointer_address CHAR(68) NOT NULL,
      pointee_address CHAR(68) NOT NULL,
      is_base_asset BOOLEAN DEFAULT 0,
      is_pointer BOOLEAN DEFAULT 0,
      pointer_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contract_address) REFERENCES contracts(address)
    )`,

    `CREATE TABLE IF NOT EXISTS wallet_associations (
      wallet_address CHAR(68) PRIMARY KEY,
      evm_address CHAR(44),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  const createIndexStatements = [
    // Performance indexes
    `CREATE INDEX IF NOT EXISTS idx_contracts_code_id ON contracts(code_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contracts_type_id ON contracts(type_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contract_history_address ON contract_history(contract_address)`,
    `CREATE INDEX IF NOT EXISTS idx_contract_history_operation ON contract_history(operation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contract_history_updated ON contract_history(updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_contract_tokens_address ON contract_tokens(contract_address)`,
    `CREATE INDEX IF NOT EXISTS idx_nft_owners_collection ON nft_owners(collection_address)`,
    `CREATE INDEX IF NOT EXISTS idx_nft_owners_owner ON nft_owners(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_cw20_owners_owner ON cw20_owners(owner_address)`,
    `CREATE INDEX IF NOT EXISTS idx_wallet_assoc_evm ON wallet_associations(evm_address)`
  ];

  const progressSteps = [
    'fetchCodeIds',
    'fetchContractsByCode',
    'fetchContractMetadata',
    'fetchContractHistory',
    'identifyContractTypes',
    'fetchTokensAndOwners'
  ];

  try {
    const dbInstance = db;

    // Use WAL mode for better concurrent performance
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('foreign_keys = ON'); // Enable foreign key constraints

    dbInstance.transaction(() => {
      // Create all tables
      for (const statement of createTableStatements) {
        dbInstance.prepare(statement).run();
        log(`Table created/verified`, 'INFO');
      }

      // Create indexes
      for (const statement of createIndexStatements) {
        dbInstance.prepare(statement).run();
      }
      log('Indexes created/verified', 'INFO');

      // Insert default operation types
      const insertOpTypes = dbInstance.prepare(`
        INSERT OR IGNORE INTO operation_types (operation_name) VALUES (?)
      `);
      insertOpTypes.run('CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT');
      insertOpTypes.run('CONTRACT_CODE_HISTORY_OPERATION_TYPE_MIGRATE');

      // For test mode, initialize progress steps
      if (isTest) {
        progressSteps.forEach((step) => {
          dbInstance.prepare(`
            INSERT OR IGNORE INTO indexer_progress (step, completed, last_processed, last_fetched_token)
            VALUES (?, 0, NULL, NULL)
          `).run(step);
        });
        log('Progress steps initialized for test mode', 'INFO');
      }
    })();

    log('Database initialization completed successfully with optimized schema.', 'INFO');
  } catch (error) {
    log(`Failed during database initialization: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Helper function to get or create contract type
export function getOrCreateContractType(db, typeName) {
  if (!typeName) return null;

  const existing = db.prepare('SELECT id FROM contract_types WHERE type_name = ?').get(typeName);
  if (existing) return existing.id;

  const result = db.prepare('INSERT INTO contract_types (type_name) VALUES (?)').run(typeName);
  return result.lastInsertRowid;
}

// Helper function to get operation type ID
export function getOperationTypeId(db, operationName) {
  const result = db.prepare('SELECT id FROM operation_types WHERE operation_name = ?').get(operationName);
  return result ? result.id : null;
}
