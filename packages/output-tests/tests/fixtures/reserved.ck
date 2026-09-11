options {
    services: {
        SeatService: "#src/services/seat.service.js"
    }
}

# Names that are fine in a contract but reserved in a generated language: keywords of TypeScript,
# Python, C#, Kotlin and Swift. Between them they land on each surface a generator names: model
# fields, path params (inline and through a model), query params, request and response headers,
# and MCP tool arguments.
#
# Two cases here are not about reserved words, but broke the same compile checks: a `date` query
# param, whose class a TypeScript client has to import, and an operation declaring both request and
# response headers, whose two generated header types need distinct names.
#
# Left out until the Python plugin can handle them: a path param named `body`, which every SDK
# method already uses for its request body, and fields named after a Pydantic BaseModel attribute
# (`copy`, `modelDump`, `json`) or a type the module imports (`date`, `time`). Python's output for
# those does not load yet, and the Python check here only parses it. The other generators cover the
# `body` case in their unit tests.

# A seat, whose field names are all reserved somewhere
contract Seat: {
    class: string
    from?: date
    in?: string
    is?: boolean
    object?: string
    default?: string
}

# Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
contract SeatRef: {
    class: string
}

# An inline path param named after a keyword, plus a request header block and response headers on
# the same operation, so the two generated header types have to be told apart
operation /seats/{class}: {
    params: {
        class: string
    }

    get: { # fetch one seat
        sdk: getSeat
        service: SeatService.getSeat
        mcp: true
        query: {
            from?: date
            in?: string
            pageSize?: int
        }
        headers: {
            from?: string
        }
        response: {
            200: {
                application/json: Seat
                headers: {
                    from?: string
                }
            }
        }
    }
}

operation /rows/{class}: {
    params: SeatRef

    get: { # fetch a row by its seat class
        sdk: getRow
        service: SeatService.getRow
        response: {
            200: { application/json: Seat }
        }
    }
}
