options {
    keys: {
        area: commerce
        subarea: orders
    }
    services: {
        OrderService: "#modules/order/order.service.js"
    }
    request: {
        headers: {
            authorization: string
            x-request-id?: uuid
        }
    }
    response: {
        headers: {
            x-request-id: uuid
        }
    }
    security: {
        policy: ordersRead
    }
}

contract Address: {
    line1: string(min=1, max=120)
    line2?: string(max=120)
    city: string(min=1, max=80)
    region?: string(max=80)
    postalCode: string(min=2, max=16)
    country: string(len=2)
}

# Each payment method carries its own fields, and `kind` says which set to expect.
contract CardPayment: {
    kind: literal("card")
    brand: enum(visa, mastercard, amex)
    last4: string(len=4)
}

contract BankPayment: {
    kind: literal("bank")
    accountLast4: string(len=4)
    mandateId: uuid
}

contract GiftCardPayment: {
    kind: literal("gift_card")
    code: writeonly string(min=8, max=32)
    balance: Money
}

contract PaymentMethod: discriminated(by=kind, CardPayment | BankPayment | GiftCardPayment)

# `Product` and `Money` come from catalog.ck — references resolve across files.
contract LineItem: {
    productId: uuid
    variantSku: string
    quantity: int(min=1, max=999)
    unitPrice: Money
    subtotal: Money
}

contract Order: {
    id: readonly uuid
    number: readonly string(regex=/^[A-Z]{2}-[0-9]{6}$/)
    customerId: uuid
    status: enum(pending, paid, fulfilled, refunded, canceled) = pending
    items: array(LineItem, min=1)
    payment: PaymentMethod
    shipTo: Address
    total: Money
    placedAt: readonly datetime
    canceledAt?: datetime | null
}

# What a client sends: no prices, because the server is the one that knows them.
contract OrderItemInput: {
    productId: uuid
    variantSku: string
    quantity: int(min=1, max=999)
}

contract CreateOrder: {
    customerId: uuid
    items: array(OrderItemInput, min=1)
    payment: PaymentMethod
    shipTo: Address
}

contract OrderPage: {
    data: array(Order)
    nextCursor?: string
    total: int
}

operation /orders: {
    get: { # list a customer's orders
        name: List orders
        sdk: list
        service: OrderService.list
        query: {
            customerId?: uuid
            status?: array(enum(pending, paid, fulfilled, refunded, canceled))
            placedAfter?: date
            limit?: int(min=1, max=100) = 20
            cursor?: string
        }
        response: {
            200: { application/json: OrderPage }
            401: { application/json: Problem }
        }
    }

    post: { # place an order
        name: Place an order
        sdk: create
        service: OrderService.place
        security: {
            policy: ordersWrite
        }
        headers: {
            x-idempotency-key: string(min=8, max=255)
        }
        request: {
            application/json: CreateOrder
        }
        response: {
            201: { application/json: Order }
            402: { application/json: Problem }
            409: { application/json: Problem }
            422: { application/json: Problem }
        }
    }
}

operation /orders/{id}: {
    params: {
        id: uuid
    }

    get: { # fetch one order
        sdk: get
        service: OrderService.getById
        response: {
            200: { application/json: Order }
            404: { application/json: Problem }
        }
    }
}

operation /orders/{id}/refunds: {
    params: {
        id: uuid
    }

    post: { # refund an order, in full or in part
        name: Refund an order
        sdk: refund
        service: OrderService.refund
        security: {
            policy: ordersRefund
        }
        headers: {
            x-idempotency-key: string(min=8, max=255)
        }
        request: {
            application/json: {
                amount?: Money
                reason: enum(requested_by_customer, duplicate, fraudulent)
                note?: string(max=500)
            }
        }
        response: {
            202: { application/json: Order }
            404: { application/json: Problem }
            409: { application/json: Problem }
            # Declared so clients handle it, but this service never returns it —
            # the payments gateway does, and the gateway's errors are proxied as 409.
            502(documented): { application/json: Problem }
        }
    }
}
