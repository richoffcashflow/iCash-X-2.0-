import assert from 'node:assert/strict';
import {assertDisposablePostgresTarget} from './helpers/disposable-postgres-target.mjs';

const fixture=()=>({
 connectionParameters:{host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability'},
 connection:{stream:{remoteAddress:'127.0.0.1',remotePort:55443}},
 queries:[],identity:{db:'icash_reliability',username:'postgres'},
 async query(sql){this.queries.push(sql);return {rows:[this.identity]};},
});
await assertDisposablePostgresTarget(fixture());
for(const [key,value] of [['host','192.0.2.10'],['host','localhost'],['port',5432],['database','postgres'],['user','service_role'],['password','different']]){
 const c=fixture();c.connectionParameters[key]=value;
 await assert.rejects(assertDisposablePostgresTarget(c));
 assert.equal(c.queries.length,0,'Reject changed connection parameters before any query');
}
for(const [key,value] of [['remoteAddress','192.0.2.10'],['remoteAddress',undefined],['remotePort',5432],['remotePort',undefined]]){
 const c=fixture();c.connection.stream[key]=value;
 await assert.rejects(assertDisposablePostgresTarget(c));
 assert.equal(c.queries.length,0,'Reject a foreign or unknown actual socket before any query');
}
for(const identity of [{db:'postgres',username:'postgres'},{db:'icash_reliability',username:'service_role'}]){
 const c=fixture();c.identity=identity;await assert.rejects(assertDisposablePostgresTarget(c));
 assert.deepEqual(c.queries,['select current_database() db,current_user username'],'Only a read-only identity query is allowed before rejection');
}
console.log('PASS disposable PostgreSQL target: fixed parameters, actual loopback socket, exact database/role and fail-closed negative cases.');
