options {
    keys: {
        area: commerce
        subarea: webhooks
    }
    services: {
        WebhookService: "#modules/webhook/webhook.service.js"
    }
}

contract WebhookHeaders: {
    stripe-signature: string
    content-type: string
}

# Inbound events are validated by HMAC, not by a bearer token, so the body stays
# `unknown` until the signature middleware has run.
operation /webhooks/payments: {
    post: { # receive a payment provider event
        name: Payment provider webhook
        sdk: receivePaymentEvent
        service: WebhookService.handlePaymentEvent
        signature: PAYMENTS_WEBHOOK
        security: none
        headers: WebhookHeaders
        request: {
            application/json: unknown
        }
        response: {
            204: {}
            400:
        }
    }
}

operation /webhooks/shipping: {
    post: { # receive a carrier tracking update
        sdk: receiveShippingEvent
        service: WebhookService.handleShippingEvent
        signature: {
            options: SHIPPING_WEBHOOK
            policy: shippingSignatureValid
        }
        security: none
        request: {
            application/json: unknown
        }
        response: {
            204: {}
            400:
        }
    }
}
