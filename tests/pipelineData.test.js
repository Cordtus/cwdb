import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildNftInfoRows,
	getOperationTypeName,
	historyEntryToRow,
	inferContractTypeFromError
} from '../pipelineData.js';

test('buildNftInfoRows skips token and owner rows when NFT info query fails', () => {
	const rows = buildNftInfoRows({
		contractAddress: 'juno1collection',
		tokenId: '1',
		tokenTypeId: 7,
		nftInfoResponse: { data: null, error: 'not found', message: 'not found' }
	});

	assert.equal(rows, null);
});

test('buildNftInfoRows stores token metadata without inventing an owner', () => {
	const rows = buildNftInfoRows({
		contractAddress: 'juno1collection',
		tokenId: '2',
		tokenTypeId: 7,
		nftInfoResponse: {
			data: {
				data: {
					info: {
						token_uri: 'ipfs://example',
						extension: { name: 'Token 2' }
					}
				}
			}
		}
	});

	assert.deepEqual(rows, {
		tokenRow: ['juno1collection', '2', 7, 'ipfs://example', '{"name":"Token 2"}'],
		ownerRow: null
	});
});

test('buildNftInfoRows stores token metadata and real owner when returned', () => {
	const rows = buildNftInfoRows({
		contractAddress: 'juno1collection',
		tokenId: '3',
		tokenTypeId: 7,
		nftInfoResponse: {
			data: {
				data: {
					access: { owner: 'juno1owner' },
					info: { token_uri: null, extension: null }
				}
			}
		}
	});

	assert.deepEqual(rows, {
		tokenRow: ['juno1collection', '3', 7, null, null],
		ownerRow: ['juno1collection', '3', 'juno1owner', 7]
	});
});

test('buildNftInfoRows normalizes numeric token IDs to strings', () => {
	const rows = buildNftInfoRows({
		contractAddress: 'juno1collection',
		tokenId: 42,
		tokenTypeId: 7,
		nftInfoResponse: {
			data: {
				data: {
					access: { owner: 'juno1owner' },
					info: { token_uri: null, extension: null }
				}
			}
		}
	});

	assert.deepEqual(rows, {
		tokenRow: ['juno1collection', '42', 7, null, null],
		ownerRow: ['juno1collection', '42', 'juno1owner', 7]
	});
});

test('getOperationTypeName maps gRPC history operation enum values', () => {
	assert.equal(getOperationTypeName(1), 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT');
	assert.equal(getOperationTypeName(2), 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_MIGRATE');
	assert.equal(getOperationTypeName(3), 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_GENESIS');
	assert.equal(getOperationTypeName('CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT'), 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT');
});

test('inferContractTypeFromError extracts known contract families', () => {
	assert.equal(
		inferContractTypeFromError('Error parsing into type cw721_base::msg::QueryMsg: unknown variant `token_info`'),
		'cw721'
	);
	assert.equal(
		inferContractTypeFromError('Error parsing into type cw1155_nabla::msg::QueryMsg: unknown variant `all_tokens`'),
		'cw1155'
	);
	assert.equal(
		inferContractTypeFromError('query wasm contract failed'),
		null
	);
});

test('historyEntryToRow emits columns that match the contract_history schema', () => {
	const msg = Buffer.from(JSON.stringify({ instantiate: { count: 1 } })).toString('base64');
	const row = historyEntryToRow({
		contractAddress: 'juno1contract',
		entry: {
			operation: 1,
			code_id: 42,
			updated: { block_height: 12345 },
			msg
		},
		resolveOperationId: (operationName) => {
			assert.equal(operationName, 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT');
			return 10;
		}
	});

	assert.deepEqual(row, [
		'juno1contract',
		10,
		42,
		12345,
		'{"instantiate":{"count":1}}'
	]);
});

test('historyEntryToRow supports genesis history entries', () => {
	const row = historyEntryToRow({
		contractAddress: 'juno1contract',
		entry: {
			operation: 3,
			code_id: 1,
			updated: { block_height: 4136532 }
		},
		resolveOperationId: (operationName) => {
			assert.equal(operationName, 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_GENESIS');
			return 12;
		}
	});

	assert.deepEqual(row, [
		'juno1contract',
		12,
		1,
		4136532,
		null
	]);
});
