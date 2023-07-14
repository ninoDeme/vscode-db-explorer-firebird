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

        this.text = this.text.replace(/--.*|\/\*[\s\S]*\*\//g, '');

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
    }
    constructor(parser: Parser, start?: number) {
        super(parser, start);
    }
}

function statement(parser: Parser, start: number = parser.index) {
    consumeWhiteSpace(parser);
    const currText = this.parser.currText;
    if (/^select/i.test(currText)) {
        return new SelectStatement(parser, start);
    }
    else if (/^(;|$)/.test(currText)) {
        return new EmptyStatement(this.parser);
    }
    // TODO: Error type that contains position data
    throw new Error('Invalid Statement');
}

// https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html#fblangref40-dml-select
class SelectStatement extends Statement {
    
    parse = function() {
        consumeWhiteSpace(this.parser);
        const currText = this.parser.currText;
        if (/^(\([\s\S]*?\)|[\s\S])+?(?=\s*,|\s+from)/i.test(currText)) {
            this.parser.state.push(new SelectExpression(this.parser));
            return;
        }
        const end = this.parser.currText.match(/^[\s\S]*?(?=;|$)/)[0];
        if (end != null) {
            this.parser.index += end.length;
            this.text = end;
            this.end = this.parser.index;
            this.flush();
        }
    };

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

    parse = () => {
        consumeWhiteSpace(this.parser);
        const expr = this.parser.currText.match(/^(\([\s\S]*?\)|[\s\S])+?(?=\s*,|\s+from)/i)[0];
        let currI = this.parser.index;
        let word = '';
        let cond = true;
        while (cond) {
            const char = this.parser.text[currI];
            
            word += char;
            if (word === '--') {
                currI += this.parser.text.substring(currI).indexOf('\n');
                continue;
            }
            if (/[\s,().]/.test(char)) {
                if (word === 'from') {
                    cond = false;
                }
            }
            if (char === ',') {
                cond = false;
            }
            currI++;
        }
        this.parser.index += expr.length;
        this.text = expr;
        this.end = this.parser.index;
        this.flush();
        if (/^\s*from/i.test(this.parser.currText)) {
            this.parser.state.push(new FromState(this.parser));
        }

    };
}

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

interface Limit  {
    startRow: number | null;
    endRow: number | null;
}

const reservedWords = [
    'ADD',
    'ADMIN',
    'ALL',
    'ALTER',
    'AND',
    'ANY',
    'AS',
    'AT',
    'AVG',
    'BEGIN',
    'BETWEEN',
    'BIGINT',
    'BINARY',
    'BIT_LENGTH',
    'BLOB',
    'BOOLEAN',
    'BOTH',
    'BY',
    'CASE',
    'CAST',
    'CHAR',
    'CHARACTER',
    'CHARACTER_LENGTH',
    'CHAR_LENGTH',
    'CHECK',
    'CLOSE',
    'COLLATE',
    'COLUMN',
    'COMMENT',
    'COMMIT',
    'CONNECT',
    'CONSTRAINT',
    'CORR',
    'COUNT',
    'COVAR_POP',
    'COVAR_SAMP',
    'CREATE',
    'CROSS',
    'CURRENT',
    'CURRENT_CONNECTION',
    'CURRENT_DATE',
    'CURRENT_ROLE',
    'CURRENT_TIME',
    'CURRENT_TIMESTAMP',
    'CURRENT_TRANSACTION',
    'CURRENT_USER',
    'CURSOR',
    'DATE',
    'DAY',
    'DEC',
    'DECFLOAT',
    'DECIMAL',
    'DECLARE',
    'DEFAULT',
    'DELETE',
    'DELETING',
    'DETERMINISTIC',
    'DISCONNECT',
    'DISTINCT',
    'DOUBLE',
    'DROP',
    'ELSE',
    'END',
    'ESCAPE',
    'EXECUTE',
    'EXISTS',
    'EXTERNAL',
    'EXTRACT',
    'FALSE',
    'FETCH',
    'FILTER',
    'FLOAT',
    'FOR',
    'FOREIGN',
    'FROM',
    'FULL',
    'FUNCTION',
    'GDSCODE',
    'GLOBAL',
    'GRANT',
    'GROUP',
    'HAVING',
    'HOUR',
    'IN',
    'INDEX',
    'INNER',
    'INSENSITIVE',
    'INSERT',
    'INSERTING',
    'INT',
    'INT128',
    'INTEGER',
    'INTO',
    'IS',
    'JOIN',
    'LATERAL',
    'LEADING',
    'LEFT',
    'LIKE',
    'LOCAL',
    'LOCALTIME',
    'LOCALTIMESTAMP',
    'LONG',
    'LOWER',
    'MAX',
    'MERGE',
    'MIN',
    'MINUTE',
    'MONTH',
    'NATIONAL',
    'NATURAL',
    'NCHAR',
    'NO',
    'NOT',
    'NULL',
    'NUMERIC',
    'OCTET_LENGTH',
    'OF',
    'OFFSET',
    'ON',
    'ONLY',
    'OPEN',
    'OR',
    'ORDER',
    'OUTER',
    'OVER',
    'PARAMETER',
    'PLAN',
    'POSITION',
    'POST_EVENT',
    'PRECISION',
    'PRIMARY',
    'PROCEDURE',
    'PUBLICATION',
    'RDB$DB_KEY',
    'RDB$ERROR',
    'RDB$GET_CONTEXT',
    'RDB$GET_TRANSACTION_CN',
    'RDB$RECORD_VERSION',
    'RDB$ROLE_IN_USE',
    'RDB$SET_CONTEXT',
    'RDB$SYSTEM_PRIVILEGE',
    'REAL',
    'RECORD_VERSION',
    'RECREATE',
    'RECURSIVE',
    'REFERENCES',
    'REGR_AVGX',
    'REGR_AVGY',
    'REGR_COUNT',
    'REGR_INTERCEPT',
    'REGR_R2',
    'REGR_SLOPE',
    'REGR_SXX',
    'REGR_SXY',
    'REGR_SYY',
    'RELEASE',
    'RESETTING',
    'RETURN',
    'RETURNING_VALUES',
    'RETURNS',
    'REVOKE',
    'RIGHT',
    'ROLLBACK',
    'ROW',
    'ROWS',
    'ROW_COUNT',
    'SAVEPOINT',
    'SCROLL',
    'SECOND',
    'SELECT',
    'SENSITIVE',
    'SET',
    'SIMILAR',
    'SMALLINT',
    'SOME',
    'SQLCODE',
    'SQLSTATE',
    'START',
    'STDDEV_POP',
    'STDDEV_SAMP',
    'SUM',
    'TABLE',
    'THEN',
    'TIME',
    'TIMESTAMP',
    'TIMEZONE_HOUR',
    'TIMEZONE_MINUTE',
    'TO',
    'TRAILING',
    'TRIGGER',
    'TRIM',
    'TRUE',
    'UNBOUNDED',
    'UNION',
    'UNIQUE',
    'UNKNOWN',
    'UPDATE',
    'UPDATING',
    'UPPER',
    'USER',
    'USING',
    'VALUE',
    'VALUES',
    'VARBINARY',
    'VARCHAR',
    'VARIABLE',
    'VARYING',
    'VAR_POP',
    'VAR_SAMP',
    'VIEW',
    'WHEN',
    'WHERE',
    'WHILE',
    'WINDOW',
    'WITH',
    'WITHOUT',
    'YEAR',
];