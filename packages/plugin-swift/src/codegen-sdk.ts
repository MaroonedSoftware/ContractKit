import { renderFile } from './codegen-models.js';
import { docLines } from './naming.js';

export interface SdkAggregatorClient {
    className: string;
    propertyName: string;
}

/**
 * Generate the SDK entry point: one property per generated client, all sharing a single `SdkHttp`
 * and therefore one configuration and one transport.
 *
 * The Python SDK gives each sub-client its own connection pool; that is a bug worth not repeating,
 * since a caller holding one SDK expects one set of connections.
 */
export function generateSdkSwift(sdkName: string, clients: readonly SdkAggregatorClient[]): string {
    const lines: string[] = [''];
    lines.push(
        ...docLines(
            'Entry point to the generated SDK.\n\n' +
                'Holds one `SdkHttp`, shared by every client, so the SDK keeps a single configuration and transport.',
            '',
        ),
    );
    lines.push(`public final class ${sdkName}: Sendable {`);
    lines.push('    public let http: SdkHttp');
    for (const client of clients) lines.push(`    public let ${client.propertyName}: ${client.className}`);
    lines.push('');
    lines.push('    public init(config: SdkConfig) {');
    lines.push('        let http = SdkHttp(config: config)');
    lines.push('        self.http = http');
    for (const client of clients) lines.push(`        self.${client.propertyName} = ${client.className}(http: http)`);
    lines.push('    }');
    lines.push('');
    lines.push(...docLines('The SDK against `baseURL`, with `headers` added to every request.', '    '));
    lines.push('    public convenience init(baseURL: URL, headers: @escaping @Sendable () async throws -> [String: String] = { [:] }) {');
    lines.push('        self.init(config: SdkConfig(baseURL: baseURL, headers: headers))');
    lines.push('    }');
    lines.push('}');
    return renderFile(lines);
}
