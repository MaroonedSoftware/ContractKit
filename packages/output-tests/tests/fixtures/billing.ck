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
