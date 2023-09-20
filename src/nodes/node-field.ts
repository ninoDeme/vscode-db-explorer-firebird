import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from "vscode";
import { TextDecoder } from "util";
import { join } from "path";
import { ConnectionOptions, FirebirdTree } from "../interfaces";
import { selectAllFieldRecordsQuery } from "../shared/queries";
import { logger } from "../logger/logger";
import { Global } from "../shared/global";
import { Driver } from "../shared/driver";

export class NodeField implements FirebirdTree {
  decoder: TextDecoder;
  constructor(
    private readonly field: any,
    private readonly table: string,
    private readonly dbDetails: ConnectionOptions
  ) {
    this.decoder = new TextDecoder();
  }

  public getTreeItem(context: ExtensionContext): TreeItem {
    return {
      label: `${this.field.FIELD_NAME.trim()} : ${this.field.FIELD_TYPE.trim() + " (" + this.field.FIELD_LENGTH + ")"}`,
      collapsibleState: TreeItemCollapsibleState.None,
      contextValue: "field",
      tooltip: this.getTooltip(),
      iconPath: {
        dark: this.setIcon(this.field.CONSTRAINT_TYPE, this.field.NOT_NULL, "dark", context),
        light: this.setIcon(this.field.CONSTRAINT_TYPE, this.field.NOT_NULL, "light", context)
      }
    };
  }

  public async getChildren(): Promise<FirebirdTree[]> {
    return [];
  }

  // sets the correct field icon depending on field type and ui theme color
  private setIcon(constraint: any, notNull: number, tint: string, context: ExtensionContext): string {
    const type = this.parseConstraint(constraint);
    if (!type) {
      return notNull ? this.joinPath("notnull", tint, context) : this.joinPath("null", tint, context);
    } else if (type.trim() === "PRIMARY KEY") {
      return this.joinPath("primary", tint, context);
    } else if (type.trim() === "FOREIGN KEY") {
      return this.joinPath("foreign", tint, context);
    } else if (type.trim() === "UNIQUE") {
      return this.joinPath("unique", tint, context);
    } else {
      return "";
    }
  }

  // construct tooltip
  private getTooltip(): string {
    const constraint = this.parseConstraint(this.field.CONSTRAINT_TYPE);
    const type = `${this.field.FIELD_TYPE.trim() + " (" + this.field.FIELD_LENGTH + ")"}`;
    const notNull = this.field.NOT_NULL;

    return `${this.field.FIELD_NAME.trim()}\n${type}\n${constraint ? constraint + "\n" : ""}${
      notNull ? "NOT NULL" : "NULL"
    }`;
  }

  // parse buffer array
  private parseConstraint(constraint: any): string | undefined {
    if (constraint instanceof Buffer) {
      return this.decoder.decode(constraint);
    } 
    return undefined;
  }

  // construct path to icon
  private joinPath(type: string, tint: string, context: ExtensionContext): string {
    return join(context.extensionPath, "resources", "icons", tint, type + "-" + tint + ".svg");
  }

  //  run predefined sql query
  public async selectAllSingleFieldRecords() {
    logger.info("Custom Query: Select All Single Field Records");

    const qry = selectAllFieldRecordsQuery(this.field.FIELD_NAME, this.table.trim());
    Global.activeConnection = this.dbDetails;

    return Driver.runQuery(qry, this.dbDetails)
      .then(result => {
        return result;
      })
      .catch(err => {
        logger.error(err);
      });
  }
}
