import * as vscode from 'vscode';

/**
 * Returns the full HTML shell for the API preview webview.
 * Locked-down CSP: only locally-loaded scripts (nonced) and stylesheets can execute.
 */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string): string {
    const baseCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'base.css'));
    const themeCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'theme.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'));
    const csp = [
        `default-src 'none'`,
        `script-src 'nonce-${nonce}' ${webview.cspSource}`,
        `style-src ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        `img-src ${webview.cspSource} data:`,
        `connect-src 'none'`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="${csp}" />
        <link rel="stylesheet" href="${baseCss}" />
        <link rel="stylesheet" href="${themeCss}" />
        <title>ContractKit API Preview</title>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
</html>`;
}
