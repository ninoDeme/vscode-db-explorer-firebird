import { TreeItem } from "vscode";
import { FirebirdTree } from "../interfaces";

export class NodeInfo implements FirebirdTree {
  constructor(private label?: string) {}

  public getTreeItem(_): TreeItem {
    return {};
  }

  public getChildren(): FirebirdTree[] {
    return [];
  }
}
