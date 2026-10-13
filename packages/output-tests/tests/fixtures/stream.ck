options {
    keys: { area: chat }
    services: {
        ChatService: "#src/services/chat.service.js"
    }
}

# A token of the reply as it is generated
contract ChatDelta: {
    type: literal("delta")
    text: string
}

# The reply is complete
contract ChatDone: {
    type: literal("done")
    # Total tokens, a bigint so each event goes through the reviver
    tokens: bigint
}

contract ChatStreamEvent: discriminated(by=type, ChatDelta | ChatDone)

operation /conversations/{id}/stream: {
    params: { id: uuid }
    get: {
        sdk: streamConversation
        service: ChatService.stream
        # A tool returns one result, so this is skipped (with a warning) rather than generated
        mcp: true
        response: {
            200: { text/event-stream: ChatStreamEvent }
            404:
        }
    }
}
