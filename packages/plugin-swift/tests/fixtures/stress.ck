# Every construct the Swift generator has a branch for, in one file, so `toolchain.test.ts` can
# compile the output and run `probe.swift` against it. A change here needs a matching check there.

options {
    keys: {
        area: stress
    }
    services: {
        StressService: "#src/stress.service.js"
    }
}

# A named enum, so a field default has to resolve to a member rather than its wire spelling
contract Rating: enum(good, neutral, bad)

# Self recursion through lazy(), mutual recursion through Leaf, every container, both union
# forms, every scalar, and field names that are Swift keywords. Describes /auth/factors/* and a
# /* nested */ comment, which would end a block doc comment early.
contract Node: {
    id: uuid
    class: string
    default?: string
    self?: int
    rating?: Rating = neutral
    next?: lazy(Node)
    leaf?: Leaf
    children: array(Node)
    byName?: record(string, Node)
    pair?: tuple(string, int)
    triple?: tuple(uuid, datetime, boolean)
    either: string | int
    maybe: Leaf | Node | null
    choice?: Card | Bank
    inline?: {
        x: number
        y: number
    }
    big: bigint
    money: decimal(scale=2)
    day?: date
    at?: time
    span?: duration
    blob?: binary
    any?: unknown
    js?: json
}

contract Leaf: {
    id: uuid
    owner?: lazy(Node)
}

contract Card: {
    kind: literal("card")
    last4: string(len=4)
}

contract Bank: {
    kind: literal("bank")
    iban: string
}

contract Method: discriminated(by=kind, Card | Bank)

# Fields named after the generated coder's own locals. `encode(to:)` holds a `container` beside its
# `encoder` parameter and `init(from:)` one beside `decoder`, so a property read there without
# `self.` resolves to the local: a compile error in `encode`, and a literal's guard comparing the
# wrong thing in `init`. Found against a real contract whose model had a `container` field.
contract Shadow: {
    container: string
    encoder?: int
    decoder: literal("d")
}

# Decodes snake_case keys and encodes PascalCase ones. The nested object is hoisted into a struct
# that keeps its declared keys, which the generator warns about.
contract format(output=snake, input=pascal) Token: {
    accessToken: string
    expiresIn?: int = 3600
    nested?: {
        refreshToken: string
    }
}

contract Base: {
    id: readonly uuid
    secret: writeonly string
}

contract Mixin: {
    name: string
}

# Two flattened bases, split into Combined (no writeonly) and CombinedInput (no readonly)
contract Combined: Base & Mixin & {
    label?: string = "x"
    extra?: Method
}

operation /nodes/{node-id}: {
    params: {
        node-id: uuid
    }
    get: {
        sdk: repeat
        service: StressService.get
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
                application/json: Node
                text/plain: string
                headers: {
                    x-count: int
                    x-when?: datetime
                }
            }
            204:
            404: { application/json: Combined }
        }
    }
    put: {
        sdk: import
        service: StressService.put
        request: { application/json: Combined }
        response: {
            200: { application/json: Method }
        }
    }
}

operation /tokens: {
    post: {
        sdk: mint
        service: StressService.mint
        request: { multipart/form-data: Token }
        response: {
            201: { application/json: Token }
            400:
        }
    }
    get: {
        sdk: listTokens
        service: StressService.list
        response: {
            200: { application/json: array(Token) }
        }
    }
}

operation(internal) /internal: {
    get: {
        sdk: hidden
        service: StressService.hidden
        response: {
            200: { application/json: Leaf }
        }
    }
}
