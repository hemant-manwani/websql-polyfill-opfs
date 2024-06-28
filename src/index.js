import { SQLocal } from 'sqlocal';

(function(global) {
  if (global.openDatabase) {
    return; // Web SQL is already supported, no need for polyfill
  }

  global.openDatabase = function(name, version, displayName, estimatedSize, creationCallback) {
    const sqlocal = new SQLocal(name + '.sqlite3');
    const { transaction: sqlocalTransaction } = sqlocal;

    function Database() {
      this.version = version;
      this.name = name;
    }

    sqlocal.sql`PRAGMA synchronous = NORMAL`;
    sqlocal.sql`PRAGMA journal_mode = WAL`;

    Database.prototype.transaction = function(callback, errorCallback, successCallback) {
      let transactionQueue = [];
      let isExecuting = false;

      const tx = {
        executeSql: function(sqlStatement, args, onSuccess, onError) {
          return new Promise((resolve, reject) => {
            transactionQueue.push({
              sql: sqlStatement,
              args,
              onSuccess,
              onError,
              resolve,
              reject
            });
            if (!isExecuting) {
              executeNextInQueue();
            }
          });
        }
      };

      function executeNextInQueue() {
        if (transactionQueue.length === 0) {
          isExecuting = false;
          if (successCallback) {
            successCallback();
          }
          return;
        }

        isExecuting = true;
        const { sql: sqlStatement, args, onSuccess, onError, resolve, reject } = transactionQueue.shift();

        sqlocalTransaction((sql) => [sql(`${sqlStatement}`.split('?'), ...(args || []))])
          .then(([result]) => {
            const resultSet = {
              rows: {
                item: (i) => result[i],
                length: result.length
              },
              insertId: result.lastInsertRowid,
              rowsAffected: result.changes
            };

            if (onSuccess) {
              // We need to allow for nested calls to executeSql in the onSuccess callback
              Promise.resolve().then(() => onSuccess(tx, resultSet)).then(() => {
                resolve(resultSet);
                executeNextInQueue();
              }).catch(error => {
                if (onError) {
                  onError(tx, error);
                }
                reject(error);
                if (errorCallback) {
                  errorCallback(error);
                }
              });
            } else {
              resolve(resultSet);
              executeNextInQueue();
            }
          })
          .catch(error => {
            if (onError) {
              onError(tx, error);
            }
            reject(error);
            if (errorCallback) {
              errorCallback(error);
            }
          });
      }

      try {
        callback(tx);
      } catch (callbackError) {
        if (errorCallback) {
          errorCallback(callbackError);
        }
        return;
      }

      if (!isExecuting && transactionQueue.length > 0) {
        executeNextInQueue();
      }
    };

    const db = new Database();
    if (creationCallback) {
      creationCallback(db);
    }
    return db;
  };
})(typeof window !== 'undefined' ? window : global);