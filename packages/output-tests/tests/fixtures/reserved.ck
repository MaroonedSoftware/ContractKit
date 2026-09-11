options {
    services: {
        SeatService: "#src/services/seat.service.js"
    }
}

# Names that are fine in a contract but reserved in a generated language: keywords of TypeScript,
# Python, C#, Kotlin and Swift, the attributes of Pydantic's BaseModel, the type names a generated
# module imports, and `body`, which every SDK method already uses for its request body. Between them
# they land on each surface a generator names: model fields, path params (inline and through a
# model), query params, request and response headers, and MCP tool arguments.
#
# Two cases here are not about reserved words, but broke the same compile checks: a `date` query
# param, whose class a TypeScript client has to import, and an operation declaring both request and
# response headers, whose two generated header types need distinct names.

# A seat, whose field names are all reserved somewhere
contract Seat: {
    class: string
    from?: date
    date: date
    time?: time
    copy?: string
    modelDump?: string
    json?: string
    in?: string
    is?: boolean
    object?: string
    default?: string
}

# Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
contract SeatRef: {
    class: string
}

contract Note: {
    text: string
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

# A path param named like the SDK method's own request-body argument
operation /notes/{body}: {
    params: {
        body: string
    }

    put: { # replace a note
        sdk: putNote
        service: SeatService.putNote
        mcp: true
        request: {
            application/json: Note
        }
        response: {
            200: { application/json: Note }
        }
    }
}
