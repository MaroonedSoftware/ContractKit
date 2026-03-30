options {
    keys: {
        area: ledger
    }
}

contract ProcessCacheQueue: { # Represents a request to process the cache queue
    batchSize?: int(min=1) # Optional batch size
}

contract BalanceCacheDrift: { # Represents the balance cache drift
    accountId: uuid # The account identifier
    accountName: string # The account name
    cachedPostedCredits: bigint # The cached posted credits
    cachedPostedDebits: bigint # The cached posted debits
    cachedPendingCredits: bigint # The cached pending credits
    cachedPendingDebits: bigint # The cached pending debits
    actualPostedCredits: bigint # The actual posted credits
    actualPostedDebits: bigint # The actual posted debits
    actualPendingCredits: bigint # The actual pending credits
    actualPendingDebits: bigint # The actual pending debits
    driftPostedCredits: bigint # The drift in posted credits
    driftPostedDebits: bigint # The drift in posted debits
    driftPendingCredits: bigint # The drift in pending credits
    driftPendingDebits: bigint # The drift in pending debits
}
