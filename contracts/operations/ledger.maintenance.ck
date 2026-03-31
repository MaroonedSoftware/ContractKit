options {
    keys: {
        area: ledger
    }
    services: {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
}

operation /ledger/maintenance/cache/process-queue: {
    post: {
        service: LedgerService.processEffectiveDateCacheQueue
        request: {
            application/json: ProcessCacheQueue
        }
        response: {
            204:
        }
    }
}

operation /ledger/maintenance/accounts/{accountId}/cache/rebuild: {
    params: {
        accountId: uuid
    }
    post: {
        service: LedgerService.rebuildAccountBalanceCache
        response: {
            204:
        }
    }
}

operation /ledger/maintenance/cache/drift: {
    get: {
        service: LedgerService.detectBalanceCacheDrift
        response: {
            200: {
                application/json: array(BalanceCacheDrift)
            }
        }
    }
}

operation /ledger/maintenance/accounts/{accountId}/cache/drift: {
    params: {
        accountId: uuid
    }
    get: {
        service: LedgerService.detectBalanceCacheDrift
        response: {
            200: {
                application/json: array(BalanceCacheDrift)
            }
        }
    }
}
