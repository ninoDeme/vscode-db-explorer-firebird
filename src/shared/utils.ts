import {SimpleCallback} from 'node-firebird';

export const simpleCallbackToPromise = (callbackFunction: ((arg0: SimpleCallback) => any)): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        callbackFunction((err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
};