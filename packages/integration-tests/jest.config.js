module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testRegex: '.*\\.(integration-spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@solo-relayer/relay-api/(.*)$': '<rootDir>/../relay-api/$1',
  },
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/setup.ts'],
  testTimeout: 60000,
  verbose: true,
  coverageDirectory: './coverage',
  collectCoverageFrom: ['tests/**/*.ts'],
  // Prevent Jest worker serialization issues with Axios circular references
  maxWorkers: 1,
};
