import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('schema preserves blockchain integer strings without SQLite numeric coercion', async () => {
	const tempDir = mkdtempSync(join(tmpdir(), 'cwdb-schema-'));
	process.env.CWDB_DATABASE_PATH = join(tempDir, 'schema.db');

	try {
		const { initializeDatabase } = await import('../initDb.js');
		const { db } = await import('../utils.js');

		initializeDatabase(true);

		const contractsColumns = db.prepare('PRAGMA table_info(contracts)').all();
		const cw20OwnerColumns = db.prepare('PRAGMA table_info(cw20_owners)').all();

		assert.equal(
			contractsColumns.find(column => column.name === 'tokens_minted')?.type,
			'TEXT'
		);
		assert.equal(
			cw20OwnerColumns.find(column => column.name === 'balance')?.type,
			'TEXT'
		);

		db.close();
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
