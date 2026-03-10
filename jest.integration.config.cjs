/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 120000,
  testMatch: ["**/*.integration.e2e-spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
};
