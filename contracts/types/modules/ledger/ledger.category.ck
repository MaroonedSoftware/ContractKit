options {
    keys: {
        area: ledger
    }
}

contract LedgerCategory: { # Represents a ledger category
    id: readonly uuid # The ledger category identifier
    name: string(min=3, max=100) # The ledger category name
    description?: string(max=1024) # The ledger category description
    depth: readonly int # The ledger category depth
    createdAt: readonly datetime # The ledger category creation date
}

contract LedgerCategoryTransaction: { # Represents a ledger category transaction
    transactionId: readonly uuid # The ledger transaction identifier
    status: readonly enum(pending, posted, archived) # The ledger category transaction status
    version: readonly int # The ledger category transaction version
    effectiveAt: readonly datetime # The ledger category transaction effective date
    description?: string(max=1024) | null # The ledger category transaction description
    createdAt: readonly datetime # The ledger category transaction creation date
    entries: readonly array(LedgerCategoryTransactionEntry, min=1) # The ledger category transaction entries
}

contract LedgerCategoryTransactionEntry: { # Represents a ledger category transaction entry
    id: readonly uuid # The ledger category transaction entry identifier
    accountId: readonly uuid # The ledger category transaction entry account identifier
    direction: readonly enum(credit, debit) # The ledger category transaction entry direction
    amount: readonly bigint(min=0) # The ledger category transaction entry amount
    status: readonly enum(pending, posted, archived) # The ledger category transaction entry status
    accountVersion: readonly int # The ledger category transaction entry account version
    effectiveAt: readonly datetime # The ledger category transaction entry effective date
    createdAt: readonly datetime # The ledger category transaction entry creation date
}

contract CategoryTree: { # Represents a category tree
    categoryId: uuid # The category identifier
    categoryName: string # The category name
    treeLevel: int(min=0) # The depth level in the tree
    categoryDepth: int(min=0) # The total depth of this category's subtree
    parentCategoryId?: uuid | null # The parent category identifier
    directAccountCount: int(min=0) # The number of accounts directly in this category
}

contract GetCategoryBalancesQuery: { # Represents a query to get category balances
    date?: datetime # Optional ISO 8601 date to query balances at
}

contract CategoryBalance: { # Represents the balances of a category
    accountId?: uuid | null # The account identifier
    accountName: string # The account name
    currency: string(length=3) # ISO currency code
    postedBalance: bigint(min=0) # The posted balance
    pendingBalance: bigint(min=0) # The pending balance
    availableBalance: bigint(min=0) # The available balance
}

contract ListCategoryTransactionsQuery: Pagination & { # Represents a query to list category transactions
    status?: enum(pending, posted, archived) # Optional ledger category transaction status filter
}