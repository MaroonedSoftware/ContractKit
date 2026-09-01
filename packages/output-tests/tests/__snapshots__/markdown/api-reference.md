# API Reference

## Table of Contents

**Endpoints**

- [Fetch an invoice](#fetch-an-invoice)
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

**Models**

- [Invoice](#invoice)
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


## Models

### Invoice

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `total` | `Decimal` | Yes |  |

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
| `quantity` | `bigint` | Yes |  |
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
