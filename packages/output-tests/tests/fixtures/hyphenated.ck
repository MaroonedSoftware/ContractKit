options {
    services: {
        InvoiceService: "#src/services/invoice.service.js"
    }
}

# Isolated on purpose. A hyphenated path param is the case Python must snake_case
# (`invoice-id` → `invoice_id`), and it is also the case the TypeScript generators turn into an
# invalid identifier. Keeping it in its own file confines that parse failure to one emitted file
# per generator, so the other fixtures' diagnostics stay readable.

contract Invoice: {
    id: readonly uuid
    total: decimal(scale=2)
}

operation /invoices/{invoice-id}: {
    params: {
        invoice-id: uuid
    }

    get: { # fetch an invoice
        sdk: getInvoice
        service: InvoiceService.getById
        response: {
            200: { application/json: Invoice }
            404:
        }
    }
}
