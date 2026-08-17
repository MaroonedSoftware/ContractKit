options {
    keys: {
        area: commerce
        subarea: catalog
    }
    services: {
        CatalogService: "#modules/catalog/catalog.service.js"
    }
    request: {
        headers: {
            authorization: string
        }
    }
}

# An amount in the smallest unit of its currency, so nothing is ever a float.
contract Money: {
    amount: int
    currency: string(len=3)
}

contract Image: {
    url: url
    alt?: string(max=200)
    width?: int(min=1)
    height?: int(min=1)
}

contract Variant: {
    id: readonly uuid
    sku: string(min=1, max=64, regex=/^[A-Z0-9-]+$/)
    price: Money
    inStock: int(min=0) = 0
    options: record(string, string)
}

# Something a customer can buy. Referenced from orders.ck.
contract Product: {
    id: readonly uuid
    slug: string(min=1, max=80, regex=/^[a-z0-9-]+$/)
    title: string(min=1, max=200)
    description?: string(max=5000)
    status: enum(draft, active, archived) = draft
    images: array(Image)
    variants: array(Variant, min=1)
    tags?: array(string, max=20)
    createdAt: readonly datetime
    updatedAt: readonly datetime
}

contract ProductPage: {
    data: array(Product)
    nextCursor?: string
    total: int
}

contract Problem: {
    type: url
    title: string
    status: int
    detail?: string
}

operation /products: {
    get: { # search the catalog
        name: Search products
        sdk: search
        service: CatalogService.search
        security: none
        # Exposed to agents: read-only, safe to retry, and it only reads our own catalog.
        mcp: {
            name: "searchProducts"
            title: "Search products"
            description: "Full-text search over the product catalog. Returns a page of products with prices and stock."
            hint: readOnly, idempotent, nonDestructive, closedWorld
        }
        query: {
            q?: string(max=200)
            tag?: array(string)
            status?: enum(draft, active, archived) = active
            minPrice?: int(min=0)
            maxPrice?: int(min=0)
            limit?: int(min=1, max=100) = 24
            cursor?: string
        }
        response: {
            200: { application/json: ProductPage }
            400: { application/json: Problem }
        }
    }

    post: { # create a product
        sdk: create
        service: CatalogService.create
        security: {
            policy: catalogWrite
        }
        request: {
            application/json: Product
        }
        response: {
            201: { application/json: Product }
            422: { application/json: Problem }
        }
    }
}

operation /products/{slug}: {
    params: {
        slug: string(regex=/^[a-z0-9-]+$/)
    }

    get: { # fetch one product by slug
        sdk: getBySlug
        service: CatalogService.getBySlug
        security: none
        mcp: true
        response: {
            200: {
                application/json: Product
                headers: {
                    cache-control: string
                    etag?: string
                }
            }
            304: {}
            404: { application/json: Problem }
        }
    }

    patch: { # update a product
        sdk: update
        service: CatalogService.update
        security: {
            policy: catalogWrite
        }
        request: {
            application/json: {
                title?: string(min=1, max=200)
                description?: string(max=5000)
                status?: enum(draft, active, archived)
                tags?: array(string, max=20)
            }
        }
        response: {
            200: { application/json: Product }
            404: { application/json: Problem }
            422: { application/json: Problem }
        }
    }
}
