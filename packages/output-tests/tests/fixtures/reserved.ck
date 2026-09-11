options {
    services: {
        SeatService: "#src/services/seat.service.js"
    }
}

# Names that are fine in a contract but reserved in Python: keywords, the attributes of Pydantic's
# BaseModel, and the type names a generated module imports. Path params named after keywords or
# SDK method arguments are left to the Python plugin's unit tests, since the TypeScript and C#
# generators do not escape them yet.

# A seat, whose field names are all reserved somewhere in Python
contract Seat: {
    class: string
    from?: date
    date: date
    copy?: string
    modelDump?: string
    json?: string
}

# Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
contract SeatRef: {
    class: string
}

operation /seats/{seatId}: {
    params: {
        seatId: string
    }

    get: { # fetch one seat
        sdk: getSeat
        service: SeatService.getSeat
        query: {
            from?: string
            pageSize?: int
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
