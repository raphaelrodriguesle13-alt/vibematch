/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Testes de banco tocam estado compartilhado (papéis, cadeia de hash):
  // execução serial é obrigatória para resultados determinísticos.
  maxWorkers: 1,
  testTimeout: 30000,
};
