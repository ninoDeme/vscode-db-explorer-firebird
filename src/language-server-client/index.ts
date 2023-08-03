import {Diagnostic, Disposable, ExtensionContext, languages, Position, Range, TextDocument, TextDocumentChangeEvent, workspace} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import {CompletionProvider} from "./completionProvider";
import {FirebirdSchema, Schema} from "../interfaces";
import {Parser} from '../parser';
import * as path from 'path';

let client: LanguageClient;

export default class LanguageServer implements Disposable {
  private subscriptions: Disposable[];
  private schemaHandler: (doc: TextDocument) => Thenable<FirebirdSchema>;
  private completionProvider: CompletionProvider;

  constructor(context: ExtensionContext) {
    this.subscriptions = [];

    const serverModule = context.asAbsolutePath(
      path.join('..', 'firebird-language-server', 'build', 'index.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
      run: {module: serverModule, transport: TransportKind.ipc},
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
      }
    };

    const documentSelector = [{scheme: "file", language: "sql"}, {scheme: "untitled", language: "sql"}];

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // Register the server for plain text documents
			diagnosticCollectionName: 'firebird-diagnostics',
      documentSelector: documentSelector,
      diagnosticPullOptions: {
        onChange: true,
      }
    };

    this.completionProvider = new CompletionProvider({
      provideSchema: doc => {
        if (this.schemaHandler) {
          return this.schemaHandler(doc);
        } else {
          return Promise.resolve({} as Schema.Database);
        }
      }
    });
    // Create the language client and start the client.
    client = new LanguageClient(
      'firebird-language-server',
      'Firebir Language Server',
      serverOptions,
      clientOptions
    );

    // Start the client. This will also launch the server
    client.start();

    // const diag = languages.createDiagnosticCollection('SQL diagnostics');
    // enable completion for both saved and unsaved sql files
    this.subscriptions.push(
      languages.registerCompletionItemProvider(documentSelector, this.completionProvider, "*", "."),
      // workspace.onDidChangeTextDocument((e: TextDocumentChangeEvent) => {
      //   if (e.document.languageId === 'sql') {
      //     const res = new Parser();
      //     res.parse(e.document);
      //     diag.set(e.document.uri, res.problems.map((prob => {
      //       const range = new Range(e.document.positionAt(prob.start), e.document.positionAt(prob.end));
      //       return <Diagnostic>{
      //         severity: prob.severity,
      //         range,
      //         message: prob.message,
      //       };
      //     })));
      //   }
      // })
    );
  }

  setSchemaHandler(schemaHandler: (doc: TextDocument) => Thenable<FirebirdSchema>) {
    this.schemaHandler = schemaHandler; 
  }

  dispose() {
    Disposable.from(...this.subscriptions).dispose();
    client.stop();
  }
}
