options {
    services: {
        StatusService: "#src/services/status.service.js"
    }
}

# A service heartbeat — deliberately no bigint field and no `area` key
contract Heartbeat: {
    status: string
    checkedAt: datetime
}

operation /status: {
    get: { # current service status
        sdk: getStatus
        service: StatusService.get
        response: {
            200: { application/json: Heartbeat }
        }
    }
}
