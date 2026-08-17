options {
    keys: {
        area: billing
        subarea: subscriptions
    }
    services: {
        SubscriptionService: "#modules/billing/subscription.service.js"
    }
    request: {
        headers: {
            authorization: string
        }
    }
    security: {
        policy: billingRead
    }
}

# A plan a customer can subscribe to.
contract Plan: {
    id: readonly uuid
    code: string(min=1, max=40, regex=/^[a-z0-9-]+$/)
    name: string(min=1, max=80)
    interval: enum(month, year) = month
    amountCents: int(min=0)
    currency: string(len=3) = usd
    trialDays?: int(min=0, max=90)
}

# A customer's subscription to a plan.
contract Subscription: {
    id: readonly uuid
    customerId: uuid
    plan: Plan
    status: enum(trialing, active, past_due, canceled) = trialing
    currentPeriodEnd: datetime
    cancelAtPeriodEnd: boolean = false
    createdAt: readonly datetime
}

contract CreateSubscription: {
    customerId: uuid
    planCode: string
    couponCode?: string(max=40) # applied before the first invoice is drawn
}

contract CancelSubscription: {
    atPeriodEnd: boolean = true # keep it alive until the paid period runs out
    reason?: enum(too_expensive, missing_features, switched_provider, other)
}

# The shape every 4xx and 5xx carries, so clients have one error type to handle.
contract Problem: {
    type: url
    title: string
    status: int
    detail?: string
}

contract Page: {
    total: int
    hasMore: boolean
}

contract SubscriptionPage: Page & {
    data: array(Subscription)
}

operation /subscriptions: {
    get: { # list subscriptions
        name: List subscriptions
        sdk: list
        service: SubscriptionService.list
        query: {
            customerId?: uuid
            status?: enum(trialing, active, past_due, canceled)
            limit?: int(min=1, max=100) = 20
            cursor?: string
        }
        response: {
            200: { application/json: SubscriptionPage }
            401: { application/json: Problem }
        }
    }

    post: { # start a subscription
        name: Create a subscription
        sdk: create
        service: SubscriptionService.create
        security: {
            policy: billingWrite
        }
        headers: {
            x-idempotency-key: string(min=8, max=255)
        }
        request: {
            application/json: CreateSubscription
        }
        response: {
            201: { application/json: Subscription }
            402: { application/json: Problem }
            409(documented): { application/json: Problem }
        }
    }
}

operation /subscriptions/{id}: {
    params: {
        id: uuid
    }

    get: { # fetch one subscription
        sdk: get
        service: SubscriptionService.getById
        response: {
            200: { application/json: Subscription }
            404: { application/json: Problem }
        }
    }

    delete: { # cancel a subscription
        name: Cancel a subscription
        sdk: cancel
        service: SubscriptionService.cancel
        security: {
            policy: billingWrite
        }
        request: {
            application/json: CancelSubscription
        }
        response: {
            200: { application/json: Subscription }
            404: { application/json: Problem }
        }
    }
}

operation /subscriptions/{id}/invoice.pdf: {
    params: {
        id: uuid
    }

    get: { # download the latest invoice
        sdk: downloadInvoice
        service: SubscriptionService.renderInvoice
        response: {
            200: {
                application/pdf: binary
                headers: {
                    content-disposition: string
                }
            }
            404: { application/json: Problem }
        }
    }
}
