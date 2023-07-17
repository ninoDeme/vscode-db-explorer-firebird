import {Range, TextDocument, Position} from 'vscode';
import {logger} from '../logger/logger';

export class Parser {
    
    state: State[] = [];
    parsed: BaseState[] = [];
    text: string;
    index: number = 0;

    get currText() {
        return this.text.substring(this.index);
    }

    parse(sql: TextDocument) {

        this.text = sql.getText();

        // this.text = this.text.replace(/--.*|\/\*[\s\S]*\*\//g, '');

        this.index = 0;
        this.state = [statement(this)];

        while (this.state.length > 0) {
            this.next();
        }

        return;
    }
    
    next() {
        this.state[this.state.length - 1].parse();
    }


    
}

function getCharAt(pos: Position, document: TextDocument) {
    return document.getText(new Range(pos, pos.with(0, 1)));
}

function consumeWhiteSpace(parser: Parser) {
    const whitespace = parser.text.match(/^\s+/);
    parser.index += whitespace?.[0].length ?? 0;
}

class BaseState implements State, Token {
    parser: Parser;
    static match: RegExp;
    parse: () => void;   
    flush(state?: State) {
        this.parser.state.splice(this.parser.state.findIndex(el => el === state ?? this, 1));
    }
    text!: string;
    start!: number;
    end!: number;
    constructor(parser: Parser, start?: number) {
        this.parser = parser;
        this.start = start ?? parser.index;
    }
}

class Statement extends BaseState {

    flush(state?: State) {
        this.parser.state.splice(this.parser.state.findIndex(el => el === state ?? this, 1))[0];
        this.parser.parsed.push(this);
        if (this.parser.index < this.parser.text.length && this.parser.state.length === 0) {
            this.parser.state.push(statement(this.parser));
        }
    }
    constructor(parser: Parser, start?: number) {
        super(parser, start);
    }
}

function statement(parser: Parser, start: number = parser.index) {
    consumeWhiteSpace(parser);
    const currText = parser.currText;
    if (/^select/i.test(currText)) {
        return new SelectStatement(parser, start);
    }
    else if (/^(;|$)/.test(currText)) {
        return new EmptyStatement(parser);
    }
    // TODO: Error type that contains position data
    throw new Error('Invalid Statement');
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select
class SelectStatement extends Statement {
    
    parse = function() {
        consumeWhiteSpace(this.parser);
        const currText = this.parser.currText;
        if (/^from\s/i.test(currText)) {
            const newFrom = new FromState(this.parser);
            this.parser.state.push(newFrom);
            this.from = newFrom;
            return;
        }
        const end = this.parser.currText.match(/^[\s]*?(?=;|$)/)?.[0];
        if (end != null) {
            if (!this.from) {
                throw new Error('Missing FROM statement');
            }
            this.parser.index += end.length;
            this.text = end;
            this.end = this.parser.index;
            this.flush();
        } else {
            const newColumn = new SelectExpression(this.parser);
            this.parser.state.push(newColumn);
            this.columnList.push(newColumn);
            return;
        }
    };

    columnList: SelectExpression[] = [];

    from: FromState;

    constructor(parser: Parser, start?: number) {
        super(parser, start);
        this.parser.index += 'select'.length;
    }
}

class BaseLimitToken implements Limit, Token {
    startRow: number;
    endRow: number;
    text: string;
    start: number;
    end: number;
    constructor(limit: Limit, token: Token) {
        this.startRow = limit.startRow;
        this.endRow = limit.startRow;
        this.text = token.text;
        this.start = token.start;
        this.end = token.end;
    }
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-first-skip
class SelectFirst extends BaseLimitToken {}
class SelectSkip extends BaseLimitToken {}
// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-offsetfetch
class SelectOffset extends BaseLimitToken {}
class SelectFetch extends BaseLimitToken {}

class EmptyStatement extends Statement {
    parse = () => {
        this.parser.index++;
        this.end = this.parser.index;
        this.text = this.parser.text.substring(this.start, this.end);
        this.flush();
        if (this.parser.index < this.parser.text.length) {
            this.parser.state.push(new Statement(this.parser));
        }
    };

    constructor(parser: Parser, start?: number) {
        super(parser, start);
        this.parser.index++;
    }
}

class SelectExpression extends BaseState {
    static match = /^[\s\S]+?(?=,|\s+from)/i;

    tokens: any[] = [];

    parse = () => {
        consumeWhiteSpace(this.parser);
        // const expr = this.parser.currText.match(/^(\([\s\S]*?\)|[\s\S])+?(?=\s*,|\s+from)/i)[0];
        let currI = this.parser.index;
        let word = '';
        let cond = true;
        while (cond && currI < this.parser.text.length) {
            const char = this.parser.text[currI];

            if (char === '(') {
                let currChar = '(';
                while(currChar !== ')') {
                    currI++;
                    currChar = this.parser.text[currI];
                }
            }
            if (word === '--') {
                const lineEnd = this.parser.text.indexOf('\n', currI);
                if (lineEnd === -1) {
                    currI = this.parser.text.length;
                } else {
                    currI += lineEnd;
                }
                continue;
            }
            if (char === ',') {
                cond = false;
            }
            if (word === 'from') {
                cond = false;
                currI -= 4;
                break;
            }
            if (/\s/.test(char)) {
                if (/\S/.test(word)) {
                    this.tokens.push(word);
                }
                word = '';
            } else {
                word += char;
            }
            currI++;
        }
        const expr = this.parser.text.substring(this.parser.index, currI);
        this.parser.index += expr.length;
        this.text = expr;
        this.end = this.parser.index;
        this.flush();
    };

    flush = () => {
        this.parser.state.splice(this.parser.state.findIndex(el => el === this, 1));
    };
}

const REGULAR_IDENTIFIER = /^[A-z][\w$]{0,62}/;

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-from
class FromState extends BaseState {

    parse = () => {
        consumeWhiteSpace(this.parser);
        const expr = this.parser.currText.match(/^[\s\S]*?(?=;|$)/)[0];
        this.parser.index += expr.length;
        this.text = expr;
        this.end = this.parser.index;
        this.flush();
    };
}

interface State {
    parser: Parser;
    parse: () => void;
}

interface Token {
    text: string;
    start: number;
    end: number;
}

class BaseToken implements Token {
    text: string;
    start: number;
    end: number;
    constructor(token: Token) {
        this.text = token.text;
        this.start = token.start;
        this.end = token.end;
    }
}

interface Limit  {
    startRow: number | null;
    endRow: number | null;
}
