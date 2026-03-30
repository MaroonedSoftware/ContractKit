options {
    keys: {
        area: ledger
    }
    services {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
}

operation /ledger/accounts: {
    post: {
        service: LedgerService.createAccount
        request: {
            application/json: LedgerAccount
        }
        response: {
            200: {
                application/json: LedgerAccount
            }
        }
    }
    get: {
        service: LedgerService.listAccounts
        query: Pagination
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(LedgerAccount)
                }
            }
        }
    }
}

operation /ledger/accounts/:accountId: {
    params: {
        accountId: uuid
    }
    get: {
        service: LedgerService.getAccount
        response: {
            200: {
                application/json: LedgerAccount
            }
        }
    }
}

operation /ledger/accounts/:accountId/balances: {
    params: {
        accountId: uuid
    }
    get: {
        service: LedgerService.getAccountBalances
        query: GetAccountBalancesQuery
        response: {
            200: {
                application/json: AccountBalances
            }
        }
    }
}

operation /ledger/accounts/:accountId/transactions: {
    params: {
        accountId: uuid
    }
    get: {
        service: LedgerService.listAccountTransactions
        query: ListAccountTransactionsQuery
        response: {
            200: {
                application/json: array(LedgerTransaction)
            }
        }
    }
}

operation /ledger/accounts/:accountId/categories: {
    params: {
        accountId: uuid
    }
    get: {
        service: LedgerService.getAccountCategories
        response: {
            200: {
                application/json: array(LedgerCategory)
            }
        }
    }
}

operation /ledger/accounts/:accountId/categories/:categoryId: {
    params: {
        accountId: uuid
        categoryId: uuid
    }
    put: {
        service: LedgerService.addAccountToCategory
        response: {
            204:
        }
    }
    delete: {
        service: LedgerService.removeAccountFromCategory
        response: {
            204:
        }
    }
}
