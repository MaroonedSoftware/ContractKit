options {
    keys: {
        area: billing
    }
    services: {
        PaymentService: "#src/services/payment.service.js"
    }
}

# A customer payment
contract Payment: {
    id: readonly uuid
    amount: number(min=0)
    unitPrice: decimal(scale=2)
    quantity: bigint
    createdAt: datetime
    processingTime?: duration
    status: enum(pending, completed, failed) = pending
}

# A stored credential — has a writeonly child, so its Base schema is read
contract Credential: {
    id: readonly uuid
    secret: writeonly string
}

# Extends a writeonly base and is itself writeonly
contract AdminCredential: Credential & {
    scope: string
    token: writeonly string
}

# A writeonly model nothing extends — its Base schema has no reader
contract Session: {
    id: string
    refreshToken: writeonly string
}

# Path params declared as a model, referenced via `params: PaymentRef`
contract PaymentRef: {
    paymentId: uuid
}

contract UpdatePaymentForm: {
    note?: string
}

contract UploadReceiptForm: {
    caption?: string
    file?: binary
}

# Query params declared as a model, referenced via `query: PaymentFilter`
contract PaymentFilter: {
    status?: enum(pending, completed, failed)
    since?: datetime
    ids?: array(uuid)
}

# Request headers declared as a model. Header names are case-insensitive, so any casing of `xCorrelationId` matches.
contract TenantHeaders: {
    x-tenant: string
    xCorrelationId?: string
}

# ─── Payment endpoints ────────────────────────────────────────────────────────

operation /payments: {
    post: { # create a payment
        sdk: createPayment
        service: PaymentService.create
        request: {
            application/json: Payment
        }
        response: {
            200: {
                application/json: Payment
                headers: {
                    x-request-id: string
                    x-ratelimit-remaining: int
                    x-cache-hit?: boolean
                    x-expires-after?: datetime
                }
            }
            400:
        }
    }

    get: { # list payments
        sdk: listPayments
        service: PaymentService.list
        query: {
            limit?: int = 20
            cursor: string
            status?: enum(pending, completed, failed)
        }
        headers: {
            api-key?: string
            x-tenant: string
        }
        response: {
            200: { application/json: array(Payment) }
        }
    }
}

operation /payments/search: {
    get: { # search payments with a filter model
        sdk: searchPayments
        service: PaymentService.search
        query: PaymentFilter
        headers: TenantHeaders
        response: {
            200: { application/json: array(Payment) }
        }
    }
}

operation /payments/batch: {
    post: { # create several payments at once
        sdk: createPayments
        service: PaymentService.createBatch
        request: {
            application/json: array(Payment)
        }
        response: {
            200: { application/json: array(Payment) }
        }
    }
}

operation /payments/{paymentId}: {
    params: {
        paymentId: uuid
    }

    get: { # fetch one payment
        sdk: getPayment
        service: PaymentService.getById
        response: {
            200: { application/json: Payment }
            404:
        }
    }

    post: { # update a payment with form data
        sdk: updatePaymentWithForm
        service: PaymentService.updateWithForm
        request: {
            application/x-www-form-urlencoded: UpdatePaymentForm
        }
        response: {
            204:
        }
    }

    delete: { # delete a payment — declares only a documented error status
        sdk: deletePayment
        service: PaymentService.delete
        response: {
            400:
        }
    }
}

operation /payments/{paymentId}/receipt: {
    params: {
        paymentId: uuid
    }

    post: { # upload a receipt image
        sdk: uploadReceipt
        service: PaymentService.uploadReceipt
        request: {
            multipart/form-data: UploadReceiptForm
        }
        response: {
            200: { application/json: Payment }
        }
    }
}

operation /refunds/{paymentId}: {
    params: PaymentRef

    get(deprecated): { # look up a refund by its originating payment
        sdk: getRefund
        service: PaymentService.getRefund
        mcp: true
        response: {
            200: { application/json: Payment }
            404:
        }
    }
}

# ─── Credential endpoints ─────────────────────────────────────────────────────

operation /credentials: {
    post: { # store a credential
        sdk: createCredential
        service: PaymentService.createCredential
        request: {
            application/json: AdminCredential
        }
        response: {
            200: { application/json: Credential }
        }
    }
}

operation /sessions: {
    post: { # open a session
        sdk: createSession
        service: PaymentService.createSession
        request: {
            application/json: Session
        }
        response: {
            200: { application/json: Session }
        }
    }
}

# ─── format() query and header models ─────────────────────────────────────────

# Query params and headers declared as format() models. Each schema is a pipe with no `.strict()` of
# its own, so the router applies the block's object mode to the object inside it.
contract format(input=snake) SnakeFilter: {
    fromDate?: date
}

contract format(input=snake) SnakeHeaders: {
    tenantId?: string
}

operation /payments/by-date: {
    get: { # search payments with snake_case filter and header models
        sdk: searchPaymentsByDate
        service: PaymentService.searchByDate
        query: SnakeFilter
        mode(loose) headers: SnakeHeaders
        response: {
            204:
        }
    }
}

# ─── format() models inside intersections ─────────────────────────────────────

# A format() member of an intersection has no `.extend()` or `.shape`, being a pipe. The router and the
# schemas build the object from the member's own object (`SnakeFilter.in`) and end in one transform
# that renames the member's keys through its `.out`, passing every other key through.
contract PaymentScope: {
    region: string
}

# An alias of such an intersection, which is a pipe itself
contract ScopedFilter: SnakeFilter & PaymentScope

# A field typed as one
contract SavedSearch: {
    label: string
    filter: SnakeFilter & { q: string }
}

operation /payments/by-date/scoped: {
    get: { # search payments with a snake_case filter extended inline
        sdk: searchPaymentsScoped
        service: PaymentService.searchScoped
        query: SnakeFilter & { q: string }
        headers: SnakeHeaders & { xTrace?: string }
        response: {
            200: { application/json: SnakeFilter & { q: string } }
        }
    }
    post: { # save a scoped search
        sdk: saveScopedSearch
        service: PaymentService.saveScopedSearch
        query: ScopedFilter
        request: {
            application/json: PaymentScope & SnakeFilter
        }
        response: {
            200: { application/json: SavedSearch }
        }
    }
}
