/**
 * Native gRPC client for CosmWasm and Cosmos SDK queries.
 * Uses @grpc/grpc-js with protobufjs for message encoding/decoding.
 * No external proto files or grpcurl needed.
 * @module grpcClient
 */
import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import { config } from './config.js';
import { normalizeGrpcAddress, resolveGrpcAddress, resolveGrpcTimeoutMs } from './grpcAddress.js';

/** Protobuf type definitions for Cosmos/CosmWasm queries (field IDs match upstream protos) */
const root = protobuf.Root.fromJSON({
	nested: {
		PageRequest: {
			fields: {
				key: { type: "bytes", id: 1 },
				offset: { type: "uint64", id: 2 },
				limit: { type: "uint64", id: 3 },
				count_total: { type: "bool", id: 4 },
				reverse: { type: "bool", id: 5 }
			}
		},
		PageResponse: {
			fields: {
				next_key: { type: "bytes", id: 1 },
				total: { type: "uint64", id: 2 }
			}
		},
		AccessConfig: {
			fields: {
				permission: { type: "int32", id: 1 },
				addresses: { rule: "repeated", type: "string", id: 3 }
			}
		},
		CodeInfoResponse: {
			fields: {
				code_id: { type: "uint64", id: 1 },
				creator: { type: "string", id: 2 },
				data_hash: { type: "bytes", id: 3 },
				instantiate_permission: { type: "AccessConfig", id: 6 }
			}
		},
		AbsoluteTxPosition: {
			fields: {
				block_height: { type: "uint64", id: 1 },
				tx_index: { type: "uint64", id: 2 }
			}
		},
		ContractInfo: {
			fields: {
				code_id: { type: "uint64", id: 1 },
				creator: { type: "string", id: 2 },
				admin: { type: "string", id: 3 },
				label: { type: "string", id: 4 },
				created: { type: "AbsoluteTxPosition", id: 5 },
				ibc_port_id: { type: "string", id: 6 }
			}
		},
		ContractCodeHistoryEntry: {
			fields: {
				operation: { type: "int32", id: 1 },
				code_id: { type: "uint64", id: 2 },
				updated: { type: "AbsoluteTxPosition", id: 3 },
				msg: { type: "bytes", id: 4 }
			}
		},
		QueryCodesRequest: {
			fields: {
				pagination: { type: "PageRequest", id: 1 }
			}
		},
		QueryCodesResponse: {
			fields: {
				code_infos: { rule: "repeated", type: "CodeInfoResponse", id: 1 },
				pagination: { type: "PageResponse", id: 2 }
			}
		},
		QueryContractsByCodeRequest: {
			fields: {
				code_id: { type: "uint64", id: 1 },
				pagination: { type: "PageRequest", id: 2 }
			}
		},
		QueryContractsByCodeResponse: {
			fields: {
				contracts: { rule: "repeated", type: "string", id: 1 },
				pagination: { type: "PageResponse", id: 2 }
			}
		},
		QueryContractInfoRequest: {
			fields: {
				address: { type: "string", id: 1 }
			}
		},
		QueryContractInfoResponse: {
			fields: {
				address: { type: "string", id: 1 },
				contract_info: { type: "ContractInfo", id: 2 }
			}
		},
		QueryContractHistoryRequest: {
			fields: {
				address: { type: "string", id: 1 },
				pagination: { type: "PageRequest", id: 2 }
			}
		},
		QueryContractHistoryResponse: {
			fields: {
				entries: { rule: "repeated", type: "ContractCodeHistoryEntry", id: 1 },
				pagination: { type: "PageResponse", id: 2 }
			}
		},
		QuerySmartContractStateRequest: {
			fields: {
				address: { type: "string", id: 1 },
				query_data: { type: "bytes", id: 2 }
			}
		},
		QuerySmartContractStateResponse: {
			fields: {
				data: { type: "bytes", id: 1 }
			}
		},
		GetLatestBlockRequest: {
			fields: {}
		},
		BlockHeader: {
			fields: {
				chain_id: { type: "string", id: 2 },
				height: { type: "int64", id: 3 }
			}
		},
		Block: {
			fields: {
				header: { type: "BlockHeader", id: 1 }
			}
		},
		GetLatestBlockResponse: {
			fields: {
				sdk_block: { type: "Block", id: 3 }
			}
		}
	}
});

/** Conversion options for protobufjs decode: uint64 -> Number, bytes -> base64 string */
const toObjectOpts = { longs: Number, bytes: String, defaults: false };

/**
 * Creates a gRPC service client for a given service path and method definitions.
 * @param {string} servicePath - Fully qualified gRPC service path
 * @param {Object} methodDefs - Map of method name to {requestType, responseType}
 * @returns {Function} gRPC client constructor
 */
function createServiceDef(servicePath, methodDefs) {
	const def = {};
	for (const [name, { requestType, responseType }] of Object.entries(methodDefs)) {
		const reqType = root.lookupType(requestType);
		const resType = root.lookupType(responseType);
		def[name] = {
			path: `/${servicePath}/${name}`,
			requestStream: false,
			responseStream: false,
			requestSerialize: (msg) => Buffer.from(reqType.encode(reqType.create(msg)).finish()),
			requestDeserialize: (buf) => reqType.toObject(reqType.decode(buf), toObjectOpts),
			responseSerialize: (msg) => Buffer.from(resType.encode(resType.create(msg)).finish()),
			responseDeserialize: (buf) => resType.toObject(resType.decode(buf), toObjectOpts),
		};
	}
	return def;
}

/** CosmWasm Query service definition */
const wasmQueryDef = createServiceDef('cosmwasm.wasm.v1.Query', {
	Codes: { requestType: 'QueryCodesRequest', responseType: 'QueryCodesResponse' },
	ContractsByCode: { requestType: 'QueryContractsByCodeRequest', responseType: 'QueryContractsByCodeResponse' },
	ContractInfo: { requestType: 'QueryContractInfoRequest', responseType: 'QueryContractInfoResponse' },
	ContractHistory: { requestType: 'QueryContractHistoryRequest', responseType: 'QueryContractHistoryResponse' },
	SmartContractState: { requestType: 'QuerySmartContractStateRequest', responseType: 'QuerySmartContractStateResponse' },
});

/** Tendermint Service definition (for block height) */
const tendermintDef = createServiceDef('cosmos.base.tendermint.v1beta1.Service', {
	GetLatestBlock: { requestType: 'GetLatestBlockRequest', responseType: 'GetLatestBlockResponse' },
});

/**
 * Wraps a gRPC client method as an async function.
 * @param {Object} client - gRPC client instance
 * @param {string} method - Method name
 * @returns {Function} Async function that calls the gRPC method
 */
function promisifyMethod(client, method) {
	return (request) => new Promise((resolve, reject) => {
		const deadline = new Date(Date.now() + resolveGrpcTimeoutMs(config));
		client[method](request, new grpc.Metadata(), { deadline }, (err, response) => {
			if (err) reject(err);
			else resolve(response);
		});
	});
}

/** Determine TLS credentials and grpc-js target from the configured endpoint. */
const { target: grpcTarget, useTls } = normalizeGrpcAddress(resolveGrpcAddress(config));
const creds = useTls
	? grpc.credentials.createSsl()
	: grpc.credentials.createInsecure();

/** Channel options */
const channelOpts = {
	'grpc.max_receive_message_length': 64 * 1024 * 1024,
	'grpc.keepalive_time_ms': 30000,
	'grpc.keepalive_timeout_ms': 10000,
};

/** Create gRPC clients */
const WasmClient = grpc.makeClientConstructor(wasmQueryDef, 'Query');
const TendermintClient = grpc.makeClientConstructor(tendermintDef, 'Service');

const wasmClient = new WasmClient(grpcTarget, creds, channelOpts);
const tendermintClient = new TendermintClient(grpcTarget, creds, channelOpts);

/**
 * Exported gRPC client with promisified methods.
 * Maintains the same API as the previous grpcurl-based client.
 */
export const grpcClient = {
	"cosmwasm.wasm.v1.Query": {
		Codes: promisifyMethod(wasmClient, 'Codes'),
		ContractsByCode: promisifyMethod(wasmClient, 'ContractsByCode'),
		ContractInfo: promisifyMethod(wasmClient, 'ContractInfo'),
		ContractHistory: promisifyMethod(wasmClient, 'ContractHistory'),
		SmartContractState: promisifyMethod(wasmClient, 'SmartContractState'),
	},
	"cosmos.base.tendermint.v1beta1.Service": {
		GetLatestBlock: promisifyMethod(tendermintClient, 'GetLatestBlock'),
	},
};

/**
 * Checks whether a pagination key indicates more pages.
 * Handles both base64 strings and Buffer/Uint8Array.
 * @param {string|Buffer|Uint8Array|null|undefined} key - Pagination next_key
 * @returns {boolean} True if there are more pages
 */
export function hasNextKey(key) {
	if (!key) return false;
	if (typeof key === 'string') return key.length > 0;
	if (key instanceof Uint8Array || Buffer.isBuffer(key)) return key.length > 0;
	return false;
}

/**
 * Closes all gRPC connections.
 */
export function closeConnections() {
	wasmClient.close();
	tendermintClient.close();
}
