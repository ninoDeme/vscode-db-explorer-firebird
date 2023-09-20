import {SimpleCallback} from 'node-firebird';
import { Uri, Webview } from "vscode";


export const simpleCallbackToPromise = (callbackFunction: ((arg0: SimpleCallback) => any)): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        callbackFunction((err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
};

export function getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
  return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}