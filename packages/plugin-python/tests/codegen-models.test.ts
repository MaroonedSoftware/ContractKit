import { describe, it, expect } from 'vitest';
import {
    generatePydanticModels,
    renderPyType,
    toPythonFieldName,
    deriveModelsModuleName,
    computeTypeAliases,
    SCALARS_PY,
} from '../src/codegen-models.js';
import {
    scalarType,
    arrayType,
    tupleType,
    recordType,
    enumType,
    literalType,
    unionType,
    refType,
    inlineObjectType,
    lazyType,
    field,
    model,
    contractRoot,
} from './helpers.js';

// ─── renderPyType ─────────────────────────────────────────────────────────

describe('renderPyType', () => {
    it('renders scalar types', () => {
        expect(renderPyType(scalarType('string'))).toBe('str');
        expect(renderPyType(scalarType('number'))).toBe('float');
        expect(renderPyType(scalarType('int'))).toBe('int');
        expect(renderPyType(scalarType('bigint'))).toBe('BigInt');
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
        expect(renderPyType(scalarType('interval'))).toBe('str');
        expect(renderPyType(scalarType('decimal'))).toBe('Decimal');
    });

    it('throws on an unmapped scalar name', () => {
        expect(() => renderPyType({ kind: 'scalar', name: 'quaternion' } as any)).toThrow(/unmapped scalar 'quaternion'/);
    });

    it('renders enum', () => {
        expect(renderPyType(enumType('pending', 'completed', 'failed'))).toBe('Literal["pending", "completed", "failed"]');
    });

    it('renders literal as Literal[...], with Python booleans', () => {
        expect(renderPyType(literalType('hello'))).toBe('Literal["hello"]');
        expect(renderPyType(literalType(42))).toBe('Literal[42]');
        expect(renderPyType(literalType(true))).toBe('Literal[True]');
        expect(renderPyType(literalType(false))).toBe('Literal[False]');
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

    it('appends an underscore to a Python keyword', () => {
        expect(toPythonFieldName('class')).toBe('class_');
        expect(toPythonFieldName('from')).toBe('from_');
        expect(toPythonFieldName('import')).toBe('import_');
        expect(toPythonFieldName('async')).toBe('async_');
        // Keywords only once snake_cased, so the check has to come after the conversion.
        expect(toPythonFieldName('Lambda')).toBe('lambda_');
    });

    it('leaves soft keywords and near-misses alone', () => {
        expect(toPythonFieldName('type')).toBe('type');
        expect(toPythonFieldName('match')).toBe('match');
        expect(toPythonFieldName('case')).toBe('case');
        expect(toPythonFieldName('classes')).toBe('classes');
        expect(toPythonFieldName('None')).toBe('none');
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
        const root = contractRoot([model('User', [field('id', scalarType('uuid')), field('bio', scalarType('string'), { optional: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('bio: str | None = None');
    });

    it('generates fields with defaults', () => {
        const root = contractRoot([model('Config', [field('status', enumType('active', 'inactive'), { default: 'active' })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('default="active"');
    });

    it('writes a bigint default as an exact int literal', () => {
        const root = contractRoot([model('Counter', [field('serial', scalarType('bigint'), { default: 9007199254740993n })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('default=9007199254740993');
        expect(output).not.toContain('default=9007199254740993n');
    });

    it('generates nullable fields', () => {
        const root = contractRoot([model('Item', [field('description', scalarType('string'), { nullable: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('description: str | None');
    });

    it('generates Field(alias=...) for fields with hyphens', () => {
        const root = contractRoot([model('WebhookHeaders', [field('x-topic', scalarType('string')), field('x-event-id', scalarType('uuid'))])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('x_topic: str = Field(alias="x-topic")');
        expect(output).toContain('x_event_id: UUID = Field(alias="x-event-id")');
        expect(output).toContain('model_config = ConfigDict(populate_by_name=True)');
        expect(output).toContain('from pydantic import BaseModel, ConfigDict, Field');
    });

    it('gives an optional aliased field default=None, since Field() with no default is required', () => {
        const root = contractRoot([model('Payment', [field('processingTime', scalarType('duration'), { optional: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('processing_time: timedelta | None = Field(alias="processingTime", default=None)');
    });

    it('escapes a keyword field and aliases it back to its contract name', () => {
        const root = contractRoot([model('Seat', [field('class', scalarType('string')), field('from', scalarType('date'), { optional: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('    class_: str = Field(alias="class")');
        expect(output).toContain('    from_: date | None = Field(alias="from", default=None)');
        // Without it, the model could only be built from the alias: `Seat(class_=...)` would fail.
        expect(output).toContain('model_config = ConfigDict(populate_by_name=True)');
    });

    it('escapes a field named after a BaseModel attribute', () => {
        const root = contractRoot([
            model('Doc', [
                field('modelDump', scalarType('string'), { optional: true }),
                field('modelConfig', scalarType('string')),
                field('json', scalarType('string'), { optional: true }),
                field('copy', scalarType('string')),
            ]),
        ]);
        const output = generatePydanticModels(root);
        // model_dump and model_config fail class creation; json and copy shadow the method.
        expect(output).toContain('    model_dump_: str | None = Field(alias="modelDump", default=None)');
        expect(output).toContain('    model_config_: str = Field(alias="modelConfig")');
        expect(output).toContain('    json_: str | None = Field(alias="json", default=None)');
        expect(output).toContain('    copy_: str = Field(alias="copy")');
    });

    it('turns off protected namespaces for a model_ field that collides with nothing', () => {
        const root = contractRoot([model('Car', [field('modelName', scalarType('string'))])]);
        const output = generatePydanticModels(root);
        // Before Pydantic 2.10 any `model_` field warned; the name itself is safe to keep.
        expect(output).toContain('model_config = ConfigDict(populate_by_name=True, protected_namespaces=())');
        expect(output).toContain('    model_name: str = Field(alias="modelName")');
    });

    it('escapes a field that would shadow a type its class annotates with', () => {
        const root = contractRoot([
            model('Event', [field('date', scalarType('date'), { optional: true }), field('str', scalarType('string'), { default: 'x' })]),
        ]);
        const output = generatePydanticModels(root);
        // `date: date | None = None` puts None where the annotation looks up `date`.
        expect(output).toContain('    date_: date | None = Field(alias="date", default=None)');
        expect(output).toContain('    str_: str | None = Field(alias="str", default="x")');
    });

    it('escapes a defaulted field whose name a sibling field annotates with', () => {
        const root = contractRoot([model('Event', [field('date', scalarType('string'), { optional: true }), field('when', scalarType('date'))])]);
        const output = generatePydanticModels(root);
        // Imports fine and then validates `when` against None: the quiet version of the bug.
        expect(output).toContain('    date_: str | None = Field(alias="date", default=None)');
        expect(output).toContain('    when: date');
    });

    it('keeps a type-named field that puts nothing in the class namespace', () => {
        const root = contractRoot([model('Event', [field('date', scalarType('date')), field('time', scalarType('time'), { nullable: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toMatch(/^ {4}date: date$/m);
        expect(output).toMatch(/^ {4}time: time \| None$/m);
        expect(output).not.toContain('ConfigDict');
    });

    it('keeps a type-named field whose class never annotates with that type', () => {
        const root = contractRoot([model('Note', [field('date', scalarType('string'), { optional: true })])]);
        expect(generatePydanticModels(root)).toContain('    date: str | None = None');
    });

    it('ignores enum values when looking for shadowed type names', () => {
        const root = contractRoot([
            model('Filter', [field('date', scalarType('string'), { optional: true }), field('kind', enumType('date', 'time'))]),
        ]);
        expect(generatePydanticModels(root)).toContain('    date: str | None = None');
    });

    it('names a field the same in a model and its Input variant', () => {
        const root = contractRoot([
            model('Booking', [
                field('date', scalarType('string'), { optional: true }),
                // Only the read model carries this annotation, but both classes must agree.
                field('when', scalarType('date'), { visibility: 'readonly' }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        const [read, input] = output.split('class BookingInput(BaseModel):');
        expect(read).toContain('    date_: str | None = Field(alias="date", default=None)');
        expect(input).toContain('    date_: str | None = Field(alias="date", default=None)');
    });

    it('types a discriminator field as a Literal, so its union can be built', () => {
        const root = contractRoot([
            model('Card', [field('kind', literalType('card')), field('last4', scalarType('string'))]),
            model('Bank', [field('kind', literalType('bank')), field('iban', scalarType('string'))]),
            model('Method', [], {
                type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] } as never,
            }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('    kind: Literal["card"]');
        expect(output).toContain('from typing import Annotated, Literal');
        expect(output).toContain('Method = Annotated[Card | Bank, Field(discriminator="kind")]');
    });

    it('keeps a required nullable aliased field required', () => {
        const root = contractRoot([model('Order', [field('billTo', scalarType('string'), { nullable: true })])]);
        const output = generatePydanticModels(root);
        expect(output).toMatch(/^ {4}bill_to: str \| None = Field\(alias="billTo"\)$/m);
    });

    it('uses the declared default rather than None for an optional aliased field', () => {
        const root = contractRoot([model('Order', [field('lineCount', scalarType('int'), { optional: true, default: 1 })])]);
        const output = generatePydanticModels(root);
        expect(output).toMatch(/^ {4}line_count: int \| None = Field\(alias="lineCount", default=1\)$/m);
    });

    it('aliases a keyword field to its wire name, so the class body parses', () => {
        const root = contractRoot([
            model('Folder', [field('class', scalarType('string')), field('default', scalarType('string'), { optional: true })]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class_: str = Field(alias="class")');
        expect(output).toContain('default: str | None = None');
        expect(output).toContain('model_config = ConfigDict(populate_by_name=True)');
        expect(output).not.toMatch(/^\s+class:/m);
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
            model('UserCreate', [field('username', scalarType('string')), field('password', scalarType('string'), { visibility: 'writeonly' })]),
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
        const root = contractRoot([model('UserId', [], { type: scalarType('uuid') })]);
        const output = generatePydanticModels(root);
        expect(output).toContain('UserId = UUID');
    });

    it('generates datetime imports when needed', () => {
        const root = contractRoot([
            model('Event', [field('createdAt', scalarType('datetime')), field('date', scalarType('date')), field('time', scalarType('time'))]),
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

    it('types a bigint field as the shared BigInt, imported after the stdlib', () => {
        const root = contractRoot([model('Order', [field('quantity', scalarType('bigint')), field('total', scalarType('decimal'))])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('    quantity: BigInt');
        // Relative imports come last, so the order does not depend on which field is scanned first.
        expect(output).toMatch(/from decimal import Decimal\nfrom \._scalars import BigInt/);
    });

    it('generates the Decimal import for decimal fields', () => {
        const root = contractRoot([model('Payslip', [field('gross', scalarType('decimal'))])]);
        const output = generatePydanticModels(root);
        expect(output).toContain('from decimal import Decimal');
        expect(output).toContain('gross: Decimal');
    });

    it('includes deprecation comment', () => {
        const root = contractRoot([model('OldModel', [field('id', scalarType('uuid'))], { deprecated: true })]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# @deprecated');
    });

    it('includes description comment', () => {
        const root = contractRoot([model('Payment', [field('id', scalarType('uuid'))], { description: 'A payment record' })]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# A payment record');
    });

    it('handles model extending another model', () => {
        const root = contractRoot([
            model('BaseEntity', [field('id', scalarType('uuid'))]),
            model('Payment', [field('amount', scalarType('number'))], { bases: ['BaseEntity'] }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class Payment(BaseEntity):');
    });

    it('emits a comma-separated parent list for multi-base inheritance', () => {
        const root = contractRoot([
            model('A', [field('a', scalarType('string'))]),
            model('B', [field('b', scalarType('int'))]),
            model('Test5', [field('e', scalarType('string'))], { bases: ['A', 'B'] }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('class Test5(A, B):');
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

// ─── Multi-line descriptions (regression) ─────────────────────────────────

describe('multi-line descriptions', () => {
    it('comments every line of a multi-line model description', () => {
        const root = contractRoot([
            model('Payment', [field('amount', scalarType('number'))], {
                description: 'A payment record.\nSecond line of docs.',
            }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# A payment record.');
        expect(output).toContain('# Second line of docs.');
        // No physical line of a description may be left uncommented (would be a SyntaxError).
        expect(output).not.toMatch(/^Second line of docs\.$/m);
    });

    it('comments every line of a multi-line field description with field indent', () => {
        const root = contractRoot([
            model('Payment', [
                field('amount', scalarType('number'), {
                    description: 'Amount in cents.\nMust be non-negative.',
                }),
            ]),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('    # Amount in cents.');
        expect(output).toContain('    # Must be non-negative.');
        expect(output).not.toMatch(/^\s*Must be non-negative\.$/m);
    });

    it('comments every line of a multi-line type-alias description', () => {
        const root = contractRoot([
            model('Status', [], {
                type: enumType('pending', 'done'),
                description: 'Lifecycle status.\nExtra detail line.',
            }),
        ]);
        const output = generatePydanticModels(root);
        expect(output).toContain('# Lifecycle status.');
        expect(output).toContain('# Extra detail line.');
        expect(output).not.toMatch(/^Extra detail line\.$/m);
    });
});

describe('computeTypeAliases', () => {
    it('lists the contracts emitted as something other than a Pydantic class', () => {
        const models = [
            model('Card', [field('last4', scalarType('string'))]),
            model('Tier', [], { type: enumType('free', 'pro') }),
            model('Ids', [], { type: arrayType(scalarType('string')) }),
            model('Method', [], { type: unionType(refType('Card'), refType('Bank')) }),
            // A rename of a class is the class itself: `Renamed = Card` has `model_validate`.
            model('Renamed', [], { type: refType('Card') }),
            model('Deferred', [], { type: lazyType(refType('Renamed')) }),
            model('OfAlias', [], { type: refType('Tier') }),
        ];
        expect([...computeTypeAliases(models)].sort()).toEqual(['Ids', 'Method', 'OfAlias', 'Tier']);
    });

    it('does not loop on aliases that refer to each other', () => {
        const models = [model('A', [], { type: refType('B') }), model('B', [], { type: refType('A') })];
        expect([...computeTypeAliases(models)].sort()).toEqual(['A', 'B']);
    });
});

describe('SCALARS_PY', () => {
    it('reads every form a bigint arrives in and writes a digit string in JSON mode only', () => {
        expect(SCALARS_PY).toContain('return int(text[:-1] if text.endswith("n") else text)');
        expect(SCALARS_PY).toContain(
            'BigInt = Annotated[int, BeforeValidator(_parse_bigint), PlainSerializer(str, return_type=str, when_used="json")]',
        );
    });
});
