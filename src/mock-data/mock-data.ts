import { Disposable, Uri, ViewColumn, WebviewPanel, WebviewPanelOptions, WebviewOptions, window } from "vscode";
import { dirname, join } from "path";
import { readFile } from "fs";
import { logger } from "../logger/logger";
import { Driver } from "../shared/driver";
import * as Firebird from "node-firebird";


export interface Message {
  command: string;
  data: any;
}

interface MockField {
  name: string,
  type: string,
  notnull: boolean
}

export default class MockData implements Disposable {
  private disposable?: Disposable;
  private panel: WebviewPanel | undefined;
  private htmlCache: { [path: string]: string };

  private tableName: string;
  private fields: MockField[];
  private apiKey: string;

  constructor(private extensionPath: string) {
    this.htmlCache = {};
  }

  display(table: string, fields: MockField[], apiKey: string) {
    this.tableName = table;
    this.fields = fields;
    this.apiKey = apiKey;

    /**
     * Path to HTML files for displaying results in VS Code WebView
     * DEV: => "src",...
     * PROD: => "out",...
     */
    this.show(join(this.extensionPath, "src", "mock-data", "htmlContent", "index.html"));
  }

  show(htmlPath: string) {
    if (!this.panel) {
      this.init();
    }

    this.readWithCache(htmlPath, (html: string) => {
      if (this.panel) {
        // little hack to make the html unique so that the webview is reloaded
        html = html.replace(/<\/body>/, `<div id="${this.randomString(8)}"></div></body>`);
        this.panel.webview.html = html;
      }
    });
  }

  private init() {
    const subscriptions = [];

    const options: WebviewPanelOptions & WebviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: false, // we dont need to keep the state
      // localResourceRoots: [Uri.parse(this.resourcesPath).with({ scheme: "vscode-resource" })]
    };

    this.panel = window.createWebviewPanel("mockdata", "Generate Mock Data", ViewColumn.Beside, options);

    subscriptions.push(
      this.panel,
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: Message) => {
        logger.debug(`Received command from webview | Command: ${message.command}`);
        this.handleMessage(message);
      })
    );

    this.disposable = Disposable.from(...subscriptions);
  }

  private readWithCache(path: string, callback: (html: string) => void) {
    let html: string = "";
    if (path in this.htmlCache) {
      html = this.htmlCache[path];
      callback(html);
    } else {
      readFile(path, "utf8", (_err, content) => {
        html = content || "";
        html = this.replaceUris(html, path);
        this.htmlCache[path] = html;
        callback(html);
      });
    }
  }

  private replaceUris(html: string, htmlPath: string) {
    const path = dirname(htmlPath);
    const x = (str: string): string => {
      return this.panel.webview.asWebviewUri(Uri.file(path + str)).toString();
    };
    const regex = /(?<=(href|src)=")(.+?)(?=")/g;
    html = html.replace(regex, x);
    return html;
  }

  randomString(length: number) {
    return Math.round(Math.pow(36, length + 1) - Math.random() * Math.pow(36, length))
      .toString(36)
      .slice(1);
  }

  handleMessage(message: Message): void {
    let data;
    if (this.tableName && this.fields && this.apiKey && message.command === "getData") {
      data = { tableName: this.tableName, fields: this.fields, apiKey: this.apiKey };
      this.send({
        command: "message",
        data: data
      });
    }
    if (message.command === "gotData") {
      const data: Record<string, any>[] = message.data;

      // Constructing manually the insert because mockaroo sql format doesn't work
      let resultSQL = `insert into ${this.tableName.trim()} (\n  ${this.fields.map(v => v.name).join(',\n  ')}\n)\nvalues\n  `;
      resultSQL += `(${data.map(row => this.fields.map(f => Firebird.escape(row[f.name])).join(', ')).join('),\n  (')});\n`;
      
      Driver.createSQLTextDocument(`execute block as begin\n${resultSQL}end`);
    }

    if (message.command === "error") {
      logger.error(message.data);
      if (message.data === "Unauthorized") {
        logger.showError("ERROR: Unauthorized! Please check your API key and try again.");
      } else {
        logger.showError("ERROR: " + message.data);
      }
    }
  }

  send(message: Message) {
    if (this.panel) {
      this.panel.webview.postMessage(message);
      logger.info("Results displayed.");
    }
  }

  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    this.panel = undefined;
  }
}
