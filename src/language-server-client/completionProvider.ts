import {CompletionItemProvider, TextDocument, CompletionItem, CompletionItemKind, MarkdownString, Position, CompletionContext} from "vscode";
import {Schema, FirebirdSchema, FirebirdReserved} from "../interfaces";
import {Parser} from '../parser';
import {firebirdReserved} from "./firebird-reserved";
import {logger} from '../logger/logger';

interface SchemaProvider {
  provideSchema: (doc: TextDocument) => Thenable<FirebirdSchema>;
}

export class CompletionProvider implements CompletionItemProvider {
  constructor(private schemaProvider: SchemaProvider) {}

  async provideCompletionItems(document: TextDocument, position: Position, _token, context: CompletionContext) {
    const schema = await this.schemaProvider.provideSchema(document);
    return this.getCompletionItems(
      document,
      position,
      context,
      schema.reservedKeywords ? firebirdReserved : undefined,
      schema.tables.length > 0 ? schema.tables : undefined);
  }

  private getCompletionItems(document: TextDocument, position: Position, context: CompletionContext, firebirdReserved?: FirebirdReserved[], tables?: Schema.Table[]) {
    const items: CompletionItem[] = [];

    let triggeredByDot = context.triggerCharacter === '.' || (context.triggerKind === 0 && document.lineAt(position).text[position.character - 1] === '.');
    
    // const _ = new Parser().parse(document);

    if (tables) {
      const tableItems: TableCompletionItem[] = [];

      const columnItems: ColumnCompletionItem[] = [];

      const text = document.getText();

      if (triggeredByDot) {
        const tableName: string = document.getText(document.getWordRangeAtPosition(position.translate(0, -1), /\w+(?=\.)/));
        const alias = text.match(RegExp(`((from)|(join)) (?<alias>\\w+) (as )?(?!(on)|=|(with)|(using)|(as))(${tableName})`, 'i'))?.groups?.alias;
        const tbl = tables.find(currTable => currTable.name.toLowerCase() === (alias ?? tableName).toLowerCase());
        if (tbl) {
          columnItems.push(...tbl.fields.map(col => new ColumnCompletionItem(col.name, `${tbl.name}.${col.name}: ${col.type}`)));
        } else {
          triggeredByDot = false;
        }
      }
      if (!triggeredByDot) {
      tables.forEach(tbl => {
        const alias = text.match(RegExp(`((from)|(join)) ${tbl.name} (as )?(?!(on)|=|(with)|(using)|(as))(?<alias>\\w+)`, 'i'))?.groups?.alias;
        tableItems.push(new TableCompletionItem(tbl.name, undefined, tbl.fields));
        if (alias) {
          tableItems.push(new TableCompletionItem(alias, tbl.name, tbl.fields));
        }
      });
      }
      items.push(...tableItems, ...columnItems);
    }
    if (firebirdReserved && !triggeredByDot) {
      items.push(...firebirdReserved.map(word => new KeywordCompletionItem(word)));
    }
    return items;
  }

}

class KeywordCompletionItem extends CompletionItem {
  constructor(word: any) {
    super(word.label, CompletionItemKind.Keyword);
    this.detail = word.detail;
    // this.documentation = new MarkdownString(
    //   word.documentation
    //   // "MORE DETAILS:\nhttps://firebirdsql.org/refdocs/langrefupd21-select.html"
    // );
  }
}

class TableCompletionItem extends CompletionItem {
  /**
   * Creates an instance of TableCompletionItem.
   * @param {string} label
   * @param {string} [detail]
   * @param {Schema.Field} [fields]
   * @memberof TableCompletionItem
   */
  constructor(label: string, detail?: string, fields?: Schema.Field[]) {
    super(label, CompletionItemKind.File);
    this.detail = detail;
    if (fields) {
      const mkTable = new MarkdownString(`| Field | Type | \n |---|---| `);
      fields.forEach(field => mkTable.appendMarkdown(`\n | ${field.name} | ${field.type} |`));
      this.documentation = mkTable;
    }
  }
}

class ColumnCompletionItem extends CompletionItem {
  constructor(label: string, detail?: string) {
    super(label, CompletionItemKind.Field);
    this.detail = detail;
  }
}
