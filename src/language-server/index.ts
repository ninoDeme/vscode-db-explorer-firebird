import { Diagnostic, Disposable, languages, Position, Range, TextDocument, TextDocumentChangeEvent, workspace } from "vscode";
import { CompletionProvider } from "./completionProvider";
import { FirebirdSchema, Schema } from "../interfaces";
import {Parser} from '../parser';

export default class LanguageServer implements Disposable {
  private subscriptions: Disposable[];
  private schemaHandler: (doc: TextDocument) => Thenable<FirebirdSchema>;
  private completionProvider: CompletionProvider;

  constructor() {
    this.subscriptions = [];

    this.completionProvider = new CompletionProvider({
      provideSchema: doc => {
        if (this.schemaHandler) {
          return this.schemaHandler(doc);
        } else {
          return Promise.resolve({} as Schema.Database);
        }
      }
    });

    const diag = languages.createDiagnosticCollection('SQL diagnostics');
    // enable completion for both saved and unsaved sql files
    const documentSelector = [{ scheme: "file", language: "sql" }, { scheme: "untitled", language: "sql" }];
    this.subscriptions.push(
      languages.registerCompletionItemProvider(documentSelector, this.completionProvider, "*", "."),
      workspace.onDidChangeTextDocument((e: TextDocumentChangeEvent) => {
        if (e.document.languageId === 'sql') {
          const res = new Parser();
          res.parse(e.document);
          diag.set(e.document.uri, res.problems.map((prob => {
            const range = new Range(e.document.positionAt(prob.start), e.document.positionAt(prob.end));
            return <Diagnostic>{
              severity: prob.severity,
              range,
              message: prob.message,
            };
          })));
        }
      })
    );
  }

  setSchemaHandler(schemaHandler: (doc: TextDocument) => Thenable<FirebirdSchema>) {
    this.schemaHandler = schemaHandler;
  }

  dispose() {
    Disposable.from(...this.subscriptions).dispose();
  }
}
