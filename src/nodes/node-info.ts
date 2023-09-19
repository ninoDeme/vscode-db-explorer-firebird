import { TreeItem } from "vscode";
import { FirebirdTree } from "../interfaces";

export class NodeInfo implements FirebirdTree {
  constructor(public label?: string) {}

  public getTreeItem(_): TreeItem {
    return {};
  }

  public getChildren(): FirebirdTree[] {
    return [];
  }
}
