options {
    keys: {
        area: counterparty
    }
    services: {
        CounterpartyService: "#src/modules/counterparty/counterparty.service.js"    
    }
}

contract ModernTreasuryWebhookHeaders: {
    x-topic: string
    x-event-id: uuid
    x-event-time: datetime
    x-webhook-id: uuid
    x-delivery-id: uuid
    x-organization-id: uuid
}

contract format(input=camel) mode(loose) ModernTreasuryWebhookTransaction: {
    event: enum(created, reconciled, updated)
    data: mode(loose) {
        id: uuid
        object: string
        amount: number
        posted: boolean
        direction: enum(credit, debit)
        type: string
        asOfDate: date
        asOfTime?: time
        createdAt: datetime
        details?: object
        internalAccountId?: uuid
        metadata: object
        customIdentifiers?: object
        reconciled: boolean
        updatedAt: datetime
        vendorCode?: string
        vendorCodeType?: string
        vendorCustomerId?: string
        vendorDescription?: string
        vendorId?: string
    }
}


operation(internal) /webhooks/moderntreasury: {
    post: { # handle a modern treasury webhook
        service: WebhooksService.handleModernTreasury
        signature: MODERN_TREASURY_WEBHOOK
        security: none
        headers: ModernTreasuryWebhookHeaders
        request: {
            application/json: unknown
        }
        response: {
            204:
        }
    }
}
