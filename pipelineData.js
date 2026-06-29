const HISTORY_OPERATION_NAMES = {
	1: 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_INIT',
	2: 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_MIGRATE',
	3: 'CONTRACT_CODE_HISTORY_OPERATION_TYPE_GENESIS'
};

const KNOWN_CONTRACT_TYPES = ['cw721', 'cw20', 'cw404', 'cw1155'];

/**
 * Extracts a known CosmWasm contract family from a wasm query parse error.
 * @param {string|null|undefined} message - gRPC error details.
 * @returns {string|null}
 */
export function inferContractTypeFromError(message) {
	if (!message) return null;

	const match = String(message).match(/Error parsing into type (.+?):/);
	if (!match) return null;

	const extractedType = match[1].toLowerCase();
	return KNOWN_CONTRACT_TYPES.find(type => extractedType.includes(type)) || null;
}

/**
 * Maps a gRPC contract history operation value to the operation_types table name.
 * @param {number|string} operation - gRPC enum number or already-expanded name.
 * @returns {string|null}
 */
export function getOperationTypeName(operation) {
	if (operation === null || operation === undefined || operation === '') return null;
	if (typeof operation === 'string' && operation.startsWith('CONTRACT_CODE_HISTORY_OPERATION_TYPE_')) {
		return operation;
	}
	return HISTORY_OPERATION_NAMES[Number(operation)] || null;
}

/**
 * Decodes the base64 msg field produced by protobufjs bytes:String conversion.
 * @param {string|Object|null|undefined} msg - Contract history msg field.
 * @returns {string|null}
 */
export function decodeHistoryMessage(msg) {
	if (!msg) return null;
	if (typeof msg === 'object') return JSON.stringify(msg);

	try {
		const decoded = Buffer.from(msg, 'base64').toString('utf8');
		JSON.parse(decoded);
		return decoded;
	} catch {
		return String(msg);
	}
}

/**
 * Converts a gRPC ContractHistory entry into the contract_history schema row.
 * @param {Object} params
 * @param {string} params.contractAddress
 * @param {Object} params.entry
 * @param {Function} params.resolveOperationId
 * @returns {Array|null}
 */
export function historyEntryToRow({ contractAddress, entry, resolveOperationId }) {
	const operationName = getOperationTypeName(entry?.operation);
	const operationId = operationName ? resolveOperationId(operationName) : null;
	if (!operationId) return null;

	return [
		contractAddress,
		operationId,
		entry.code_id,
		entry.updated?.block_height || null,
		decodeHistoryMessage(entry.msg)
	];
}

/**
 * Converts an all_nft_info response into token and owner rows.
 * @param {Object} params
 * @param {string} params.contractAddress
 * @param {string} params.tokenId
 * @param {number} params.tokenTypeId
 * @param {Object} params.nftInfoResponse
 * @returns {{tokenRow: Array, ownerRow: Array|null}|null}
 */
export function buildNftInfoRows({ contractAddress, tokenId, tokenTypeId, nftInfoResponse }) {
	const data = nftInfoResponse?.data?.data;
	if (!data) return null;

	const normalizedTokenId = String(tokenId);
	const owner = data.access?.owner || null;
	const tokenUri = data.info?.token_uri || null;
	const extension = data.info?.extension ?? null;
	const metadata = extension ? JSON.stringify(extension) : null;

	return {
		tokenRow: [contractAddress, normalizedTokenId, tokenTypeId, tokenUri, metadata],
		ownerRow: owner ? [contractAddress, normalizedTokenId, owner, tokenTypeId] : null
	};
}
