// Runs against the SDK generated from `stress.ck`. `toolchain.test.ts` builds it as an executable
// target beside the generated module and fails on any line starting with FAIL, or a nonzero exit.
//
// A compile proves the output is valid Swift. It cannot prove a struct decodes what the server
// sends: the Kotlin plugin's third fix was code that compiled and then threw on the first real
// response. Every check here goes through the generated types and the generated client.

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import StressSdk

/// Counts failures and reports each check on its own line.
struct Checks {
    private(set) var failures = 0

    mutating func expect(_ name: String, _ condition: @autoclosure () throws -> Bool) {
        do {
            if try condition() {
                print("PASS \(name)")
            } else {
                print("FAIL \(name)")
                failures += 1
            }
        } catch {
            print("FAIL \(name): \(error)")
            failures += 1
        }
    }

    mutating func expectThrows<T>(_ name: String, _ body: () throws -> T) {
        do {
            _ = try body()
            print("FAIL \(name): did not throw")
            failures += 1
        } catch {
            print("PASS \(name)")
        }
    }

    mutating func fail(_ name: String, _ error: Error) {
        print("FAIL \(name): \(error)")
        failures += 1
    }
}

/// A transport that records the last request and answers with whatever the test set.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    var lastRequest: URLRequest?
    var status = 200
    var headers: [String: String] = [:]
    var body = Data()

    func respond(_ status: Int, _ headers: [String: String] = [:], _ body: String = "") {
        self.status = status
        self.headers = headers
        self.body = Data(body.utf8)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lastRequest = request
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (body, response)
    }
}

func data(_ text: String) -> Data { Data(text.utf8) }

func object(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CocoaError(.coderReadCorrupt)
    }
    return object
}

let nodeId = UUID(uuidString: "8f7d3a1e-1c2b-4d5e-9f00-112233445566")!

let nodeJSON = """
{
  "id": "8f7d3a1e-1c2b-4d5e-9f00-112233445566", "class": "c", "children": [], "either": 5, "maybe": null,
  "big": "123456789012345678901234567890", "money": "12.50",
  "next": {
    "id": "8f7d3a1e-1c2b-4d5e-9f00-112233445567", "class": "d", "children": [], "either": "s",
    "maybe": { "id": "8f7d3a1e-1c2b-4d5e-9f00-112233445568" }, "big": "1", "money": "0"
  },
  "pair": ["a", 1],
  "triple": ["8f7d3a1e-1c2b-4d5e-9f00-112233445566", "2024-01-02T03:04:05.123Z", true],
  "byName": {
    "k": { "id": "8f7d3a1e-1c2b-4d5e-9f00-112233445569", "class": "e", "children": [], "either": 1, "maybe": null, "big": "2", "money": "1" }
  },
  "choice": { "kind": "card", "last4": "4242" },
  "inline": { "x": 1.5, "y": 2 },
  "day": "2024-02-29", "at": "13:45:00", "span": "P1DT2H", "blob": "aGk=",
  "any": { "a": [1, "b", null] }, "js": 3, "rating": "good"
}
"""

@main
struct Probe {
    static func main() async {
        var checks = Checks()
        do {
            try models(&checks)
            try await client(&checks)
        } catch {
            checks.fail("unexpected error", error)
        }
        print(checks.failures == 0 ? "ALL PASS" : "\(checks.failures) FAILED")
        exit(checks.failures == 0 ? 0 : 1)
    }

    static func models(_ checks: inout Checks) throws {
        let decoder = SdkJSON.makeDecoder()
        let encoder = SdkJSON.makeEncoder()

        // format(output=snake, input=pascal): decode one casing, encode the other.
        let token = try decoder.decode(Token.self, from: data(#"{"access_token":"abc"}"#))
        checks.expect("format(): decodes the output casing", token.accessToken == "abc")
        checks.expect("default: filled in when absent", token.expiresIn == 3600)
        let tokenOut = try object(encoder.encode(token))
        checks.expect("format(): encodes the input casing", tokenOut["AccessToken"] as? String == "abc")
        checks.expect("default: always written", tokenOut["ExpiresIn"] as? Int == 3600)
        checks.expect("optional: nil omits the key", tokenOut["Nested"] == nil && tokenOut["nested"] == nil)

        // Inheritance is flattened; readonly and writeonly split the model in two.
        let combined = try decoder.decode(Combined.self, from: data(#"{"id":"8f7d3a1e-1c2b-4d5e-9f00-112233445566","name":"n"}"#))
        checks.expect("inheritance: both bases flattened", combined.id == nodeId && combined.name == "n" && combined.label == "x")
        let combinedIn = try object(encoder.encode(CombinedInput(secret: "s", name: "n")))
        checks.expect("Input variant: carries writeonly, drops readonly", combinedIn["secret"] as? String == "s" && combinedIn["id"] == nil)

        // Discriminated union: the tag picks the member, and survives a round trip.
        let method = try decoder.decode(Method.self, from: data(#"{"kind":"bank","iban":"DE1"}"#))
        if case .bank(let bank) = method {
            checks.expect("discriminated: tag selects the member", bank.iban == "DE1")
        } else {
            checks.expect("discriminated: tag selects the member", false)
        }
        checks.expect("discriminated: member encodes its tag", try object(encoder.encode(method))["kind"] as? String == "bank")
        checks.expectThrows("discriminated: unknown tag is rejected") { try decoder.decode(Method.self, from: data(#"{"kind":"cash"}"#)) }
        checks.expectThrows("literal: wrong value is rejected") { try decoder.decode(Card.self, from: data(#"{"kind":"bank","last4":"1234"}"#)) }

        // Fields named after the coder's locals: read through `self.`, or they resolve to the locals.
        let shadow = try decoder.decode(Shadow.self, from: data(#"{"container":"c","encoder":2,"decoder":"d"}"#))
        checks.expect("shadowing: container, encoder and decoder fields decode", shadow.container == "c" && shadow.encoder == 2 && shadow.decoder == "d")
        let shadowOut = try object(encoder.encode(shadow))
        checks.expect("shadowing: encode writes the properties, not the locals", shadowOut["container"] as? String == "c" && shadowOut["encoder"] as? Int == 2 && shadowOut["decoder"] as? String == "d")
        checks.expectThrows("shadowing: a literal's guard reads the property") { try decoder.decode(Shadow.self, from: data(#"{"container":"c","decoder":"x"}"#)) }

        // Recursion, containers, plain unions, scalars.
        let node = try decoder.decode(Node.self, from: data(nodeJSON))
        checks.expect("recursion: lazy() self reference decodes", node.next?.class == "d")
        checks.expect("recursion: mutual reference through a union", {
            if case .leaf(let leaf)? = node.next?.maybe { return leaf.id.uuidString.hasSuffix("5568") }
            return false
        }())
        checks.expect("nullable: explicit null decodes to nil", node.maybe == nil)
        checks.expect("plain union: int member", { if case .int(5) = node.either { return true }; return false }())
        checks.expect("plain union: string member", { if case .string("s")? = node.next?.either { return true }; return false }())
        checks.expect("plain union: contract member", { if case .card(let card)? = node.choice { return card.last4 == "4242" }; return false }())
        checks.expect("tuple: positional members", node.pair?._0 == "a" && node.pair?._1 == 1)
        checks.expect("tuple: datetime member", node.triple?._1 == Date(timeIntervalSince1970: 1_704_164_645.123))
        checks.expect("record: values decode", node.byName?["k"]?.class == "e")
        checks.expect("inline object: hoisted struct", node.inline?.x == 1.5 && node.inline?.y == 2)
        checks.expect("bigint: text preserved past Int64", node.big.rawValue == "123456789012345678901234567890")
        checks.expect("decimal: text preserved", node.money.rawValue == "12.50")
        checks.expect("date, time, duration: text preserved", node.day?.rawValue == "2024-02-29" && node.at?.rawValue == "13:45:00" && node.span?.rawValue == "P1DT2H")
        checks.expect("binary: base64", node.blob == data("hi"))
        checks.expect("unknown/json: JSONValue", node.any != nil && node.js != nil)
        checks.expect("named enum: decodes", node.rating == .good)
        checks.expect("keyword field names", node.class == "c" && node.default == nil && node.self_ == nil)

        let nodeOut = try object(encoder.encode(node))
        checks.expect("nullable: nil is written as null", nodeOut["maybe"] is NSNull)
        checks.expect("optional: nil omits the key", nodeOut["default"] == nil && nodeOut["leaf"] == nil)
        checks.expect("tuple: encodes as an array", (nodeOut["pair"] as? [Any])?.count == 2)
        checks.expect("plain union: encodes the bare member", nodeOut["either"] as? Int == 5)
        checks.expect("bigint: encodes as a string", nodeOut["big"] as? String == "123456789012345678901234567890")
        checks.expect("round trip: decode(encode(x)) == x", try decoder.decode(Node.self, from: encoder.encode(node)) == node)

        checks.expectThrows("nullable: an absent key is rejected") {
            try decoder.decode(Node.self, from: data(#"{"id":"8f7d3a1e-1c2b-4d5e-9f00-112233445566","class":"c","children":[],"either":5,"big":"1","money":"0"}"#))
        }
        let dates = try decoder.decode([Date].self, from: data(#"["2024-01-02T03:04:05Z","2024-01-02T03:04:05.5Z","2024-01-02T05:04:05+02:00"]"#))
        checks.expect("datetime: with and without fraction, with offset", dates[0] == dates[2] && dates[1].timeIntervalSince(dates[0]) == 0.5)
    }

    static func client(_ checks: inout Checks) async throws {
        let transport = MockTransport()
        let sdk = Stress(config: SdkConfig(
            baseURL: URL(string: "https://api.example.com/v1")!,
            headers: { ["authorization": "Bearer t"] },
            transport: transport
        ))

        // Path, query and header parameters; a 200 with JSON and typed response headers.
        transport.respond(200, ["Content-Type": "application/json", "x-count": "7", "x-when": "2024-01-02T03:04:05Z"], nodeJSON)
        let first = try await sdk.stress.repeat(nodeId: nodeId, query: RepeatQuery(depth: 3, tags: ["a b", "c&d"]), customHeaders: RepeatHeaders(xTrace: "tr"))
        let request = transport.lastRequest!
        let url = request.url!.absoluteString
        checks.expect("path: base path kept, param substituted", url.lowercased().hasPrefix("https://api.example.com/v1/nodes/8f7d3a1e-1c2b-4d5e-9f00-112233445566?"))
        checks.expect("query: values percent-encoded, arrays repeated", url.contains("depth=3") && url.contains("tags=a%20b") && url.contains("tags=c%26d"))
        checks.expect("headers: config and operation headers sent", request.value(forHTTPHeaderField: "x-trace") == "tr" && request.value(forHTTPHeaderField: "authorization") == "Bearer t")
        checks.expect("headers: nil optional not sent", request.value(forHTTPHeaderField: "x-opt") == nil)
        if case .status200ApplicationJson(let node, let headers) = first {
            checks.expect("response: JSON body and typed headers", node.class == "c" && headers.xCount == 7 && headers.xWhen != nil)
        } else {
            checks.expect("response: JSON body and typed headers", false)
        }

        // The same status, a different content type.
        transport.respond(200, ["Content-Type": "text/plain; charset=utf-8", "x-count": "1"], "hello")
        let text = try await sdk.stress.repeat(nodeId: nodeId, customHeaders: RepeatHeaders(xTrace: "tr"))
        if case .status200TextPlain(let body, _) = text {
            checks.expect("response: content type selects the case", body == "hello")
        } else {
            checks.expect("response: content type selects the case", false)
        }

        transport.respond(204)
        let empty = try await sdk.stress.repeat(nodeId: nodeId, customHeaders: RepeatHeaders(xTrace: "tr"))
        checks.expect("response: bodyless status", empty == .status204)

        transport.respond(404, ["Content-Type": "application/json"], #"{"id":"8f7d3a1e-1c2b-4d5e-9f00-112233445566","name":"n"}"#)
        let notFound = try await sdk.stress.repeat(nodeId: nodeId, customHeaders: RepeatHeaders(xTrace: "tr"))
        if case .status404(let combined) = notFound {
            checks.expect("response: declared error status is a value", combined.name == "n")
        } else {
            checks.expect("response: declared error status is a value", false)
        }

        transport.respond(500, [:], "boom")
        do {
            _ = try await sdk.stress.repeat(nodeId: nodeId, customHeaders: RepeatHeaders(xTrace: "tr"))
            checks.expect("response: undeclared status throws SdkError", false)
        } catch is SdkError {
            checks.expect("response: undeclared status throws SdkError", true)
        }

        // A JSON request body, a keyword method name, a union response.
        transport.respond(200, ["Content-Type": "application/json"], #"{"kind":"card","last4":"1234"}"#)
        let method = try await sdk.stress.import(nodeId: nodeId, body: CombinedInput(secret: "s", name: "n"))
        let sent = try object(transport.lastRequest!.httpBody!)
        checks.expect("request: JSON body and method", transport.lastRequest!.httpMethod == "PUT" && sent["secret"] as? String == "s")
        checks.expect("request: JSON content type", transport.lastRequest!.value(forHTTPHeaderField: "Content-Type") == "application/json")
        checks.expect("response: union return type", { if case .card = method { return true }; return false }())

        // Multipart request.
        transport.respond(201, ["Content-Type": "application/json"], #"{"access_token":"z"}"#)
        _ = try await sdk.stress.mint(body: [MultipartPart(name: "AccessToken", text: "z")])
        let contentType = transport.lastRequest!.value(forHTTPHeaderField: "Content-Type") ?? ""
        let multipart = String(decoding: transport.lastRequest!.httpBody ?? Data(), as: UTF8.self)
        checks.expect("request: multipart boundary and part", contentType.hasPrefix("multipart/form-data; boundary=") && multipart.contains(#"name="AccessToken""#) && multipart.contains("\r\n\r\nz\r\n"))

        // Array response, no parameters.
        transport.respond(200, ["Content-Type": "application/json"], #"[{"access_token":"z"}]"#)
        let tokens = try await sdk.stress.listTokens()
        checks.expect("response: array of a format() contract", tokens.map(\.accessToken) == ["z"])
        checks.expect("path: parameterless route", transport.lastRequest!.url!.absoluteString == "https://api.example.com/v1/tokens")

        // An internal operation, emitted because includeInternal is on.
        transport.respond(200, ["Content-Type": "application/json"], #"{"id":"8f7d3a1e-1c2b-4d5e-9f00-112233445566"}"#)
        let leaf = try await sdk.stress.hidden()
        checks.expect("internal: emitted with includeInternal", leaf.id == nodeId)
    }
}
