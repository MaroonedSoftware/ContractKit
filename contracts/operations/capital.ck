options {
    keys: {
        area: capital
    }
    services: {
        ExpansionCapitalService: "#src/modules/capital/expansion.capital.service.js"
    }
}

operation /capital/offers/expansion: {
    post: { # create an offer for expansion capital
        service: ExpansionCapitalService.createOffer
    request: {
            application/json: ExpansionCapitalOffer
        }
        response: {
            201: {
                application/json: ExpansionCapitalOffer
            }
        }
    }
    get: { # list offers for expansion capital
        service: ExpansionCapitalService.listOffers
        query: Pagination & { status?: array(OfferStatus) }
        response: {
            200: {
                application/json: {
                    meta: Pagination & { status?: array(OfferStatus) }
                    data: array(ExpansionCapitalOffer)
                }
            }
        }
    }
}

operation /capital/offers/expansion/{id}: {
    params: {
        id: uuid
    }
    get: { # get an offer for expansion capital
        service: ExpansionCapitalService.getOffer
    response: {
            200: {
                application/json: ExpansionCapitalOffer
            }
        }
    }
    delete: { # withdraw an offer for expansion capital
        service: ExpansionCapitalService.withdrawOffer
        response: {
            204:
        }
    }
}

operation /capital/offers/expansion/{id}/accept: {
    params: {
        id: uuid # the id of the offer to accept
    }
    post: {
        service: ExpansionCapitalService.acceptOffer
        request: {
            application/json: {
                termId: uuid # the term to accept
            }
        }
        response: {
            201: {
                application/json: ExpansionCapitalOffer
            }
        }
    }
}

operation /capital/offers/expansion/{id}/decline: {
    params: {
        id: uuid
    }
    post: {
        service: ExpansionCapitalService.declineOffer
        response: {
            201: {
                application/json: ExpansionCapitalOffer
            }
        }
    }
}

operation /capital/expansion: {
    get: {
        service: ExpansionCapitalService.list
        query: Pagination
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(ExpansionCapital)
                }
            }
        }
    }
}

operation /capital/expansion/{id}: {
    params: {
        id: uuid
    }
    get: {
        service: ExpansionCapitalService.get
        response: {
            200: {
                application/json: ExpansionCapital
            }
        }
    }
}

operation /capital/expansion/{id}/disburse: {
    params: {
        id: uuid
    }
    post: {
        service: ExpansionCapitalService.disburse
        request: {
            application/json: {
                capitalAmount: bigint
                originationFee: bigint
                effectiveAt: datetime
            }
        }
        response: {
            201: {
                application/json: LedgerTransaction
            }
        }
    }
}

operation /capital/expansion/{id}/repayment: {
    params: {
        id: uuid
    }
    post: {
        service: ExpansionCapitalService.repayment
        request: {
            application/json: {
                repaymentAmount: bigint
                capitalFee: bigint
                effectiveAt: datetime
            }
        }
        response: {
            201: {
                application/json: LedgerTransaction
            }
        }
    }
}

operation /capital/expansion/{id}/liquidity-disbursement: {
    params: {
        id: uuid
    }
    post: {
        service: ExpansionCapitalService.liquidityDisbursement
        request: {
            application/json: {
                disbursementAmount: bigint
                serviceFee: bigint
                effectiveAt: datetime
            }
        }
        response: {
            201: {
                application/json: LedgerTransaction
            }
        }
    }
}
