import {TextEditor, workspace, window, ViewColumn, ExtensionContext, commands} from "vscode";
import * as Firebird from "node-firebird";
import {Global} from "./global";
import {ConnectionOptions} from "../interfaces";
import {logger} from "../logger/logger";
import type { Attachment, Client, ResultSet} from 'node-firebird-driver-native';
import {simpleCallbackToPromise} from './utils';
import * as fs from 'fs';
import path = require('path');

export class Driver {

  static setClient(useNativeDriver: boolean, context: ExtensionContext) {
    this.client = useNativeDriver ? new NativeClient(context.extensionUri.fsPath) : new NodeClient();
  }

  static client: ClientI<any>;

  public static async createSQLTextDocument(sql?: string): Promise<TextEditor> {
    const textDocument = await workspace.openTextDocument({content: sql, language: "sql"});
    return window.showTextDocument(textDocument, ViewColumn.One);
  }

  public static constructResponse(sql: string): string {
    const string = sql.toLowerCase();
    if (string.indexOf("create") > -1) {
      return "Create";
    } else if (string.indexOf("insert") > -1) {
      return "Insert";
    } else if (string.indexOf("alter") > -1) {
      return "Alter";
    } else if (string.indexOf("drop") > -1) {
      return "Drop";
    } else if (string.indexOf("delete") > -1) {
      return "Delete";
    }
    return null;
  }

  public static async runQuery(sql?: string, connectionOptions?: ConnectionOptions): Promise<any> {
    logger.debug("Run Query start...");

    if (!sql && !window.activeTextEditor) {
      return Promise.reject({
        notify: true,
        message: "No SQL document opened!",
        options: ["Cancel", "New SQL Document"]
      });
    }
    if (!sql && window.activeTextEditor) {
      if (window.activeTextEditor.document.languageId !== "sql") {
        return Promise.reject({
          notify: true,
          message: "No SQL document opened!",
          options: ["Cancel", "New SQL Document"]
        });
      }
    }
    if (!connectionOptions) {
      if (!Global.activeConnection) {
        return Promise.reject({
          notify: true,
          message: "No Firebird database selected!",
          options: ["Cancel", "Set Active Database"]
        });
      }
    }

    // finally check if empty sql document
    if (!sql) {
      const activeTextEditor = window.activeTextEditor;
      const selection = activeTextEditor!.selection;
      if (selection.isEmpty) {
        sql = activeTextEditor!.document.getText();
      } else {
        sql = activeTextEditor!.document.getText(selection);
      }
      if (!sql) {
        return Promise.reject({notify: false, message: "No valid SQL commands found!"});
      }
    }

    connectionOptions = connectionOptions ? connectionOptions : Global.activeConnection;

    logger.info("Executing Firebird query...");

    const connection = await this.client.createConnection(connectionOptions);
    try {
      const result = await this.client.queryPromise(connection, sql);

      if (result !== undefined) {
        //convert blob
        result.forEach(resultRow => {
          Object.keys(resultRow).forEach(field => {
            if (resultRow[field] instanceof Function) {
              resultRow[field]((_err, _name, e) => {
                e.on("data", chunk => {
                  resultRow[field] = chunk;
                });
              });
            }
          });
        });
        logger.info("Finished Firebird query, displaying results... ");
        return result;
      } else {
        // because node-firebird plugin doesn't have callback on successfull ddl statements (test further)
        logger.info("Finished Firebird query.");
        const ddl = this.constructResponse(sql);
        return ([{message: `${ddl} command executed successfully!`}]);
      }
    } finally {
      this.client.detach(connection);
    }
  }

}

export interface ClientI<K extends Firebird.Database | Attachment> {
  queryPromise<T extends object>(connection: K, sql: string): Promise<T[]>;
  createConnection(connectionOptions: ConnectionOptions): Promise<K>;
  detach(connection: K): Promise<void>;
}

export class NodeClient implements ClientI<Firebird.Database> {
  public queryPromise<T>(connection: Firebird.Database, sql: string, args: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      connection.query(sql, args, (err: any, rows: any) => {
        if (err) {
          reject("Error queryPromise: " + err.message);
        } else {
          resolve(rows);
        }
      });
    });
  }

  public async createConnection(connectionOptions: ConnectionOptions): Promise<Firebird.Database> {
    return await new Promise<Firebird.Database>((resolve, reject) => {
      Firebird.attach(connectionOptions, (err, db) => {
        if (err) {
          logger.error(err.message);
          reject(err);
        }

        resolve(db);
      });
    });
  }

  public async detach(connection: Firebird.Database) {
    if (connection) {
      await simpleCallbackToPromise((callback) => connection.detach(callback));
    }
  }
}

export class NativeClient implements ClientI<Attachment> {

  constructor(pathExt: string) {
    if (!fs.existsSync(path.join(pathExt, 'node_modules/node-firebird-native-api/build/Release'))) {
      commands.executeCommand("firebird.buildNative");
    }
  }

  public async queryPromise<T extends object>(connection: Attachment, sql: string): Promise<T[]> {
    if (!connection?.isValid) {
      throw new Error("Invalid Connection");
    }
    const trans = await connection.startTransaction();
    let res: ResultSet;
    try {
      res = await connection.executeQuery(trans, sql);
      const result = await res.fetchAsObject<T>();
      await res.close();
      await trans.commit();
      return result;  
    } catch (err) {
      if (res?.isValid) {
        await res.close();
      }
      if (trans.isValid) {
        await trans.rollback();
      }
      throw err;
    }
  }

  public async createConnection(connectionOptions: ConnectionOptions): Promise<Attachment> {
    const connectionStr = `${connectionOptions.host}/${connectionOptions.port ?? '3050'}:${connectionOptions.database}`;

    let client: Client;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {createNativeClient, getDefaultLibraryFilename} = await import('node-firebird-driver-native');
      client = createNativeClient(getDefaultLibraryFilename());  
    } catch (e) {
      throw new Error("Unable to initialize native driver: " + (e?.message ?? e));
    }

    return await client.connect(connectionStr, {username: connectionOptions.user, password: connectionOptions.password, role: connectionOptions.role});

  }

  public async detach(connection: Attachment) {
    if (connection.isValid) {
      await connection.disconnect();
    } else {
      logger.debug("Called detach on an invalid connection");
    }
  }
}