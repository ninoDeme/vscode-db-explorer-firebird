import {Range, TextDocument, Position} from 'vscode';
import {logger} from '../logger/logger';

class BaseToken implements Token {
    text: string;
    start: number;
    end: number;
    constructor(token: Partial<Token>) {
        this.text = token.text;
        this.start = token.start;
        this.end = token.end;
    }
}

export class Parser {
    
    state: State[] = [];
    parsed: BaseState[] = [];
    text: string;
    index: number = 0;
    comments: BaseToken[] = [];

    get currText() {
        return this.text.substring(this.index);
    }

    parse(sql: TextDocument) {

        try {

        this.text = sql.getText();

        // this.text = this.text.replace(/--.*|\/\*[\s\S]*\*\//g, '');

        this.index = 0;
        this.state = [statement(this)];

        while (this.state.length > 0) {
            this.next();
        }

        console.log(this.parsed);
        } catch (e) {
            console.error(e);
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
    const whitespace = parser.currText.match(/^\s+/);
    parser.index += whitespace?.[0].length ?? 0;
}

function consumeComments(parser: Parser) {
    let comment: RegExpMatchArray;
    do {
        comment = parser.currText.match(/^--.*|\/\*[\s\S]*?\*\//);
        if (comment?.[0].length) {
            parser.comments.push(new BaseToken({start: parser.index, end: parser.index + comment[0].length, text: comment[0]}));
            parser.index += comment[0].length;
            consumeWhiteSpace(parser);
        }
    } while (comment?.[0].length);
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
    consumeComments(parser);
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
    
    parse = () => {
        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);
        const currText = this.parser.currText;
        if (/^first\s/i.test(currText)) {
            if (this.columnList.length > 0) {
                throw new Error('First must come before column list');
            }
            if (this.skip) {
                throw new Error('"First" must be before "skip"');
            } 
            if (this.first) {
                throw new Error('Duplicate "first" statement');
            }
            this.first = new SelectFirst(this.parser);
        } else if (/^skip\s/i.test(currText)) {
            if (this.columnList.length > 0) {
                throw new Error('Skip must come before column list');
            }
            if (this.skip) {
                throw new Error('Duplicate "skip" statement');
            }
            this.skip = new SelectSkip(this.parser);
        } else if (/^from\s/i.test(currText)) {
            if (this.columnList.length === 0) {
                throw new Error('No Columns Provided');
            }
            const newFrom = new FromState(this.parser);
            this.parser.state.push(newFrom);
            this.from = newFrom;
        } else {
            const end = this.parser.currText.match(/^[\s]*?(;|$)/)?.[0];
            if (end != null) {
                if (!this.from) {
                    throw new Error('Missing FROM statement');
                }
                this.parser.index += end.length;
                this.text = end;
                this.end = this.parser.index;
                this.flush();
            } else {
                const newColumn = new SelectExpression(this.parser, this);
                this.parser.state.push(newColumn);
                this.columnList.push(newColumn);
            }
        }
    };

    columnList: SelectExpression[] = [];

    from: FromState;

    first?: SelectFirst;
    skip?: SelectSkip;

    constructor(parser: Parser, start?: number) {
        super(parser, start);
        this.parser.index += 'select'.length;
    }
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-first-skip
class FirstAndSkip extends BaseToken {
    delimiter: number | string;

    constructor(parser: Parser) {
        const start = parser.index;
        let end: number;
        parser.index += parser.currText.match(/^(first|skip)/i)?.[0].length;
        consumeWhiteSpace(parser);
        consumeComments(parser);
        let delimiter: string;
        if (parser.currText.startsWith('(')) {
            let index = 0;
            let depth = 0;
            for (const i of parser.currText) {
                index++;
                if (i === '(') {
                    depth++;
                } else if (i === ')') {
                    depth--;
                }
                if (depth === 0) break;
            }
            if (depth !== 0) {
                throw new Error('Mismatched parenthesis');
            }
            delimiter = parser.currText.slice(0, index);
            end = parser.index + index;
        } else if (parser.currText.startsWith(':')) {
            parser.index++;
            const identifier = parser.currText.match(REGULAR_IDENTIFIER)?.[0];
            if (!identifier) {
                throw new Error('Invalid Parameter');
            }
            delimiter = `:${identifier}`;
            end = parser.index + delimiter.length;
        } else {
            delimiter = parser.currText.match(/^\S+/)?.[0];
            if (!isNaN(parseInt(delimiter))) {
                if (parseInt(delimiter) < 0) {
                    throw new Error("Argument can't be negative");
                }
                end = parser.index + delimiter.length;
            } else if (delimiter === '?') {
                end = parser.index + delimiter.length;
            } else {
                throw new Error('invalid parameter');
            }
        }
        parser.index += delimiter.length;
        super({start, end, text: parser.text.substring(start, end)});
        this.delimiter = delimiter;
    }
}
class SelectFirst extends FirstAndSkip {
    // constructor(parser: Parser) {
    //     super(parser);
    // }
}
class SelectSkip extends FirstAndSkip {
    constructor(parser: Parser) {
        super(parser);
    }
}
// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-offsetfetch
// class SelectOffset extends BaseLimitToken {}
// class SelectFetch extends BaseLimitToken {}

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

    public tokens: any[] = [];
    public parent: SelectStatement;

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
                    currI = lineEnd;
                }
                word = '';
                continue;
            }
            if (word === '/*') {
                const commentEnd = this.parser.text.indexOf('*/', currI + 2);
                if (commentEnd === -1) {
                    currI = this.parser.text.length;
                } else {
                    currI = commentEnd;
                }
                word = '';
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
        if (this.tokens.length === 0) {
            throw new Error('Empty Column');
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

    constructor(parser: Parser, parent: SelectStatement) {
        super(parser);
        this.parent = parent;
    }
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-joins
class JoinFrom extends BaseState {

    parent: FromState;
    constructor(parser: Parser, parent: FromState) {
        super(parser);
        this.parent = parent;
    }

    parse = () => {
        // TODO: Parse Join
    }; 

    flush = () => {
        this.parent.joins.push(this);
        super.flush();
    };
}

const REGULAR_IDENTIFIER = /^[A-z][\w$]{0,62}/;

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-from
class FromState extends BaseState {

    // TODO From parse
    joins: JoinFrom[] = [];

    source: Table;
    parse = () => {
        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);
        if (/^(natural|join|inner|left|right|full)\s/i.test(this.parser.currText)) {
            this.parser.state.push(new JoinFrom(this.parser, this));
            return;
        }
        const end = this.parser.currText.match(/^[\s]*?(;|$)/)?.[0];
        if (end != null) {
            if (!this.source) {
                throw new Error('Missing source in FROM statement');
            }
            this.parser.index += end.length;
            this.text = end;
            this.end = this.parser.index;
            this.flush();
        } else {
            // table
        }
    };
}

class DerivedTable extends BaseToken {
    name: string;
    alias?: string;
    select: SelectStatement;
}

class BaseTable extends BaseToken {
    name: string;
    alias?: string;
}

class Procedure extends BaseToken {
    name: string;
    alias?: string;
    args: Token[];
}

interface Table {
    name: string;
    alias?: string;
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
