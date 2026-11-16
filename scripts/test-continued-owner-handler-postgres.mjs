// Exact same actual-handler rehearsal as PGlite, on a fixed disposable native
// PostgreSQL target. Transport is synthetic; no external provider is contacted.
import {createRequire} from 'node:module';
import {rehearseContinuedOwnerHandler} from '../tests/helpers/continued-owner-handler-rehearsal.mjs';
import {rehearseContinuedCohortPerformance} from '../tests/helpers/continued-owner-cohort-performance.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];
const connect=async name=>{
 const db=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'continued-owner-handler-'+name,connectionTimeoutMillis:5000});
 clients.push(db);await db.connect();await assertDisposablePostgresTarget(db);
 await db.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return db;
};
try{
 const pg=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker');
 await pg.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 pg.exec=sql=>pg.query(sql);
 await rehearseContinuedOwnerHandler(pg,{afterHandoffInstall:()=>rehearseContinuedCohortPerformance({admin:pg,blocker,worker})});
 console.log('PASS native PostgreSQL continued original cohort and actual handler rehearsal.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await Promise.allSettled(clients.map(client=>client.end()));}
