# Every construct the generators branch on and the other fixtures leave out: both union forms, self
# and mutual recursion, tuples, records of contracts, every scalar, format() key casing, keyword
# field and method names, non-string header params, and a status with two content types, both
# among several statuses and on its own. The C#, Swift and TypeScript compile checks are what make
# it worth having.

options {
    keys: {
        area: kitchen
    }
    services: {
        KitchenService: "#src/services/kitchen.service.js"
    }
}

# A named enum, so a field default has to resolve to a member rather than its wire spelling
contract Rating: enum(good, neutral, bad)

# Self recursion through lazy(), mutual recursion through Doc, every container, both union
# forms, every scalar, and field names that are keywords in the target languages
contract Folder: {
    id: uuid
    class: string
    default?: string
    rating?: Rating = neutral
    parent?: lazy(Folder)
    readme?: Doc
    children: array(lazy(Folder))
    byName?: record(string, lazy(Folder))
    span?: tuple(int, int)
    stamped?: tuple(uuid, datetime, boolean)
    label: string | int
    pinned: Doc | lazy(Folder) | null
    instrument?: Card | Bank
    origin?: {
        x: number
        y: number
    }
    size: bigint
    price: decimal(scale=2)
    day?: date
    at?: time
    ttl?: duration
    blob?: binary
    extra?: unknown
    raw?: json
}

contract Doc: {
    id: uuid
    folder?: lazy(Folder)
}

contract Card: {
    kind: literal("card")
    last4: string(len=4)
}

contract Bank: {
    kind: literal("bank")
    iban: string
}

contract Instrument: discriminated(by=kind, Card | Bank)

# Decodes snake_case keys and encodes PascalCase ones
contract format(output=snake, input=pascal) Token: {
    accessToken: string
    expiresIn?: int = 3600
}

contract Owned: {
    id: readonly uuid
    secret: writeonly string
}

contract Named: {
    name: string
}

# Two flattened bases, split into a read and an input shape
contract Shared: Owned & Named & {
    label?: string = "x"
    instrument?: Instrument
}

contract Stamp: {
    stampedBy: string
    stampedAt: datetime
}

# A plain base under format(), which the schema inlines rather than extends
contract format(input=snake, output=pascal) Stamped: Stamp & {
    stampNote?: string
}

# format() on a contract split for readonly and writeonly fields, applied to both of its schemas
contract format(input=snake, output=pascal) Ledger: {
    id: readonly uuid
    entryCode: writeonly string
    postedAt: datetime
}

operation /folders/{folder-id}: {
    params: {
        folder-id: uuid
    }

    get: { # several statuses, and two content types on one of them
        sdk: getFolder
        service: KitchenService.getFolder
        query: {
            depth?: int = 1
            tags?: array(string)
        }
        headers: {
            x-trace: string
            x-opt?: int
        }
        response: {
            200: {
                application/json: Folder
                text/plain: string
                headers: {
                    x-count: int
                    x-when?: datetime
                }
            }
            204:
            404: {
                application/json: Shared
            }
        }
    }

    put: { # a method name that is a keyword in the target languages
        sdk: import
        service: KitchenService.replace
        request: {
            application/json: Shared
        }
        response: {
            200: {
                application/json: Instrument
            }
        }
    }
}

operation /ledgers: {
    post: {
        sdk: postLedger
        service: KitchenService.postLedger
        request: {
            application/json: Ledger
        }
        response: {
            201: {
                application/json: Ledger
            }
        }
    }
}

operation /stamps: {
    post: {
        sdk: stamp
        service: KitchenService.stamp
        request: {
            application/json: Stamped
        }
        response: {
            201: {
                application/json: Stamped
            }
        }
    }
}

operation /tokens: {
    post: {
        sdk: mint
        service: KitchenService.mint
        request: {
            application/json: Token
        }
        response: {
            201: {
                application/json: Token
            }
            400:
        }
    }

    get: {
        sdk: listTokens
        service: KitchenService.listTokens
        response: {
            200: {
                application/json: array(Token)
            }
        }
    }
}

operation /folders/{folder-id}/export: {
    params: {
        folder-id: uuid
    }

    get: { # one status with two content types and response headers, so the headers are read before the mime dispatch
        sdk: exportFolder
        service: KitchenService.exportFolder
        response: {
            200: {
                application/json: Folder
                text/csv: string
                headers: {
                    x-export-id: string
                    x-rows?: int
                }
            }
        }
    }
}
