# A widget.
# Documented across lines.
contract Widget: {
    id: readonly uuid
    secret?: writeonly string
    kind: enum(basic, "on hold", 'a "quoted" kind')
    datePattern?: string(regex="^\d{2}/\d{2}$")
    ttl?: duration
    contact?: email
    site?: url
    size?: int
    tags?: array(string, min=1)
    legacy?: deprecated string
    nickname?: string | null
    parent?: lazy(Widget)
    shape?: Shape
}

contract TimestampedWidget: Widget & {
    createdAt?: datetime
}

contract Shape: discriminated(by=kind, Circle | Square)

contract Circle: {
    kind?: literal("circle")
    r?: number
}

contract Square: {
    kind?: literal("square")
    side?: number
}

contract mode(loose) Bag: {
    id?: string
}

contract Sealed: {
    id?: string
}

contract _3DModel: {
    mesh?: string
}

contract ApiError: {
    message?: string
}

contract CreateWidgetRequest: {
    data?: string
}

operation /widgets/{widgetId}: {
    params: {
        widgetId: uuid
    }
    get: { # Long prose. Across several lines.
        name: Fetch a widget with awkward chars
        sdk: getWidget
        query: {
            expand?: boolean # expand nested
        }
        response: {
            200: {
                application/json: Widget
                text/csv: string
                headers: {
                    X-Rate-Limit?: int # requests left
                }
            }
            204:
            304:
            404(documented): {
                application/json: ApiError
            }
            429:
            503(documented): {
                headers: {
                    Retry-After?: int
                }
            }
        }
    }
}

operation /widgets: {
    post: {
        sdk: createWidget
        security: none
        request: {
            application/json: Widget
            application/vnd.api+json: CreateWidgetRequest
        }
        response: {
            201: {
                application/json: Widget
            }
        }
    }
}
