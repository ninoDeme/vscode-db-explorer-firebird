import { Disposable, ExtensionContext, Uri, ViewColumn, Webview, WebviewOptions, WebviewPanel, WebviewPanelOptions, window } from "vscode";
import { TextDecoder } from "util";

import {logger} from '../logger/logger';
import {getUri} from '../shared/utils';
import EventEmitter = require('events');

type ResultSet = Array<any>;

export interface Message {
  command: string;
  data: object;
  id?: string;
}

export default class ResultView extends EventEmitter implements Disposable {
  private resultSet?: ResultSet;
  private recordsPerPage: string;
  private type: string = "resultview";
  private title: string = "Firebird Query Results";
  private extensionUri: Uri;
  private disposable?: Disposable;
  private panel: WebviewPanel | undefined;


  constructor(context: ExtensionContext) {
    super();
    this.extensionUri = context.extensionUri;
  }

  display(resultSet: any, recordsPerPage: string) {
    this.resultSet = resultSet;
    this.recordsPerPage = recordsPerPage;

    this.show();
  }

  handleMessage(message: Message): void {
    let data: object | undefined;

    if (this.resultSet && message.command === "getData") {
      data = this.getPreparedResults();
      this.send({
        command: "message",
        data: data
      });
    } else {
      this.send({ command: "message", data: { tableHeader: [], tableBody: [], recordsPerPage: this.recordsPerPage } });
    }
  }

  /* prepare results before displaying */
  private getPreparedResults(): object {
    const decoder = new TextDecoder();
    const tableHeader: object[] = [];
    const tableBody: object[] = [];

    if (!this.resultSet || this.resultSet.length === 0) {
      return { tableHeader: [], tableBody: [], recordsPerPage: this.recordsPerPage };
    }
    // /* get table header */
    // for (const field in this.resultSet[0]) {
    //   if (Object.hasOwnProperty.call(this.resultSet[0], field)) {
    //     tableHeader.push({ title: field });
    //   }
    // }
    /* get table body */
    this.resultSet.forEach(row => {
      const temp = {};

      for (const field in row) {
        if (Object.hasOwnProperty.call(row, field)) {
          // check if null
          if (row[field] === null) {
            temp[field] = "<null>";
          }
          // check if buffer array
          else if (row[field] instanceof Buffer) {
            temp[field] = decoder.decode(row[field]);
          }
          // check if timestamp
          else if (Object.prototype.toString.call(row[field]) === "[object Date]") {
            temp[field] = new Date(row[field]).toLocaleDateString();
          }
          // check if array
          else if (typeof row[field] === "object") {
            temp[field] = JSON.stringify(row[field], null, "\t");
          }
          // else convert to string
          else if (typeof row[field] === "undefined") {
            temp[field] = "";
          } else {
            temp[field] = row[field].toString();
          }
        }
      }
      tableBody.push(temp);
    });

    return { tableHeader: tableHeader, tableBody: tableBody, recordsPerPage: this.recordsPerPage };
  }

  show() {
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

  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    this.panel = undefined;
  }

  private _getWebviewContent(webView: Webview) {
    const main = getUri(webView, this.extensionUri, ["out", "result-view"]);
    const codiconsUri = getUri(webView, this.extensionUri, ['node_modules', '@vscode/codicons', 'dist', 'codicon.css']);

    return /*html*/ `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${main}.css" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet"/>
  <title>${this.title}</title>
</head>
<body>
  <div id="main">
  </div>
  <script type="module" src="${main}.js"></script>
</body>
</html>
    `;
  }

}
