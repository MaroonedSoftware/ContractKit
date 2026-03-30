options {
    keys: {
        area: shared
    }
}

contract CustomCurrency: { # Represents a custom currency
    code: string(length=3) # The ISO currency code
    exponent: int # The currency exponent
}