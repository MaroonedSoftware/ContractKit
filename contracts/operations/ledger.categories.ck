options {
    keys: {
        area: ledger
    }
    services {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
}

operation /ledger/categories: {
    post: {
        service: LedgerService.createCategory
        request: {
            application/json: LedgerCategory
        }
        response: {
            201: {
                application/json: LedgerCategory
            }
        }
    }
    get: {
        service: LedgerService.listCategories
        response: {
            200: {
                application/json: array(LedgerCategory)
            }
        }
    }
}

operation /ledger/categories/:categoryId: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getCategory
        response: {
            200: {
                application/json: LedgerCategory
            }
        }
    }
    patch: {
        service: LedgerService.updateCategory
        request: {
            application/json: LedgerCategory
        }
        response: {
            200: {
                application/json: LedgerCategory
            }
        }
    }
    delete: {
        service: LedgerService.deleteCategory
        response: {
            204:
        }
    }
}

operation /ledger/categories/:categoryId/accounts: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getCategoryAccounts
        response: {
            200: {
                application/json: array(LedgerAccount)
            }
        }
    }
}

operation /ledger/categories/:categoryId/children: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getChildCategories
        response: {
            200: {
                application/json: array(LedgerCategory)
            }
        }
    }
}

operation /ledger/categories/:categoryId/parents: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getParentCategories
        response: {
            200: {
                application/json: array(LedgerCategory)
            }
        }
    }
}

operation /ledger/categories/:categoryId/tree: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getCategoryTree
        response: {
            200: {
                application/json: array(CategoryTree)
            }
        }
    }
}

operation /ledger/categories/:categoryId/balances: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getCategoryBalances
        query: GetCategoryBalancesQuery
        response: {
            200: {
                application/json: array(CategoryBalance)
            }
        }
    }
}

operation /ledger/categories/:categoryId/transactions: {
    params: {
        categoryId: uuid
    }
    get: {
        service: LedgerService.getCategoryTransactions
        query: ListCategoryTransactionsQuery
        response: {
            200: {
                application/json: array(LedgerCategoryTransaction)
            }
        }
    }
}

operation /ledger/categories/:categoryId/children/:childId: {
    params: {
        categoryId: uuid
        childId: uuid
    }
    put: {
        service: LedgerService.addCategoryNesting
        response: {
            204:
        }
    }
    delete: {
        service: LedgerService.removeCategoryNesting
        response: {
            204:
        }
    }
}
