import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, log } from './utils.js';  // Adjust import paths as needed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function exportOwnersCSV() {
  // The same addresses you use in seedContracts():
  const contractAddresses = [
    "sei1g2a0q3tddzs7vf7lk45c2tgufsaqerxmsdr2cprth3mjtuqxm60qdmravc",
    "sei1v90ly54qeu7497lzk2mnmp2h29sgtep8hs5ryvfqf8dwq5gc0t9srp6aey"
  ];

  try {
    // Build placeholders for SQLite: "?, ?" etc.
    const placeholders = contractAddresses.map(() => '?').join(',');

    //  1) Uses p.contract_address = o.collection_address
    //  2) Returns only token_id, evm_address, and pointer_address
    const sql = `
      SELECT
        o.token_id,
        w.evm_address,
        p.pointer_address
      FROM nft_owners AS o
      LEFT JOIN wallet_associations AS w
        ON o.owner = w.wallet_address
      LEFT JOIN pointer_data AS p
        ON o.collection_address = p.contract_address
      WHERE o.collection_address IN (${placeholders})
      ORDER BY o.collection_address, o.token_id;
    `;

    const rows = db.prepare(sql).all(...contractAddresses);

    // CSV columns: token_id, evm_address, pointer_address
    const headers = ['token_id', 'evm_address', 'pointer_address'];
    let csv = headers.join(',') + '\n';

    for (const row of rows) {
      // Map each column to its value or blank if null/undefined
      const line = headers.map(h => row[h] ?? '').join(',');
      csv += line + '\n';
    }

    // Write out to /data/owners.csv
    const outputPath = path.join(__dirname, 'data', 'owners.csv');
    fs.writeFileSync(outputPath, csv, 'utf8');
    log(`Exported ownership data to ${outputPath}`, 'INFO');
  } catch (error) {
    log(`Failed to export owners CSV: ${error.message}`, 'ERROR');
    throw error;
  }
}
