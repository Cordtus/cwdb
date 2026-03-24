// config.js

export const config = {
	blockHeight: "",
	paginationLimit: 100,
	concurrencyLimit: 4,
	numWorkers: 4,
	grpcAddress: "localhost:9090",
	timeout: 5000,
	logLevel: 'INFO',
	logToFile: true,
	retryConfig: {
		retries: 2,
		delay: 750,
		backoffFactor: 2
	}
};
