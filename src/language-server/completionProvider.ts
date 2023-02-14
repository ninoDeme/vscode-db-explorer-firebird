import { CompletionItemProvider, TextDocument, CompletionItem, CompletionItemKind } from "vscode";
import { Schema, FirebirdSchema, FirebirdReserved } from "../interfaces";
import { firebirdReserved } from "./firebird-reserved";

interface SchemaProvider {
  provideSchema: (doc: TextDocument) => Thenable<FirebirdSchema>;
}

export class CompletionProvider implements CompletionItemProvider {
  constructor(private schemaProvider: SchemaProvider) {}

  provideCompletionItems(document: TextDocument) {
    return this.schemaProvider.provideSchema(document).then(schema => {
      let items = this.getCompletionItems(
        document,
        schema.reservedKeywords ? firebirdReserved : undefined,
        schema.tables.length > 0 ? schema.tables : undefined,
      );
      return items;
    });
  }

  private getCompletionItems(document: TextDocument, firebirdReserved?: FirebirdReserved[], tables?: Schema.Table[]) {
    let items: CompletionItem[] = [];
    if (firebirdReserved) {
      items = firebirdReserved.map(word => new KeywordCompletionItem(word));
    }
    if (tables) {
      let tableItems: TableCompletionItem[] = [];

      let columnItems: ColumnCompletionItem[] = [];
      
      let text = document.getText();
      
      tables.forEach(tbl => {
        let alias = (text.match(RegExp(`((from)|(join)) ${tbl.name} (as )?(?!(on)|=|(with)|(using)|(as))(?<alias>\\w+)`, 'i')))?.groups?.alias;
        columnItems.push(...tbl.fields.map(col => new ColumnCompletionItem(`${tbl.name}.${col.name}`)));
        tableItems.push(new TableCompletionItem(tbl.name));
        if (alias) {
          columnItems.push(...tbl.fields.map(col => new ColumnCompletionItem(`${alias}.${col.name}`, tbl.name)));
          tableItems.push(new TableCompletionItem(alias, tbl.name));
        }
      });
      items.push(...tableItems, ...columnItems);
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
  constructor(label: string, detail?: string) {
    super(label, CompletionItemKind.File);
    this.detail = detail;
  }
}

class ColumnCompletionItem extends CompletionItem {
  constructor(label: string, detail?: string) {
    super(label, CompletionItemKind.Field);
    this.detail = detail;
  }
}
