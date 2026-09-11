# API Reference

## Table of Contents

**Endpoints**

- [Fetch an invoice](#fetch-an-invoice)
- [Fetch one seat](#fetch-one-seat)
- [Fetch a row by its seat class](#fetch-a-row-by-its-seat-class)
- [Current service status](#current-service-status)

<details>
<summary><strong>Billing</strong> (9)</summary>

- [Create a payment](#create-a-payment)
- [List payments](#list-payments)
- [Fetch one payment](#fetch-one-payment)
- [Update a payment with form data](#update-a-payment-with-form-data)
- [Delete a payment — declares only a documented error status](#delete-a-payment-declares-only-a-documented-error-status)
- [Upload a receipt image](#upload-a-receipt-image)
- [Look up a refund by its originating payment](#look-up-a-refund-by-its-originating-payment)
- [Store a credential](#store-a-credential)
- [Open a session](#open-a-session)

</details>

<details>
<summary><strong>Kitchen</strong> (6)</summary>

- [Several statuses, and two content types on one of them](#several-statuses-and-two-content-types-on-one-of-them)
- [A method name that is a keyword in the target languages](#a-method-name-that-is-a-keyword-in-the-target-languages)
- [Post ledger](#post-ledger)
- [Stamp](#stamp)
- [Mint](#mint)
- [List tokens](#list-tokens)

</details>

**Models**

- [Invoice](#invoice)
- [Seat](#seat)
- [SeatRef](#seatref)
- [Heartbeat](#heartbeat)

<details>
<summary><strong>Billing</strong> (7)</summary>

- [Payment](#payment)
- [Credential](#credential)
- [AdminCredential](#admincredential)
- [Session](#session)
- [PaymentRef](#paymentref)
- [UpdatePaymentForm](#updatepaymentform)
- [UploadReceiptForm](#uploadreceiptform)

</details>

<details>
<summary><strong>Kitchen</strong> (13)</summary>

- [Rating](#rating)
- [Folder](#folder)
- [Doc](#doc)
- [Card](#card)
- [Bank](#bank)
- [Instrument](#instrument)
- [Token](#token)
- [Owned](#owned)
- [Named](#named)
- [Shared](#shared)
- [Stamp](#stamp)
- [Stamped](#stamped)
- [Ledger](#ledger)

</details>

---

## Endpoints

### Fetch an invoice

**`GET`** `/invoices/{invoice-id}`

> [!NOTE]
> SDK method: `getInvoice`

#### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `invoice-id` | `string` | Yes | Path parameter. |

</details>

#### Response

`200 OK` — Returns a [Invoice](#invoice) object.

`404 Not Found`


---

### Fetch one seat

**`GET`** `/seats/{seatId}`

> [!NOTE]
> SDK method: `getSeat`

#### Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `seatId` | `string` | Yes | Path parameter. |
| `from` | `string` | No |  |
| `pageSize` | `number` | No |  |

</details>

#### Response

`200 OK` — Returns a [Seat](#seat) object.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `from` | `string` |  |


---

### Fetch a row by its seat class

**`GET`** `/rows/{class}`

> [!NOTE]
> SDK method: `getRow`

#### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `class` | `string` | Yes | Path parameter. |

</details>

#### Response

`200 OK` — Returns a [Seat](#seat) object.


---

### Current service status

**`GET`** `/status`

> [!NOTE]
> SDK method: `getStatus`

#### Response

`200 OK` — Returns a [Heartbeat](#heartbeat) object.


### Billing

#### Create a payment

**`POST`** `/payments`

> [!NOTE]
> SDK method: `createPayment`

##### Request body (`application/json`)

Accepts a [Payment](#payment) object.

##### Response

`200 OK` — Returns a [Payment](#payment) object.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `x-request-id` | `string` *(required)* |  |
| `x-ratelimit-remaining` | `number` *(required)* |  |
| `x-cache-hit` | `boolean` |  |
| `x-expires-after` | `string` |  |

`400 Bad Request`


---

#### List payments

**`GET`** `/payments`

> [!NOTE]
> SDK method: `listPayments`

##### Attributes

<details>
<summary>Attributes (4)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `cursor` | `string` | Yes |  |
| `x-tenant` | `string` | Yes |  |
| `api-key` | `string` | No |  |
| `limit` | `number` | No |  |

</details>

##### Response

`200 OK` — Returns a list of [Payment](#payment) objects.


---

#### Fetch one payment

**`GET`** `/payments/{paymentId}`

> [!NOTE]
> SDK method: `getPayment`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

##### Response

`200 OK` — Returns a [Payment](#payment) object.

`404 Not Found`


---

#### Update a payment with form data

**`POST`** `/payments/{paymentId}`

> [!NOTE]
> SDK method: `updatePaymentWithForm`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

##### Request body (`application/x-www-form-urlencoded`)

Accepts a [UpdatePaymentForm](#updatepaymentform) object.

##### Response

`204 No Content`


---

#### Delete a payment — declares only a documented error status

**`DELETE`** `/payments/{paymentId}`

> [!NOTE]
> SDK method: `deletePayment`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

##### Response

`400 Bad Request`


---

#### Upload a receipt image

**`POST`** `/payments/{paymentId}/receipt`

> [!NOTE]
> SDK method: `uploadReceipt`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

##### Request body (`multipart/form-data`)

Accepts a [UploadReceiptForm](#uploadreceiptform) object.

##### Response

`200 OK` — Returns a [Payment](#payment) object.


---

#### Look up a refund by its originating payment

> [!WARNING]
> **Deprecated** — this endpoint is deprecated and may be removed in a future version.

**`GET`** `/refunds/{paymentId}`

> [!NOTE]
> SDK method: `getRefund`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

##### Response

`200 OK` — Returns a [Payment](#payment) object.

`404 Not Found`


---

#### Store a credential

**`POST`** `/credentials`

> [!NOTE]
> SDK method: `createCredential`

##### Request body (`application/json`)

Accepts a [AdminCredential](#admincredential) object.

##### Response

`200 OK` — Returns a [Credential](#credential) object.


---

#### Open a session

**`POST`** `/sessions`

> [!NOTE]
> SDK method: `createSession`

##### Request body (`application/json`)

Accepts a [Session](#session) object.

##### Response

`200 OK` — Returns a [Session](#session) object.


### Kitchen

#### Several statuses, and two content types on one of them

**`GET`** `/folders/{folder-id}`

> [!NOTE]
> SDK method: `getFolder`

##### Attributes

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |
| `x-trace` | `string` | Yes |  |
| `depth` | `number` | No |  |
| `tags` | `string[]` | No |  |
| `x-opt` | `number` | No |  |

</details>

##### Response

`200 OK` `application/json` — Returns a [Folder](#folder) object.

`200` `text/plain` — Returns `string`.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `x-count` | `number` *(required)* |  |
| `x-when` | `string` |  |

`204 No Content`

`404 Not Found` — Returns a [Shared](#shared) object.


---

#### A method name that is a keyword in the target languages

**`PUT`** `/folders/{folder-id}`

> [!NOTE]
> SDK method: `import`

##### Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |

</details>

##### Request body (`application/json`)

Accepts a [Shared](#shared) object.

##### Response

`200 OK` — Returns a [Instrument](#instrument) object.


---

#### Post ledger

**`POST`** `/ledgers`

> [!NOTE]
> SDK method: `postLedger`

##### Request body (`application/json`)

Accepts a [Ledger](#ledger) object.

##### Response

`201 Created` — Returns a [Ledger](#ledger) object.


---

#### Stamp

**`POST`** `/stamps`

> [!NOTE]
> SDK method: `stamp`

##### Request body (`application/json`)

Accepts a [Stamped](#stamped) object.

##### Response

`201 Created` — Returns a [Stamped](#stamped) object.


---

#### Mint

**`POST`** `/tokens`

> [!NOTE]
> SDK method: `mint`

##### Request body (`application/json`)

Accepts a [Token](#token) object.

##### Response

`201 Created` — Returns a [Token](#token) object.

`400 Bad Request`


---

#### List tokens

**`GET`** `/tokens`

> [!NOTE]
> SDK method: `listTokens`

##### Response

`200 OK` — Returns a list of [Token](#token) objects.


## Models

### Invoice

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `total` | `Decimal` | Yes |  |

</details>

### Seat

> A seat, whose field names are all reserved somewhere in Python

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `class` | `string` | Yes |  |
| `from` | `string` | No |  |
| `date` | `string` | Yes |  |
| `time` | `string` | No |  |
| `copy` | `string` | No |  |
| `modelDump` | `string` | No |  |
| `json` | `string` | No |  |

</details>

### SeatRef

> Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `class` | `string` | Yes |  |

</details>

### Heartbeat

> A service heartbeat — deliberately no bigint field and no `area` key

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `string` | Yes |  |
| `checkedAt` | `string` | Yes |  |

</details>

### Billing

#### Payment

> A customer payment

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `amount` | `number` | Yes |  |
| `unitPrice` | `Decimal` | Yes |  |
| `quantity` | `bigint` | Yes | *sent as a digit string, "123" or "123n"* |
| `createdAt` | `string` | Yes |  |
| `processingTime` | `string` | No |  |
| `status` | `'pending' \| 'completed' \| 'failed'` | Yes | *default: `pending`* |

</details>

#### Credential

> A stored credential — has a writeonly child, so its Base schema is read

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `secret` | `string` | Yes | *write-only* |

</details>

#### AdminCredential

> Extends a writeonly base and is itself writeonly

Extends [`Credential`](#credential)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `scope` | `string` | Yes |  |
| `token` | `string` | Yes | *write-only* |

</details>

#### Session

> A writeonly model nothing extends — its Base schema has no reader

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `refreshToken` | `string` | Yes | *write-only* |

</details>

#### PaymentRef

> Path params declared as a model, referenced via `params: PaymentRef`

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes |  |

</details>

#### UpdatePaymentForm

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `note` | `string` | No |  |

</details>

#### UploadReceiptForm

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `caption` | `string` | No |  |
| `file` | `Blob` | No |  |

</details>

### Kitchen

#### Rating

> A named enum, so a field default has to resolve to a member rather than its wire spelling

```typescript
type Rating = 'good' | 'neutral' | 'bad'
```

#### Folder

> Self recursion through lazy(), mutual recursion through Doc, every container, both union
> forms, every scalar, and field names that are keywords in the target languages

<details>
<summary>Attributes (22)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `class` | `string` | Yes |  |
| `default` | `string` | No |  |
| `rating` | `Rating` | No | *default: `neutral`* |
| `parent` | `Folder` | No |  |
| `readme` | `Doc` | No |  |
| `children` | `Folder[]` | Yes |  |
| `byName` | `Record<string, Folder>` | No |  |
| `span` | `[number, number]` | No |  |
| `stamped` | `[string, string, boolean]` | No |  |
| `label` | `string \| number` | Yes |  |
| `pinned` | `Doc \| Folder` | Yes | *nullable* |
| `instrument` | `Card \| Bank` | No |  |
| `origin` | `{ x: number; y: number }` | No |  |
| `size` | `bigint` | Yes | *sent as a digit string, "123" or "123n"* |
| `price` | `Decimal` | Yes |  |
| `day` | `string` | No |  |
| `at` | `string` | No |  |
| `ttl` | `string` | No |  |
| `blob` | `Blob` | No |  |
| `extra` | `unknown` | No |  |
| `raw` | `JsonValue` | No |  |

</details>

#### Doc

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `folder` | `Folder` | No |  |

</details>

#### Card

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `'card'` | Yes |  |
| `last4` | `string` | Yes |  |

</details>

#### Bank

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `'bank'` | Yes |  |
| `iban` | `string` | Yes |  |

</details>

#### Instrument

```typescript
type Instrument = Card | Bank
```

#### Token

> Decodes snake_case keys and encodes PascalCase ones

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `accessToken` | `string` | Yes |  |
| `expiresIn` | `number` | No | *default: `3600`* |

</details>

#### Owned

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `secret` | `string` | Yes | *write-only* |

</details>

#### Named

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |  |

</details>

#### Shared

> Two flattened bases, split into a read and an input shape

Extends [`Owned`](#owned), [`Named`](#named)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `string` | No | *default: `x`* |
| `instrument` | `Instrument` | No |  |

</details>

#### Stamp

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `stampedBy` | `string` | Yes |  |
| `stampedAt` | `string` | Yes |  |

</details>

#### Stamped

> A plain base under format(), which the schema inlines rather than extends

Extends [`Stamp`](#stamp)

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `stampNote` | `string` | No |  |

</details>

#### Ledger

> format() on a contract split for readonly and writeonly fields, applied to both of its schemas

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `entryCode` | `string` | Yes | *write-only* |
| `postedAt` | `string` | Yes |  |

</details>
