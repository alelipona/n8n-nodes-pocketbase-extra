module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  clearMocks: true,
  verbose: false,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
};
