import { ExtensionContext, TreeItem } from "vscode";
/**
 * Explorer view
 */
export interface FirebirdTree {
  getTreeItem(context: ExtensionContext): TreeItem | Promise<TreeItem>;
  getChildren(): FirebirdTree[] | Promise<FirebirdTree[]>;
}
