options {
    keys: {
        area: petstore
    }
    services: {
        PetService: "#src/modules/pet/pet.service.js"
        StoreService: "#src/modules/store/store.service.js"
        UserService: "#src/modules/user/user.service.js"
    }
}

# An order placed for purchasing a pet
contract Order: {
    id: readonly int
    petId: int
    quantity: int
    shipDate: datetime
    status: enum(placed, approved, delivered) = placed
    complete: boolean = false
}

# A pet category
contract Category: {
    id: int
    name: string
}

# A user purchasing from the pet store
contract User: {
    id: readonly int
    username: string
    firstName?: string
    lastName?: string
    email?: email
    password?: writeonly string
    phone?: string
    userStatus?: int # 1 = active
}

# A tag for a pet
contract Tag: {
    id: int
    name: string
}

# A pet for sale in the pet store
contract Pet: {
    id: readonly int
    category?: Category
    name: string
    photoUrls: array(string)
    tags?: array(Tag)
    status?: enum(available, pending, sold) = available
}

# The result of uploading an image resource
contract ApiResponse: {
    code?: int
    type?: string
    message?: string
}

contract UpdatePetForm: {
    name?: string
    status?: string
}

contract UploadFileForm: {
    additionalMetadata?: string
    file?: binary
}

# ─── Pet endpoints ────────────────────────────────────────────────────────────

operation /pet: {
    put: { # update an existing pet
        sdk: updatePet
        service: PetService.update
        request: {
            application/json: Pet
        }
        response: {
            200: { application/json: Pet }
            400:
            404:
            405:
        }
    }

    post: { # add a new pet to the store
        sdk: addPet
        service: PetService.add
        request: {
            application/json: Pet
        }
        response: {
            200: { application/json: Pet }
            405:
        }
    }
}

operation /pet/findByStatus: {
    get: { # finds pets by status
        sdk: findPetsByStatus
        service: PetService.findByStatus
        query: {
            status: array(enum(available, pending, sold))
        }
        response: {
            200: { application/json: array(Pet) }
            400:
        }
    }
}

operation(deprecated) /pet/findByTags: {
    get: { # finds pets by tags
        sdk: findPetsByTags
        service: PetService.findByTags
        query: {
            tags: array(string)
        }
        response: {
            200: { application/json: array(Pet) }
            400:
        }
    }
}

operation /pet/{petId}: {
    params: {
        petId: int
    }

    get: { # find pet by ID
        sdk: getPetById
        service: PetService.getById
        response: {
            200: { application/json: Pet }
            400:
            404:
        }
    }

    post: { # update a pet in the store with form data
        sdk: updatePetWithForm
        service: PetService.updateWithForm
        request: {
            application/x-www-form-urlencoded: UpdatePetForm
        }
        response: {
            405:
        }
    }

    delete: { # delete a pet
        sdk: deletePet
        service: PetService.delete
        headers: {
            api-key?: string
        }
        response: {
            400:
        }
    }
}

operation /pet/{petId}/uploadImage: {
    params: {
        petId: int
    }

    post: { # upload an image
        sdk: uploadFile
        service: PetService.uploadImage
        request: {
            multipart/form-data: UploadFileForm
        }
        response: {
            200: { application/json: ApiResponse }
        }
    }
}

# ─── Store endpoints ──────────────────────────────────────────────────────────

operation /store/inventory: {
    get: { # returns pet inventories by status
        sdk: getInventory
        service: StoreService.getInventory
        response: {
            200: { application/json: record(string, int) }
        }
    }
}

operation /store/order: {
    post: { # place an order for a pet
        sdk: placeOrder
        service: StoreService.placeOrder
        request: {
            application/json: Order
        }
        response: {
            200: { application/json: Order }
            400:
        }
    }
}

operation /store/order/{orderId}: {
    params: {
        orderId: int
    }

    get: { # find purchase order by ID
        sdk: getOrderById
        service: StoreService.getOrderById
        response: {
            200: { application/json: Order }
            400:
            404:
        }
    }

    delete: { # delete purchase order by ID
        sdk: deleteOrder
        service: StoreService.deleteOrder
        response: {
            400:
            404:
        }
    }
}

# ─── User endpoints ───────────────────────────────────────────────────────────

operation /user: {
    post: { # create user
        sdk: createUser
        service: UserService.create
        request: {
            application/json: User
        }
        response: {
            200:
        }
    }
}

operation /user/createWithList: {
    post: { # creates list of users with given input array
        sdk: createUsersWithListInput
        service: UserService.createWithList
        request: {
            application/json: array(User)
        }
        response: {
            200:
        }
    }
}

operation /user/login: {
    get: { # logs user into the system
        sdk: loginUser
        service: UserService.login
        query: {
            username: string
            password: string
        }
        response: {
            200: {
                application/json: string
                headers: {
                    x-rate-limit?: int
                    x-expires-after?: datetime
                }
            }
            400:
        }
    }
}

operation /user/logout: {
    get: { # logs out the current logged-in user session
        sdk: logoutUser
        service: UserService.logout
        response: {
            200:
        }
    }
}

operation /user/{username}: {
    params: {
        username: string
    }

    get: { # get user by user name
        sdk: getUserByName
        service: UserService.getByName
        response: {
            200: { application/json: User }
            400:
            404:
        }
    }

    put: { # update user
        sdk: updateUser
        service: UserService.update
        request: {
            application/json: User
        }
        response: {
            400:
            404:
        }
    }

    delete: { # delete user
        sdk: deleteUser
        service: UserService.delete
        response: {
            400:
            404:
        }
    }
}
