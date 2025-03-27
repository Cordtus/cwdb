// jest.config.js
export default {
  transform: {},
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  testMatch: [
    "**/__tests__/**/*.test.js"
  ],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  clearMocks: true,
  resetMocks: false,
  verbose: true
};