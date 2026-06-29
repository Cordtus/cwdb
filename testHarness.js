function appendContracts(value, contracts) {
	if (!value) return;
	for (const contract of value.split(',')) {
		const trimmed = contract.trim();
		if (trimmed) contracts.push(trimmed);
	}
}

/**
 * Resolves target contracts for the live test harness.
 * Accepts CWDB_TEST_CONTRACTS=a,b, --contract a, and --contract=a.
 *
 * @param {Object} options
 * @param {string[]} options.argv
 * @param {Object} options.env
 * @returns {string[]}
 */
export function resolveSeedContracts({ argv = process.argv, env = process.env } = {}) {
	const contracts = [];
	appendContracts(env.CWDB_TEST_CONTRACTS, contracts);

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--contract') {
			appendContracts(argv[i + 1], contracts);
			i++;
			continue;
		}
		if (arg.startsWith('--contract=')) {
			appendContracts(arg.slice('--contract='.length), contracts);
		}
	}

	const uniqueContracts = [...new Set(contracts)];
	if (uniqueContracts.length === 0) {
		throw new Error('Provide at least one contract with CWDB_TEST_CONTRACTS or --contract.');
	}
	return uniqueContracts;
}
