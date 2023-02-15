import {Range, TextDocument, Position, EndOfLine} from 'vscode';

export class Parser {
    parseString(sql: TextDocument) {

        const documentScope = new DocSymbol(sql);
        
        const newLineChr = sql.eol === EndOfLine.LF ? '\n' : '\r\n';
        const text = documentScope.getText().split(newLineChr);
        
        let currScope = documentScope;
        let currSymbol: keyword;
        text.forEach((line, lineIndex) => {

            let chrIndex = 0;
            currSymbol = new keyword(chrIndex, line);
            while(chrIndex < line.length) {
                if (line[chrIndex] === ' ') {
                    currSymbol.endChr = chrIndex;
                    currSymbol.endLine = lineIndex;
                    chrIndex++;
                    currScope.scope.push(currSymbol);
                    currSymbol = new keyword(chrIndex, line);
                    continue;
                }
                chrIndex++;
            }
            currSymbol.endChr = chrIndex;
            currSymbol.endLine = lineIndex;

            currScope.scope.push(currSymbol);
        });
        
        console.log(documentScope)

        /* const parseFunc: (currRange: Range, sql: DocSymbol, chr: number, pos: Position, parent: fbSymbol) => fbSymbol = (currRange, sql, chr, pos, parent) => {
            let newPos: Position;
            let newRange: Range;
            newPos = pos.translate(0, 1);
            newRange = currRange.with(undefined, newPos);
            console.log(sql.document.getText(newRange));
            if (sql.document.getText(newRange).includes('\n')) {
                newPos = pos.with(pos.line + 1, 0);
                if (sql.range.contains(newPos)) {
                    newRange = new Range(newPos, newPos);
                    parent.scope.push(...parseFunc(newRange, sql, chr + 1, newPos, parent).scope, new basicSymbol(currRange));
                    return parent;
                }
                parent.scope.push(new basicSymbol(currRange));
                return parent;
            }
            parent.scope.push(...parseFunc(newRange, sql, chr + 1, newPos, parent).scope);
            return parent;
        }; */
        
        return documentScope;
    }
}

function getCharAt(pos: Position, document: TextDocument) {
    return document.getText(new Range(pos, pos.with(0, 1)));
}
interface fbSymbol {
    getText: (document) => string,
    range: Range,
    type: string,
    scope: fbSymbol[],
}

class DocSymbol implements fbSymbol {
    getText() {
        return this._text = this._text ?? this.document.getText();
    }
    _text: string;
    range: Range;
    type: string = 'document';
    scope: fbSymbol[] = [];
    document: TextDocument;
    constructor(document: TextDocument) {
        this.document = document;
        this.range = new Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length - 1);
    }
}

class keyword implements fbSymbol {
    getText(document) {
        return this._text = this._text ?? document.getText(this.range);
    }
    _text: string;
    range: Range;
    label: string;
    startChr: number;
    startLine: number;
    endChr: number;
    endLine: number;
    type: string;
    scope: fbSymbol[] = [];
    constructor(startChr, startLine) {
        this.startChr = startChr;
        this.startLine = startLine;
    }
}

class escapeSequence extends keyword {
    type = 'escape';
}
