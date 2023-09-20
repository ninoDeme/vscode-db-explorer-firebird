import { WebviewPanel, window, ViewColumn, Disposable, WebviewPanelOptions, WebviewOptions, Webview, Uri } from "vscode";
import { EventEmitter } from "events";
import { logger } from "../logger/logger";
import {getUri} from '../shared/utils';

export interface Message {
  command: string;
  data: object;
  id?: string;
}

export class QueryResultsView extends EventEmitter implements Disposable {
  // private resourceScheme = "vscode-resource";
  private disposable?: Disposable;

  // private resourcesPath: string;
  private panel: WebviewPanel | undefined;
  constructor(private type: string, private title: string, private extensionUri: Uri) {
    super();
    // this.resourcesPath = "";
  }

  show() {
    // this.resourcesPath = dirname(htmlPath);
    if (!this.panel) {
      this.init();
    }

    const html = this._getWebviewContent(this.panel.webview);
    this.panel.webview.html = html;
  }

  private init() {
    const subscriptions = [];

    const options: WebviewPanelOptions & WebviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: false, // we dont need to keep the state
      // localResourceRoots: [Uri.parse(this.resourcesPath).with({ scheme: "vscode-resource" })]
    };

    this.panel = window.createWebviewPanel(this.type, this.title, ViewColumn.Two, options);
    subscriptions.push(this.panel);

    subscriptions.push(this.panel.onDidDispose(() => this.dispose()));

    subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message: Message) => {
        logger.debug(`Received command from webview | Command: ${message.command}`);
        this.handleMessage(message);
      })
    );

    this.disposable = Disposable.from(...subscriptions);
  }

  send(message: Message) {
    if (this.panel) {
      this.panel.webview.postMessage(message);
      logger.info("Results displayed.");
    }
  }

  randomString(length: number) {
    return Math.round(Math.pow(36, length + 1) - Math.random() * Math.pow(36, length))
      .toString(36)
      .slice(1);
  }

  public handleMessage(_message: Message) {
    logger.info("HANDLE MESSAGE CALLED");

    throw new Error("Method not implemented");
  }

  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    this.panel = undefined;
  }

  private _getWebviewContent(webView: Webview) {
    const main = getUri(webView, this.extensionUri, ["out", "result-view.js"]);

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${this.title}</title>
        </head>
        <body>
          <h1>Hello World!</h1>
          <script type="module" src="${main}"></script>
        </body>
      </html>
    `;
  }

}
