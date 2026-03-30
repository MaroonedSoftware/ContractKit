options {
    keys: {
        area: ledger
    }
    services {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
}

operation /ledger/transactions: {
    post: {
        service: LedgerService.createTransaction
        request: {
            application/json: LedgerTransaction
        }
        response: {
            201: {
                application/json: LedgerTransaction
            }
        }
    }
    get: {
        service: LedgerService.listAllTransactions
        query: ListTransactionsQuery
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(LedgerTransaction)
                }
            }
        }
    }
}

operation /ledger/transactions/transfer: {
    post: {
        service: LedgerService.transfer
        request: {
            application/json: LedgerTransfer | LedgerTransferMultiple
        }
        response: {
            201: {
                application/json: LedgerTransaction
            }
        }
    }
}

operation /ledger/transactions/:transactionId: {
    params: {
        transactionId: uuid
    }
    get: {
        service: LedgerService.getTransaction
        response: {
            200: {
                application/json: LedgerTransaction
            }
        }
    }
}

operation /ledger/transactions/:transactionId/entries: {
    params: {
        transactionId: uuid
    }
    get: {
        service: LedgerService.getTransactionEntries
        response: {
            200: {
                application/json: array(LedgerEntry)
            }
        }
    }
}

operation /ledger/transactions/:transactionId/finalize: {
    params: {
        transactionId: uuid
    }
    post: {
        service: LedgerService.finalizeTransaction
        request: {
            application/json: FinalizeTransactionInput
        }
        response: {
            200: {
                application/json: LedgerTransaction
            }
        }
    }
}
