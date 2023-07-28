import {Range, TextDocument, Position, DiagnosticSeverity} from 'vscode';
import {logger} from '../logger/logger';
import {RESERVED_WORDS} from './symbols';

class BaseToken implements Token {
    text: string;
    start: number;
    end: number;
    constructor(token?: Partial<Token>, parser?: Parser) {
        this.start = token.start;
        this.end = token.end;
        this.text = token.text ?? parser.text.substring(this.start, this.end);
    }
}

export class Parser {
    
    state: State[] = [];
    parsed: BaseState[] = [];
    text: string;
    index: number = 0;
    comments: BaseToken[] = [];

    problems: Problem[] = [];

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
        return this.parsed;
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
    parse() {
        throw new Error('not implemented');
    }   
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

    subQuery: boolean;

    flush(state?: State) {
        this.parser.state.splice(this.parser.state.findIndex(el => el === state ?? this, 1))[0];
        this.parser.parsed.push(this);
        if (this.parser.index < this.parser.text.length && this.parser.state.length === 0) {
            this.parser.state.push(statement(this.parser));
        }
    }
    constructor(parser: Parser, start?: number, subQuery?: boolean) {
        super(parser, start);
        this.subQuery = !!subQuery;
    }
}

function nextToken(parser: Parser): {start: number, end: number} {
    const token = parser.currText.match(new RegExp(/^\S*/))?.[0];
    return {start: parser.index, end: parser.index + token.length};
}

function nextTokenError(parser: Parser, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
    parser.problems.push({
        ...nextToken(parser),
        message,
        severity
    });
}

function statement(parser: Parser, start: number = parser.index, subQuery?: boolean): Statement {
    consumeWhiteSpace(parser);
    consumeComments(parser);
    const currText = parser.currText;
    if (/^select/i.test(currText)) {
        return new SelectStatement(parser, start);
    }
    else if (/^(;|$)/.test(currText) || subQuery && /^\)/.test(currText)) {
        return new EmptyStatement(parser);
    }
    return new UnknownStatement(parser, start);
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select
class SelectStatement extends Statement {
    
    parse = () => {
        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);
        const currText = this.parser.currText;
        if (/^first\s/i.test(currText)) {
            if (this.columnList.length > 0) {
                nextTokenError(this.parser, '"FIRST" must come before column list');
            }
            if (this.skip) {
                nextTokenError(this.parser, '"FIRST" must be before "SKIP"');
            } 
            if (this.first) {
                nextTokenError(this.parser, 'Duplicate "FIRST" statement');
            }
            this.first = new SelectFirst(this.parser);
        } else if (/^skip\s/i.test(currText)) {
            if (this.columnList.length > 0) {
                nextTokenError(this.parser, '"SKIP" must come before column list');
            }
            if (this.skip) {
                nextTokenError(this.parser, 'Duplicate "SKIP" statement');
            }
            this.skip = new SelectSkip(this.parser);
        } else if (/^from\s/i.test(currText)) {
            if (this.columnList.length === 0) {
                this.parser.problems.push({
                    start: this.parser.index,
                    end: this.parser.index,
                    message: 'No Columns in "SELECT" statement'
                });
            }
            const newFrom = new FromState(this.parser);
            this.parser.state.push(newFrom);
            this.from = newFrom;
        } else {
            let end = this.parser.currText.match(/^[\s]*?(;|$)/)?.[0];
            if (this.subQuery) {
                if (end != null) {
                    this.parser.problems.push({
                        start: this.start,
                        end: this.start + end.length,
                        message: 'Unclosed Subquery',
                    });
                } else {
                    end = this.parser.currText.match(/^[\s]*?\)/)?.[0];
                }
            }
            if (end != null) {
                if (!this.from) {
                    this.parser.problems.push({
                        start: this.start,
                        end: this.parser.index + end.length,
                        message: 'Missing "FROM" expression in "SELECT" statement',
                    });
                }
                this.parser.index += end.length;
                this.end = this.parser.index;
                this.text = this.parser.text.substring(this.start, this.end);
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

    constructor(parser: Parser, start?: number, subQuery?: boolean) {
        super(parser, start, subQuery);
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
                parser.problems.push({
                    start: parser.index,
                    end: parser.index+1,
                    message: 'Unclosed parenthesis'
                });
            }
            delimiter = parser.currText.slice(0, index);
            end = parser.index + index;
        } else if (parser.currText.startsWith(':')) {
            parser.index++;
            const identifier = parser.currText.match(new RegExp(`^${REGULAR_IDENTIFIER}(?=\\s|;)`))?.[0] ?? '';
            if (!identifier) {
                const token = parser.currText.match(/^\S*?/)?.[0] ?? '';
                parser.problems.push({
                    start: parser.index-1,
                    end: parser.index + token.length,
                    message: `Invalid Parameter: :${token}`
                });
            }
            delimiter = `:${identifier}`;
            end = parser.index + delimiter.length;
        } else {
            delimiter = parser.currText.match(/^\S+/)?.[0];
            if (!isNaN(parseInt(delimiter))) {
                if (parseInt(delimiter) < 0) {
                    parser.problems.push({
                        start: parser.index-1,
                        end: parser.index + delimiter.length,
                        message: "Argument can't be negative"
                    });
                }
                end = parser.index + delimiter.length;
            } else if (delimiter === '?') {
                end = parser.index + delimiter.length;
            } else {
                parser.problems.push({
                    start: parser.index-1,
                    end: parser.index + delimiter.length,
                    message: `Invalid Token: ${delimiter}`
                });
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

class UnknownStatement extends Statement {
    parse() {
        const token = this.parser.currText.match(new RegExp(`^${REGULAR_IDENTIFIER}`))?.[0];
        const fullStatement = this.parser.currText.match(new RegExp(`[\\s\\S]+?(;|$${this.subQuery ? '|\\)' : ''})`))?.[0];
        this.end = fullStatement.length;
        this.text = this.parser.text.substring(this.start, this.end);
        this.parser.problems.push({
            start: this.start,
            end: this.end,
            severity: DiagnosticSeverity.Error,
            message: `Unknown Statement Type: ${token}`
        });
        this.flush();
    }
}

class SelectExpression extends BaseState {
    static match = /^[\s\S]+?(?=,|\s+from)/i;

    public tokens: any[] = [];
    public parent: SelectStatement;

    parse() {
        consumeWhiteSpace(this.parser);
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
            } else if (word === 'from') {
                cond = false;
                currI -= 4;
                break;
            } else if (char === ',') {
                cond = false;
            }
            if (/\s|;|\)|^$/.test(char) || cond === false) {
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
        if (this.tokens.length === 0) {
            this.parser.problems.push({
                start: this.start,
                end: this.end,
                severity: DiagnosticSeverity.Error,
                message: `Empty Column Expression`
            });
        }
        this.flush();
    }

    flush() {
        this.parser.state.splice(this.parser.state.findIndex(el => el === this, 1));
    }

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

    parse() {
        // TODO: Parse Join
        throw new Error('not implemented');
    } 

    flush() {
        this.parent.joins.push(this);
        super.flush();
    }
}

const REGULAR_IDENTIFIER = '[A-z][\\w$]{0,62}';

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select-from
class FromState extends BaseState {

    joins: JoinFrom[] = [];

    source: Table;
    parse() {
        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);

        if (/^(natural|join|inner|left|right|full)\s/i.test(this.parser.currText)) {
            this.parser.state.push(new JoinFrom(this.parser, this));
        } else if (this.joins.length || this.source) {
            this.end = this.parser.index;
            this.text = this.parser.text.substring(this.start, this.end);
            this.flush();
        } else {
            const source = table(this.parser);
            this.parser.state.push(source);
            this.source = source;
        }
    }

    constructor(parser: Parser) {
        super(parser);
        this.parser.index += 'from'.length;
    }
}

function table(parser: Parser) {
    consumeWhiteSpace(parser);
    consumeComments(parser);
    const currText = parser.currText;
    if (new RegExp(`^${REGULAR_IDENTIFIER}\\s*?\\(.*?\\)`).test(currText)) {
        return new Procedure(parser);
    }
    else if (currText.startsWith('(')) {
        return new DerivedTable(parser);
    } else if (new RegExp(`^${REGULAR_IDENTIFIER}(\\s|;|$)`).test(currText)) {
        return new BaseTable(parser);
    }
    nextTokenError(parser, 'Invalid Token');
    return new UnknownTable(parser);
}

class BaseTable extends BaseState implements Table  {
    name: string;
    alias?: string;

    parse() {
        const token = this.parser.currText.match(new RegExp(`^${REGULAR_IDENTIFIER}`))?.[0];
        this.start = this.parser.index;
        this.name = token;
        this.parser.index += token.length;

        this.parseAlias();

        this.flush();
    }

    parseAlias() {

        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);

        let hasAS = false;
        if (this.parser.currText.match(/^as\s/i)) {
            this.parser.index += 2;
            consumeWhiteSpace(this.parser);
            consumeComments(this.parser);
            hasAS = true;
        }

        const token = this.parser.currText.match(new RegExp(`^${REGULAR_IDENTIFIER}`))?.[0];

        if (token && !RESERVED_WORDS.includes(token.toUpperCase())) {
            this.alias = token;
        } else {
            if (hasAS) {
                this.parser.problems.push({
                    start: this.parser.index,
                    end: this.parser.index + token.length,
                    message: `Invalid alias, ${token} is a reserved keyword`
                });
                this.alias = token;
            }
        }
        this.parser.index += (this.alias ?? '').length;
    }
}

class UnknownTable extends BaseTable {
    parse() {
        const token = this.parser.currText.match(new RegExp(`^[^;|\\s]`))?.[0];
        this.start = this.parser.index;
        this.name = token;
        this.parser.index += token.length;

        this.parseAlias();

        this.flush();
    }

    parseAlias() {

        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);

        let hasAS = false;
        if (this.parser.currText.match(/^as\s/i)) {
            this.parser.index += 2;
            consumeWhiteSpace(this.parser);
            consumeComments(this.parser);
            hasAS = true;
        }

        const token = this.parser.currText.match(new RegExp(`^[^;|\\s]`))?.[0];

        if (token && !RESERVED_WORDS.includes(token.toUpperCase())) {
            if (hasAS) {
                this.parser.problems.push({
                    start: this.parser.index,
                    end: this.parser.index + token.length,
                    message: `Invalid alias, ${token} is a reserved keyword`
                });
            }
            this.alias = token;
        }
    }
}

class DerivedTable extends BaseTable implements State {
    select: SelectStatement;
    parser: Parser;

    parse() {
        consumeWhiteSpace(this.parser);
        consumeComments(this.parser);
        if (this.select) {
            if (this.parser.currText.startsWith(')')) {
                this.parser.index++;
                this.end = this.parser.index;
                this.text = this.parser.text.substring(this.start, this.end);
                this.flush();
            } else {
                throw new Error('Unknown Token');
            }
        }
    }
}

class Procedure extends BaseTable {
    args: Token[];

    parser: Parser;

    parse() {
        throw new Error('not implemented');
    }

}

interface Table {
    name: string;
    alias?: string;
}

interface State {
    parser: Parser;
    parse: () => void;
    flush: () => void;
}

interface Token {
    text: string;
    start: number;
    end: number;
}

interface Problem {
    start: number;
    end: number;
    message: string;
    severity?: DiagnosticSeverity
}
