import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeedContracts } from '../testHarness.js';

test('resolveSeedContracts rejects an empty harness configuration', () => {
	assert.throws(
		() => resolveSeedContracts({ argv: ['node', 'test_index.js'], env: {} }),
		/at least one contract/i
	);
});

test('resolveSeedContracts reads comma-separated contracts from the environment', () => {
	const contracts = resolveSeedContracts({
		argv: ['node', 'test_index.js'],
		env: { CWDB_TEST_CONTRACTS: ' juno1alpha, ,juno1beta ' }
	});

	assert.deepEqual(contracts, ['juno1alpha', 'juno1beta']);
});

test('resolveSeedContracts reads repeated --contract arguments', () => {
	const contracts = resolveSeedContracts({
		argv: ['node', 'test_index.js', '--contract', 'juno1alpha', '--contract=juno1beta'],
		env: {}
	});

	assert.deepEqual(contracts, ['juno1alpha', 'juno1beta']);
});
