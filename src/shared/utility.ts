import {TextEditor, workspace, window, ViewColumn} from "vscode";
import * as Firebird from "node-firebird";
import {Global} from "./global";
import {ConnectionOptions} from "../interfaces";
import {logger} from "../logger/logger";
import {Attachment, createNativeClient, getDefaultLibraryFilename} from 'node-firebird-driver-native';

export class Driver {

  static setClient(useNativeDriver: boolean) {
    this.client = useNativeDriver ? new NativeClient() : new NodeClient();
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
        connection.detach();
        logger.info("Finished Firebird query, displaying results... ");
        return result;
      } else {
        connection.detach();
        // because node-firebird plugin doesn't have callback on successfull ddl statements (test further)
        logger.info("Finished Firebird query.");
        const ddl = this.constructResponse(sql);
        return ([{message: `${ddl} command executed successfully!`}]);
      }
    } catch (err) {
      connection.detach();
      throw err;

    }
  }

}

export interface ClientI<K> {
  queryPromise<T extends object>(connection: K, sql: string): Promise<T[]>;
  createConnection(connectionOptions: any): Promise<K>;
}

export class NodeClient implements ClientI<Firebird.Database> {
  public queryPromise<T>(connection: Firebird.Database, sql: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      connection.query(sql, [], (err: any, rows: any) => {
        if (err) {
          reject("Error queryPromise=======: " + err.message);
        } else {
          connection.detach();
          resolve(rows);
        }
      });
    });
  }

  public async createConnection(connectionOptions: any): Promise<Firebird.Database> {
    return new Promise<Firebird.Database>((resolve, reject) => {
      Firebird.attach(connectionOptions, (err, db) => {
        if (err) {
          logger.error(err.message);
          reject(err);
        }
        resolve(db);
      });
    });
  }
}

export class NativeClient implements ClientI<Attachment> {
  public async queryPromise<T extends object>(connection: Attachment, sql: string): Promise<T[]> {

    const trans = await connection.startTransaction();
    const res = await connection.executeQuery(trans, sql);
    await trans.commit();
    return await res.fetchAsObject();
  }

  public async createConnection(connectionOptions: ConnectionOptions): Promise<Attachment> {
    const connectionStr = `${connectionOptions.host}/${connectionOptions.port ?? '3050'}:${connectionOptions.database}`;
    const client = createNativeClient(getDefaultLibraryFilename());

    return await client.connect(connectionStr, {username: connectionOptions.user, password: connectionOptions.password, role: connectionOptions.role});
  }
}