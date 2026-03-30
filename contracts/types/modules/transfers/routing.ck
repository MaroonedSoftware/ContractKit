options {
    keys: {
        area: transfers
    }
}

contract Routing: { # Represents a routing object
    routingNumber: string(min=1, max=100) # The routing number
    routingNumberType: string # The routing number type
}
