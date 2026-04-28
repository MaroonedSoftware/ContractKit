# @contractkit/contractkit-plugin-typescript

## 0.12.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.11.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.10.0

### Minor Changes

- ddb6a28: Refactor type generation in codegen-contract to use z.input for developer-facing types when outputCase is set. Updated tests to reflect this change in type handling for improved clarity in serialization logic.

## 0.9.0

### Minor Changes

- 2c9e9a9: Fix type casting in URLSearchParams serialization for form data in codegen-sdk. Updated tests to reflect changes in body serialization logic.

## 0.8.0

### Minor Changes

- 1b336ec: Enhance contract generation by introducing a flattening mechanism for format chains. This allows child models to inline parent fields and inherit transformations, ensuring compatibility with ZodPipe structures. Updated the model generation logic and added tests to verify the new behavior for child models extending formatted parents.

## 0.7.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.6.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.5.0

### Minor Changes

- 506af42: Enhance input type reference collection in code generation by adding support for tuple, record, union, intersection, lazy, and inlineObject types. Added corresponding test case for intersection query handling.

## 0.4.0

### Minor Changes

- 3d90443: Update ZodInterval transformation to include ISO string conversion in contract generation and corresponding test case.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
