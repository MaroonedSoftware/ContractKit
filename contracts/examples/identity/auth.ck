options {
    keys: {
        area: identity
        product: Acme
    }
    services: {
        AuthService: "#modules/auth/auth.service.js"
        UserService: "#modules/user/user.service.js"
    }
    request: {
        headers: {
            authorization: string
            x-request-id?: uuid
        }
    }
}

# Fields every persisted row carries. Inherited rather than repeated.
contract Auditable: {
    createdAt: readonly datetime
    updatedAt: readonly datetime
}

contract User: Auditable & {
    id: readonly uuid
    email: email
    displayName: string(min=1, max=80)
    password: writeonly string(min=12, max=128) # accepted on the way in, never serialized back out
    avatarUrl?: url
    locale: string = en-GB
    mfaEnabled: boolean = false
}

# Two bases: an admin is a user, plus the fields that make it one.
contract Admin: User & Auditable & {
    role: enum(support, billing, superuser)
    scopes: array(string, min=1)
}

contract Session: {
    accessToken: readonly string
    refreshToken: readonly string
    expiresIn: int
    user: User
}

contract LoginRequest: {
    email: email
    password: writeonly string(min=1)
    otp?: string(len=6, regex=/^[0-9]{6}$/) # only when the account has MFA turned on
}

contract Problem: {
    type: url
    title: string
    status: int
    detail?: string
}

operation /auth/login: {
    post: { # exchange credentials for a session
        name: Log in
        sdk: login
        service: AuthService.login
        security: none
        request: {
            application/json: LoginRequest
        }
        response: {
            200: {
                application/json: Session
                headers: {
                    set-cookie: string
                }
            }
            401: { application/json: Problem }
            # The account has MFA on and the request carried no `otp`.
            428: { application/json: Problem }
        }
    }
}

operation /auth/refresh: {
    post: { # trade a refresh token for a new session
        sdk: refresh
        service: AuthService.refresh
        security: none
        request: {
            application/json: {
                refreshToken: string(min=1)
            }
        }
        response: {
            200: { application/json: Session }
            401: { application/json: Problem }
        }
    }
}

operation /auth/logout: {
    post: { # revoke the current session
        sdk: logout
        service: AuthService.logout
        response: {
            204: {}
        }
    }
}

operation /me: {
    get: { # the signed-in user
        name: Get the current user
        sdk: me
        service: UserService.getCurrent
        response: {
            200: { application/json: User }
            401: { application/json: Problem }
        }
    }

    patch: { # update the signed-in user's profile
        sdk: updateMe
        service: UserService.updateCurrent
        request: {
            application/json: {
                displayName?: string(min=1, max=80)
                avatarUrl?: url
                locale?: string
            }
        }
        response: {
            200: { application/json: User }
            401: { application/json: Problem }
            422: { application/json: Problem }
        }
    }
}

operation(internal) /admin/users/{id}: {
    params: {
        id: uuid
    }
    security: {
        policy: adminWrite
    }

    get: { # look up any user — {{product}} staff only
        sdk: getUser
        service: UserService.getById
        response: {
            200: { application/json: Admin }
            404: { application/json: Problem }
        }
    }

    delete: { # erase a user and everything attached to them
        sdk: deleteUser
        service: UserService.erase
        response: {
            202: {}
            404: { application/json: Problem }
        }
    }
}
