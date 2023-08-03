import * as Firebird from 'node-firebird';
import {Global} from '../shared/global';
import {getOptions} from '../config';
import {getTablesQuery, fieldsQuery} from '../shared/queries';
import {ConnectionOptions, Schema} from '../interfaces';
import {logger} from '../logger/logger';

type ResultSet = Array<any>;

export class KeywordsDb {
    public getSchema() {
        if (!Global.activeConnection) {
            return Promise.resolve({reservedKeywords: getOptions().codeCompletionKeywords, tables: []} as Schema.Database);
        } else if (!getOptions().codeCompletionDatabase) {
            return Promise.resolve({reservedKeywords: getOptions().codeCompletionKeywords, tables: []} as Schema.Database);
        } else {
            return this.build(Global.activeConnection, getOptions().codeCompletionKeywords, getOptions().maxTablesCount);
        }
    }

    build(conOptions: ConnectionOptions, codeCompletionKeywords: boolean, maxTablesCount: number): Thenable<Schema.Database> {
        return new Promise(resolve => {
            const schema = {
                reservedKeywords: codeCompletionKeywords,
                path: conOptions.database,
                tables: [],
            } as Schema.Database;
            const tableNames: string[] = [];

            this.execute(conOptions, getTablesQuery(maxTablesCount), resultSet => {
                if (!resultSet || resultSet.length === 0) {
                    return;
                }

                schema.tables = resultSet.map(row => {
                    tableNames.push(row.TABLE_NAME.trim());
                    return {
                        name: row.TABLE_NAME.trim(),
                        fields: [],
                    } as Schema.Table;
                });

                this.execute(conOptions, fieldsQuery(tableNames), (resultSet: ResultSetFields[]) => {
                    if (!resultSet || resultSet.length === 0) {
                        return;
                    }

                    const groupedResult: {[key: string]: ResultSetFields[]} = {};
                    resultSet.forEach((table) => (groupedResult[table.TBL.trim()] = [...(groupedResult[table.TBL.trim()] ?? []), table]));

                    for (const schemaTable of schema.tables) {
                        (groupedResult[schemaTable.name] ?? []).forEach(element => {
                            let field_type = element.FIELD_TYPE.trim();
                            if (field_type === 'VARCHAR') field_type = `${field_type}(${element.FIELD_LENGTH})`;
                            schemaTable.fields.push({
                                name: element.FIELD.trim(),
                                type: field_type,
                            } as Schema.Field);
                        });
                    }
                    resolve(schema);
                });
            });
        });
    }

    execute(conOptions: any, query: any, callback: (resultSet?: ResultSet, error?: Error) => void) {
        let resultSet: ResultSet;

        Firebird.attach(conOptions, function (err, db) {
            if (err) {
                logger.error(err.message);
            }
            db.query(query, [], function (err, result) {
                resultSet = result;
                db.detach(err => {
                    if (err) {
                        logger.error(err.message);
                    }
                });
                callback(resultSet, err);
            });
        });
    }
}

interface ResultSetFields {
  DFLT_VALUE: any;
  FIELD: string;
  FIELD_LENGTH: number;
  FIELD_TYPE: string;
  NOTNULL: string;
  POS: number;
  TBL: string;
}