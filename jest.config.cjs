module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '(apps|libs)/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'apps/**/*.ts',
    'libs/**/*.ts',
    '!apps/**/main.ts',
    '!libs/**/index.ts',
  ],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  coverageDirectory: 'coverage',
};
