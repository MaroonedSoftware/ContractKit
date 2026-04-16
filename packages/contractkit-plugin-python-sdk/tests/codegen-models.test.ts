import { describe, it, expect } from 'vitest';
import { generatePydanticModels, renderPyType, toPythonFieldName, deriveModelsModuleName } from '../src/codegen-models.js';
import {
    scalarType, arrayType, tupleType, recordType, enumType, literalType,
    unionType, refType, inlineObjectType, lazyType,
    field, model, contractRoot,
} from './helpers.js';

// ─── renderPyType ─────────────────────────────────────────────────────────

describe('renderPyType', () => {
    it('renders scalar types', () => {
        expect(renderPyType(scalarType('string'))).toBe('str');
        expect(renderPyType(scalarType('number'))).toBe('float');
        expect(renderPyType(scalarType('int'))).toBe('int');
        expect(renderPyType(scalarType('bigint'))).toBe('int');
        expect(renderPyType(scalarType('boolean'))).toBe('bool');
        expect(renderPyType(scalarType('date'))).toBe('date');
        expect(renderPyType(scalarType('time'))).toBe('time');
        expect(renderPyType(scalarType('datetime'))).toBe('datetime');
        expect(renderPyType(scalarType('duration'))).toBe('timedelta');
        expect(renderPyType(scalarType('uuid'))).toBe('UUID');
        expect(renderPyType(scalarType('email'))).toBe('str');
        expect(renderPyType(scalarType('url'))).toBe('str');
        expect(renderPyType(scalarType('null'))).toBe('None');
        expect(renderPyType(scalarType('binary'))).toBe('bytes');
        expect(renderPyType(scalarType('unknown'))).toBe('Any');
        expect(renderPyType(scalarType('json'))).toBe('Any');
        expect(renderPyType(scalarType('object'))).toBe('Any');
    });

    it('renders enum', () => {
        expect(renderPyType(enumType('pending', 'completed', 'failed')))
            .toBe('Literal["pending", "completed", "failed"]');
    });

    it('renders literal', () => {
        expect(renderPyType(literalType('hello'))).toBe('"hello"');
        expect(renderPyType(literalType(42))).toBe('42');
        expect(renderPyType(literalType(true))).toBe('true');
    });

    it('renders array', () => {
        expect(renderPyType(arrayType(scalarType('string')))).toBe('list[str]');
        expect(renderPyType(arrayType(refType('Payment')))).toBe('list[Payment]');
    });

    it('renders tuple', () => {
        expect(renderPyType(tupleType(scalarType('string'), scalarType('int')))).toBe('tuple[str, int]');
        expect(renderPyType({ kind: 'tuple', items: [] })).toBe('tuple[()]');
    });

    it('renders record', () => {
        expect(renderPyType(recordType(scalarType('string'), scalarType('number')))).toBe('dict[str, float]');
    });

    it('renders union', () => {
        expect(renderPyType(unionType(scalarType('string'), scalarType('int')))).toBe('str | int');
    });

    it('renders model ref', () => {
        expect(renderPyType(refType('Payment'))).toBe('Payment');
    });

    it('renders model ref as Input variant when forInput=true and in modelsWithInput', () => {
        const modelsWithInput = new Set(['Payment']);
        expect(renderPyType(refType('Payment'), modelsWithInput, true)).toBe('PaymentInput');
        expect(renderPyType(refType('Payment'), modelsWithInput, false)).toBe('Payment');
    });

    it('renders inline object as dict', () => {
        expect(renderPyType(inlineObjectType([]))).toBe('dict[str, Any]');
    });

    it('renders lazy unwrapped', () => {
        expect(renderPyType(lazyType(scalarType('string')))).toBe('str');
    });

    it('renders intersection as dict', () => {
        expect(renderPyType({ kind: 'intersection', members: [refType('A'), refType('B')] })).toBe('dict[str, Any]');
    });
});

// ─── toPythonFieldName ────────────────────────────────────────────────────

describe('toPythonFieldName', () => {
    it('leaves valid snake_case unchanged', () => {
        expect(toPythonFieldName('name')).toBe('name');
        expect(toPythonFieldName('first_name')).toBe('first_name');
    });

    it('converts camelCase to snake_case', () => {
        expect(toPythonFieldName('createdAt')).toBe('created_at');
        expect(toPythonFieldName('firstName')).toBe('first_name');
        expect(toPythonFieldName('myHTTPClient')).toBe('my_httpclient');
    });

    it('replaces hyphens with underscores', () => {
        expect(toPythonFieldName('x-event-id')).toBe('x_event_id');
        expect(toPythonFieldName('x-topic')).toBe('x_topic');
    });

    it('handles mixed separators', () => {
        expect(toPythonFieldName('my.field-name')).toBe('my_field_name');
    });
});

// ─── deriveModelsModuleName ───────────────────────────────────────────────

describe('deriveModelsModuleName', () => {
    it('converts file paths to Python module names', () => {
        expect(deriveModelsModuleName('payment.ck')).toBe('_models_payment');
        expect(deriveModelsModuleName('ledger.categories.ck')).toBe('_models_ledger_categories');
        expect(deriveModelsModuleName('/path/to/user.profile.ck')).toBe('_models_user_profile');
    });
});

// ─── generatePydanticModels ───────────────────────────────────────────────

describe('generatePydanticModels', () => {
    it('generates a simple model', () => {
        const root = contractRoot([
            model('Payment', [
                field('id', scalarType('uuid')),
                field('amount', scalarType('number')),
                field('status', enumType('pending', 'completed', 'failed')),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class Payment(BaseModel):');
        expect(output).toContain('id: UUID');
        expect(output).toContain('amount: float');
        expect(output).toContain('status: Literal["pending", "completed", "failed"]');
        expect(output).toContain('from pydantic import BaseModel');
        expect(output).toContain('from uuid import UUID');
        expect(output).toContain('from typing import Literal');
    });

    it('generates optional fields', () => {
        const root = contractRoot([
            model('User', [
                field('id', scalarType('uuid')),
                field('bio', scalarType('string'), { optional: true }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('bio: str | None = None');
    });

    it('generates fields with defaults', () => {
        const root = contractRoot([
            model('Config', [
                field('status', enumType('active', 'inactive'), { default: 'active' }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('default="active"');
    });

    it('generates nullable fields', () => {
        const root = contractRoot([
            model('Item', [
                field('description', scalarType('string'), { nullable: true }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('description: str | None');
    });

    it('generates Field(alias=...) for fields with hyphens', () => {
        const root = contractRoot([
            model('WebhookHeaders', [
                field('x-topic', scalarType('string')),
                field('x-event-id', scalarType('uuid')),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('x_topic: str = Field(alias="x-topic")');
        expect(output).toContain('x_event_id: UUID = Field(alias="x-event-id")');
        expect(output).toContain('model_config = ConfigDict(populate_by_name=True)');
        expect(output).toContain('from pydantic import BaseModel, ConfigDict, Field');
    });

    it('generates Input/Read split for readonly fields', () => {
        const root = contractRoot([
            model('Payment', [
                field('id', scalarType('uuid'), { visibility: 'readonly' }),
                field('amount', scalarType('number')),
                field('createdAt', scalarType('datetime'), { visibility: 'readonly' }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        // Read model has id and createdAt
        expect(output).toContain('class Payment(BaseModel):');
        expect(output).toContain('class PaymentInput(BaseModel):');
        // Input omits readonly fields
        const inputStart = output.indexOf('class PaymentInput');
        const inputSection = output.slice(inputStart);
        expect(inputSection).not.toContain('id: UUID');
        expect(inputSection).not.toContain('created_at: datetime');
        expect(inputSection).toContain('amount: float');
    });

    it('generates Input/Read split for writeonly fields', () => {
        const root = contractRoot([
            model('UserCreate', [
                field('username', scalarType('string')),
                field('password', scalarType('string'), { visibility: 'writeonly' }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class UserCreate(BaseModel):');
        expect(output).toContain('class UserCreateInput(BaseModel):');
        // Read model omits writeonly
        const readStart = output.indexOf('class UserCreate(BaseModel):');
        const readEnd = output.indexOf('class UserCreateInput');
        const readSection = output.slice(readStart, readEnd);
        expect(readSection).not.toContain('password: str');
        expect(readSection).toContain('username: str');
    });

    it('generates a type alias', () => {
        const root = contractRoot([
            model('UserId', [], { type: scalarType('uuid') }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('UserId = UUID');
    });

    it('generates datetime imports when needed', () => {
        const root = contractRoot([
            model('Event', [
                field('createdAt', scalarType('datetime')),
                field('date', scalarType('date')),
                field('time', scalarType('time')),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('from datetime import date, datetime, time');
    });

    it('generates timedelta import for duration fields', () => {
        const root = contractRoot([model('Task', [field('timeout', scalarType('duration'))])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('from datetime import timedelta');
        expect(output).toContain('timeout: timedelta');
    });

    it('includes deprecation comment', () => {
        const root = contractRoot([
            model('OldModel', [field('id', scalarType('uuid'))], { deprecated: true }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# @deprecated');
    });

    it('includes description comment', () => {
        const root = contractRoot([
            model('Payment', [field('id', scalarType('uuid'))], { description: 'A payment record' }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# A payment record');
    });

    it('handles model extending another model', () => {
        const root = contractRoot([
            model('BaseEntity', [field('id', scalarType('uuid'))]),
            model('Payment', [field('amount', scalarType('number'))], { base: 'BaseEntity' }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class Payment(BaseEntity):');
    });

    it('generates array and record types', () => {
        const root = contractRoot([
            model('Container', [
                field('items', arrayType(refType('Payment'))),
                field('meta', recordType(scalarType('string'), scalarType('string'))),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('items: list[Payment]');
        expect(output).toContain('meta: dict[str, str]');
    });
});
