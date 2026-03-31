options {
    keys: {
        area: ledger
    }
    services: {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
}

operation /ledger/settlements: {
    post: {
        service: LedgerService.createSettlement
        request: {
            application/json: LedgerSettlement
        }
        response: {
            201: {
                application/json: LedgerSettlement
            }
        }
    }
    get: {
        service: LedgerService.listSettlements
        query: ListSettlementsQuery
        response: {
            200: {
                application/json: array(LedgerSettlement)
            }
        }
    }
}

operation /ledger/settlements/{settlementId}: {
    params: {
        settlementId: uuid
    }
    get: {
        service: LedgerService.getSettlement
        response: {
            200: {
                application/json: LedgerSettlement
            }
        }
    }
}

operation /ledger/settlements/{settlementId}/finalize: {
    params: {
        settlementId: uuid
    }
    post: {
        service: LedgerService.finalizeSettlement
        request: {
            application/json: FinalizeSettlementInput
        }
        response: {
            200: {
                application/json: LedgerSettlement
            }
        }
    }
}

operation /ledger/settlements/{settlementId}/status: {
    params: {
        settlementId: uuid
    }
    patch: {
        service: LedgerService.updateSettlementStatus
        request: {
            application/json: UpdateSettlementStatusInput
        }
        response: {
            200: {
                application/json: LedgerSettlement
            }
        }
    }
}

operation /ledger/settlements/{settlementId}/entries: {
    params: {
        settlementId: uuid
    }
    get: {
        service: LedgerService.listSettlementEntries
        query: Pagination
        response: {
            200: {
                application/json: array(LedgerSettlementEntry)
            }
        }
    }
}

operation /ledger/settlements/{settlementId}/entries/{entryId}: {
    params: {
        settlementId: uuid
        entryId: uuid
    }
    put: {
        service: LedgerService.addEntryToSettlement
        response: {
            204:
        }
    }
    delete: {
        service: LedgerService.removeEntryFromSettlement
        response: {
            204:
        }
    }
}

operation /ledger/settlements/{settlementId}/transactions: {
    params: {
        settlementId: uuid
    }
    get: {
        service: LedgerService.listSettlementTransactions
        query: Pagination
        response: {
            200: {
                application/json: array(LedgerSettlementTransaction)
            }
        }
    }
}
