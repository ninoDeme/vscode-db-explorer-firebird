import {ExtensionContext, window, commands, workspace} from "vscode";
import {Constants, getOptions} from "./config";
import {FirebirdTreeDataProvider} from "./firebirdTreeDataProvider";
import {NodeHost, NodeDatabase, NodeTable, NodeField} from "./nodes";
import {Options, FirebirdTree} from "./interfaces";
import {connectionPicker} from "./shared/connection-picker";
import {Driver} from "./shared/driver";
import * as vscode from 'vscode';
import {Global} from "./shared/global";
import {logger} from "./logger/logger";
import {KeywordsDb} from "./language-server/db-words.provider";
import QueryResultsView from "./result-view";
import MockData from "./mock-data/mock-data";
import LanguageServer from "./language-server";
import * as cp from 'node:child_process';


export function activate(context: ExtensionContext) {
  logger.info(`Activating extension ...`);

  /* load configuration and reload every time it's changed */
  logger.info(`Loading configuration...`);
  let config: Options = getOptions();
  Driver.setClient(config.useNativeDriver, context);
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(() => {
      logger.debug("Configuration changed. Reloading configuration...");
      config = getOptions();
      Driver.setClient(config.useNativeDriver, context);
      commands.executeCommand("firebird.explorer.refresh");
    })
  );

  /* initialize providers */
  const firebirdLanguageServer = new LanguageServer();
  const firebirdDatabaseWords = new KeywordsDb();
  const firebirdTreeDataProvider = new FirebirdTreeDataProvider(context);
  const firebirdMockData = new MockData(context.extensionPath);
  const firebirdQueryResults = new QueryResultsView(context.extensionPath);

  context.subscriptions.push(
    window.registerTreeDataProvider(Constants.FirebirdExplorerViewId, firebirdTreeDataProvider),
    firebirdMockData,
    firebirdQueryResults,
    firebirdLanguageServer
  );

  firebirdLanguageServer.setSchemaHandler(_doc => {
    return firebirdDatabaseWords.getSchema();
  });

  // firebirdMockData.display([], "10");

  /* GENERATE MOCK DATA */
  context.subscriptions.push(
    commands.registerCommand("firebird.mockData", (tableNode: NodeTable) => {
      tableNode.generateMockData(firebirdMockData, config);
    })
  );

  /* EXPLORER TOOLBAR: add new host/database connection */
  context.subscriptions.push(
    commands.registerCommand("firebird.explorer.addConnection", () => {
      firebirdTreeDataProvider.addConnection().catch(err => {
        logger.error(err);
      });
    })
  );

  /* EXPLORER TOOLBAR: create new sql document */
  context.subscriptions.push(
    commands.registerCommand("firebird.explorer.newSqlDocument", () => {
      Driver.createSQLTextDocument()
        .then(_res => {
          logger.info("New SQL document created...");
        })
        .catch(err => {
          logger.error(err);
        });
    })
  );

  /* EXPLORER TOOLBAR: refresh explorer view items */
  context.subscriptions.push(
    commands.registerCommand("firebird.explorer.refresh", (node: FirebirdTree) => {
      firebirdTreeDataProvider.refresh(node);
    })
  );

  /* HOST ITEM: remove host and it's associated databases */
  context.subscriptions.push(
    commands.registerCommand("firebird.removeHost", (connectionNode: NodeHost) => {
      connectionNode.removeHost(context, firebirdTreeDataProvider);
    })
  );

  /* DB ITEM: set active database */
  context.subscriptions.push(
    commands.registerCommand("firebird.setActive", (databaseNode: NodeDatabase) => {
      databaseNode.setActive();
    })
  );

  /* DB ITEM: choose active database */
  context.subscriptions.push(
    commands.registerCommand("firebird.chooseActive", () => {
      connectionPicker(context)
        .then(pickedConnection => {
          if (pickedConnection) {
            const id: string = pickedConnection.detail.split(": ").pop();
            Global.setActiveConnectionById(context, id);
          }
        })
        .catch(err => {
          logger.error(err.message);
          logger.showError(err.message, ["Cancel", "Add New Connection"]).then(res => {
            if (res === "Add New Connection") {
              firebirdTreeDataProvider.addConnection().catch(err => {
                logger.error(err);
              });
            }
          });
        });
    })
  );

  /* DB ITEM: create new sql document */
  context.subscriptions.push(
    commands.registerCommand("firebird.newQuery", (databaseNode: NodeDatabase) => {
      databaseNode.newQuery();
    })
  );

  /* DB ITEM: remove database from explorer view */
  context.subscriptions.push(
    commands.registerCommand("firebird.removeDatabase", (databaseNode: NodeDatabase) => {
      databaseNode.removeDatabase(context, firebirdTreeDataProvider);
    })
  );

  /* COMMAND: run document query */
  context.subscriptions.push(
    commands.registerCommand("firebird.runQuery", () => {
      Driver.runQuery()
        .then(res => {
          if (res[0] && "message" in res[0]) {
            logger.info(res[0].message);
            logger.showInfo(res[0].message);
            commands.executeCommand("firebird.explorer.refresh");
          } else {
            firebirdQueryResults.display(res, config.recordsPerPage);
          }
        })
        .catch(error => {
          logger.error(error.message ?? error);
          if (error.notify) {
            logger.showError(error.message, error.options || []).then(selected => {
              if (selected === "New SQL Document") {
                commands.executeCommand("firebird.explorer.newSqlDocument");
              }
              if (selected === "Set Active Database") {
                commands.executeCommand("firebird.chooseActive");
              }
            });
          } else {
            logger
              .showError("Oops! Something went wrong. Check the log output for more details!", [
                "Cancel",
                "Show Log Output"
              ])
              .then(selected => {
                if (selected === "Show Log Output") {
                  logger.showOutput();
                }
              });
          }
        });
    })
  );

  // PREDEFINED QUERY COMMANDS

  /* DB ITEM: show database info */
  context.subscriptions.push(
    commands.registerCommand("firebird.showDatabaseInfo", (databaseNode: NodeDatabase) => {
      databaseNode.showDatabaseInfo().then(result => {
        firebirdQueryResults.display(result, config.recordsPerPage);
      });
    })
  );

  /* COMMAND tables node: show table info */
  context.subscriptions.push(
    commands.registerCommand("firebird.showTableInfo", (tableNode: NodeTable) => {
      tableNode
        .showTableInfo()
        .then(result => {
          firebirdQueryResults.display(result, config.recordsPerPage);
        })
        .catch(err => {
          logger.error(err);
          logger
            .showError("Ooops! Something went wrong! Check the log details for more info.", [
              "Cancel",
              "Show Log Details"
            ])
            .then(res => {
              if (res === "Show Log Details") {
                logger.showOutput();
              }
            });
        });
    })
  );

  /* COMMAND tables node: select all records */
  context.subscriptions.push(
    commands.registerCommand("firebird.selectAllRecords", (tableNode: NodeTable) => {
      tableNode.selectAllRecords().then(result => {
        firebirdQueryResults.display(result, config.recordsPerPage);
      });
    })
  );

  /* COMMAND table node: drop selected table */
  context.subscriptions.push(
    commands.registerCommand("firebird.table.dropTable", async (tableNode: NodeTable) => {
      const answer = await vscode.window.showInformationMessage("Do you really want to drop this table?", "Yes", "No");
      if (answer === "Yes") {
        tableNode.dropTable();
      }
    })
  );

  /* COMMAND field node: select all records for single field */
  context.subscriptions.push(
    commands.registerCommand("firebird.selectFieldRecords", (fieldNode: NodeField) => {
      fieldNode.selectAllSingleFieldRecords().then(result => {
        firebirdQueryResults.display(result, config.recordsPerPage);
      });
    })
  );

    /* COMMAND field node: open extension logs */
    context.subscriptions.push(
      commands.registerCommand("firebird.showLogs", () => {
        logger.showOutput();
      })
    );

  /* COMMAND field node: build native client */
  context.subscriptions.push(
    commands.registerCommand("firebird.buildNative", async () => {
      // TODO: precompile and just link it depending on the platform
      const answer = await vscode.window.showInformationMessage("Compile the native driver? (requires python to be installed)", "Yes", "No");
      if (answer === "Yes") {
        // Execute the npm script
        const child = cp.exec(`npm run install-native`, {cwd: context.extensionUri.fsPath});
        const statusIndicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        statusIndicator.text = "$(loading~spin) Compiling Native Driver...";
        statusIndicator.command = "firebird.showLogs";

        statusIndicator.show();

        // Capture and display the output of the npm script
        child.stdout.on('data', (data) => {
          logger.output(`[node-gyp driver compilation] ${data}`);
        });

        // Handle any errors that occur during script execution
        child.on('error', (error) => {
          logger.showError(`Error: ${error.message}`);
        });

        // Listen for when the script process exits
        child.on('close', (code) => {
          statusIndicator.dispose();
          if (code) {
            logger.error(`Build failed: Terminal exited with code: ${code}`);
            logger.showError(`Build failed: Terminal exited with code: ${code}`);
          } else {
            window.showInformationMessage("Compiled Driver Successfully");
          }
        });
      }
    })
  );
}

