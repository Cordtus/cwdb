/**
 * Normalizes a chain-registry gRPC endpoint for @grpc/grpc-js.
 * Chain-registry entries sometimes include https://, while grpc-js expects
 * only host:port as the dial target.
 *
 * @param {string} address - gRPC endpoint from config or chain-registry.
 * @returns {{target: string, useTls: boolean}}
 */
export function normalizeGrpcAddress(address) {
	if (!address || typeof address !== 'string') {
		throw new Error('grpcAddress must be a non-empty string');
	}

	let parsed;
	try {
		parsed = address.includes('://') ? new URL(address) : null;
	} catch (error) {
		throw new Error(`Invalid grpcAddress "${address}": ${error.message}`);
	}

	if (parsed) {
		const target = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
		return {
			target,
			useTls: parsed.protocol === 'https:'
		};
	}

	const port = address.split(':').pop();
	return {
		target: address,
		useTls: port === '443'
	};
}

/**
 * Resolves the configured gRPC endpoint, allowing test/live runs to override
 * the checked-in config without editing config.js.
 *
 * @param {{grpcAddress?: string}} runtimeConfig
 * @param {{CWDB_GRPC_ADDRESS?: string}} env
 * @returns {string}
 */
export function resolveGrpcAddress(runtimeConfig, env = process.env) {
	const envAddress = env.CWDB_GRPC_ADDRESS?.trim();
	return envAddress || runtimeConfig.grpcAddress;
}

/**
 * Resolves the per-call gRPC deadline in milliseconds.
 *
 * @param {{timeout?: number}} runtimeConfig
 * @param {{CWDB_GRPC_TIMEOUT_MS?: string}} env
 * @returns {number}
 */
export function resolveGrpcTimeoutMs(runtimeConfig, env = process.env) {
	const envTimeout = Number(env.CWDB_GRPC_TIMEOUT_MS);
	if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;

	const configTimeout = Number(runtimeConfig.timeout);
	return Number.isFinite(configTimeout) && configTimeout > 0 ? configTimeout : 30000;
}
