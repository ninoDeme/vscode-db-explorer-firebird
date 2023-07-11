import {Range, TextDocument, Position, EndOfLine} from 'vscode';
import {logger} from '../logger/logger';

export class Parser {
    
    state: State[] = [];
    parsed: Word[] = [];
    text: string;
    index: number = 0;

    parse(sql: TextDocument) {

        this.text = sql.getText();

        this.state = [new StatementStart(this)];
        this.parsed = [];

        while (this.index < this.text.length) {
            this.next();
        }

        return this.parsed;
    }
    
    next() {
        this.state[this.state.length - 1].parse();
    }
    
}

function getCharAt(pos: Position, document: TextDocument) {
    return document.getText(new Range(pos, pos.with(0, 1)));
}

interface State {
    parser: Parser;
    match: RegExp;
    parse: () => void;
}

class BaseState implements State {
    parser: Parser;
    match: RegExp;
    parse: () => void;   
    constructor(parser: Parser) {
        this.parser = parser;
    }
}

class StatementStart extends BaseState {

    match: RegExp = /^|\(|;\s*?/;
    parse = () => {
        const currText = this.parser.text.substring(this.parser.index);
        const select = currText.match(/^select/i)?.[0];
        if (select) {
            
            this.parser.index += select.length;
            this.parser.state.push(new SelectStatement(this.parser));
            return;
        }
    };
    
}

class SelectStatement extends BaseState {
    
    constructor(parser: Parser) {
        super(parser);
    }
}

class Word {
    static match: RegExp = /^|\(|;\s*?/;
    static parse: (parser: Parser) => void;

    word: string;
    start: number;
    end: number;
}