# @contractkit/core

## 0.7.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

## 0.6.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

## 0.5.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

## 0.4.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org
