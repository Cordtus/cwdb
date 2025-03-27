// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { db, log } from './utils.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// export async function exportCSV() {
// const contractAddresses = [
// "" //add contracts of interest here
// ];

// try {
// build placeholders for SQLite: "?, ?" etc.
// const placeholders = contractAddresses.map(() => '?').join(',');

// const sql = ``
// sql query and csv formatting

// write to /data/export.csv

// const outputPath = path.join(__dirname, 'data', 'export.csv');
// fs.writeFileSync(outputPath, csv, 'utf8');
// log(`Exported data to ${outputPath}`, 'INFO');
// } catch (error) {
// log(`Failed to export export CSV: ${error.message}`, 'ERROR');
// throw error;
// }
// }