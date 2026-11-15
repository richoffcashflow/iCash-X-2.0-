import assert from 'node:assert/strict';

// The socket's destination is authoritative for a published Docker port. The
// server may correctly report its container address and internal port instead.
export async function assertDisposablePostgresTarget(client){
 const p=client.connectionParameters??{};
 assert.deepEqual({host:p.host,port:p.port,user:p.user,database:p.database},
  {host:'127.0.0.1',port:55443,user:'postgres',database:'icash_reliability'},
  'Only the fixed disposable local connection parameters are allowed');
 assert(p.password==='isolated-fixture-only','The fixed disposable fixture password is required');
 const socket=client.connection?.stream;
 assert.deepEqual({host:socket?.remoteAddress,port:socket?.remotePort},
  {host:'127.0.0.1',port:55443},'The actual connected socket must reach the fixed loopback target');
 assert.deepEqual((await client.query('select current_database() db,current_user username')).rows[0],
  {db:'icash_reliability',username:'postgres'},'Only the disposable database and role may be reset');
}
