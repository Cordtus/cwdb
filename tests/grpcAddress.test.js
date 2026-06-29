import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrpcAddress, resolveGrpcAddress, resolveGrpcTimeoutMs } from '../grpcAddress.js';

test('normalizeGrpcAddress strips https scheme and uses TLS', () => {
	assert.deepEqual(
		normalizeGrpcAddress('https://sei-grpc.polkachu.com:11990'),
		{ target: 'sei-grpc.polkachu.com:11990', useTls: true }
	);
});

test('normalizeGrpcAddress uses TLS for port 443 without a scheme', () => {
	assert.deepEqual(
		normalizeGrpcAddress('juno.lavenderfive.com:443'),
		{ target: 'juno.lavenderfive.com:443', useTls: true }
	);
});

test('normalizeGrpcAddress keeps plain host ports insecure by default', () => {
	assert.deepEqual(
		normalizeGrpcAddress('juno-grpc.polkachu.com:12690'),
		{ target: 'juno-grpc.polkachu.com:12690', useTls: false }
	);
});

test('resolveGrpcAddress uses config by default', () => {
	assert.equal(
		resolveGrpcAddress({ grpcAddress: 'juno-grpc.polkachu.com:12690' }, {}),
		'juno-grpc.polkachu.com:12690'
	);
});

test('resolveGrpcAddress lets CWDB_GRPC_ADDRESS override config', () => {
	assert.equal(
		resolveGrpcAddress(
			{ grpcAddress: 'juno-grpc.polkachu.com:12690' },
			{ CWDB_GRPC_ADDRESS: '192.168.0.170:19090' }
		),
		'192.168.0.170:19090'
	);
});

test('resolveGrpcAddress ignores blank CWDB_GRPC_ADDRESS', () => {
	assert.equal(
		resolveGrpcAddress(
			{ grpcAddress: 'juno-grpc.polkachu.com:12690' },
			{ CWDB_GRPC_ADDRESS: '   ' }
		),
		'juno-grpc.polkachu.com:12690'
	);
});

test('resolveGrpcTimeoutMs lets CWDB_GRPC_TIMEOUT_MS override config', () => {
	assert.equal(
		resolveGrpcTimeoutMs({ timeout: 5000 }, { CWDB_GRPC_TIMEOUT_MS: '30000' }),
		30000
	);
});

test('resolveGrpcTimeoutMs falls back to config and default values', () => {
	assert.equal(resolveGrpcTimeoutMs({ timeout: 5000 }, {}), 5000);
	assert.equal(resolveGrpcTimeoutMs({ timeout: 0 }, {}), 30000);
});
