import assert from 'node:assert/strict';

const quoteIdentifier=value=>'"'+value.replaceAll('"','""')+'"';
const qualified=(schema,name)=>`${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
const scalar=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;

// Add only relation shapes needed by the captured financial functions. Existing
// fixture columns, constraints and triggers remain intact. Foreign keys are
// intentionally omitted for synthetic cross-domain rows; new checks and keys
// retain their captured definitions. The unrelated voice-target view is an
// empty table, so this fixture makes no claim about voice eligibility.
export async function installContinuedHandlerFinancialRelations(db,relations,financialFunctions){
 const exec=sql=>db.exec?db.exec(sql):db.query(sql);
 const clocks=financialFunctions.filter(entry=>/^[a-z_][a-z_0-9]*\.clock_now\(\)$/.test(entry.signature));
 const schemas=new Set([...relations.map(relation=>relation.schema),...clocks.map(entry=>entry.signature.split('.')[0])]);
 for(const schema of schemas)await exec(`create schema if not exists ${quoteIdentifier(schema)}`);
 // These are the captured production defaults, never a fixture clock stub.
 for(const entry of clocks){
  await exec(entry.definition);
  if(entry.md5)assert.equal(await scalar(db,'select md5(pg_get_functiondef($1::regprocedure)) as value',[entry.signature]),entry.md5,entry.signature);
 }

 for(const relation of relations){
  assert(relation.relkind==='r'||relation.relkind==='v',`Unsupported captured relation: ${relation.schema}.${relation.name}`);
  const name=qualified(relation.schema,relation.name);
  const exists=await scalar(db,'select to_regclass($1)::text as value',[name]);
  const present=exists?new Set((await db.query('select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped',[name])).rows.map(row=>row.attname)):new Set();
  const hasRows=exists?await scalar(db,`select exists(select 1 from ${name}) as value`):false;
  const columns=[];
  for(const column of relation.columns){
   if(present.has(column.name))continue;
   if(column.default?.startsWith('nextval(')){
    const sequence=column.default.match(/^nextval\('((?:[^']|'')+)'::regclass\)$/)?.[1].replaceAll("''","'");
    assert(sequence,`Unsupported sequence default: ${name}.${column.name}`);
    const parts=await scalar(db,'select parse_ident($1) as value',[sequence]);
    assert(parts.length===1||parts.length===2,`Invalid captured sequence: ${sequence}`);
    if(parts.length===2)await exec(`create schema if not exists ${quoteIdentifier(parts[0])}`);
    await exec('create sequence if not exists '+parts.map(quoteIdentifier).join('.'));
   }
   let definition=`${quoteIdentifier(column.name)} ${column.type}`;
   if(column.identity){
    assert(column.identity==='a'||column.identity==='d',`Unsupported identity: ${name}.${column.name}`);
    definition+=' generated '+(column.identity==='a'?'always':'by default')+' as identity';
   }else if(column.generated){
    assert(column.generated==='s'&&column.default,`Unsupported generated column: ${name}.${column.name}`);
    definition+=' generated always as ('+column.default+') stored';
   }else if(column.default!==null&&column.default!==undefined){
    definition+=' default '+column.default;
   }
   // Earlier owner fixtures may already contain synthetic rows. Only those
   // populated relations need nullable additions when no default can populate
   // the field; empty relations retain the captured nullability as well.
   if(column.not_null&&(!hasRows||column.default||column.identity))definition+=' not null';
   if(exists)await exec(`alter table ${name} add column ${definition}`);
   else columns.push(definition);
  }
  if(!exists){
   const constraints=(relation.constraints??[]).filter(constraint=>constraint.type!=='f').map(constraint=>{
    assert(['c','p','u'].includes(constraint.type),`Unsupported captured constraint: ${name}.${constraint.name}`);
    return `constraint ${quoteIdentifier(constraint.name)} ${constraint.definition}`;
   });
   await exec(`create table ${name} (${[...columns,...constraints].join(',')})`);
  }else{
   const constraints=(await db.query('select conname,contype,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=$1::regclass',[name])).rows;
   for(const constraint of relation.constraints??[]){
    if(constraint.type==='f')continue;
    assert(['c','p','u'].includes(constraint.type),`Unsupported captured constraint: ${name}.${constraint.name}`);
    if(constraints.some(current=>current.conname===constraint.name||current.definition===constraint.definition))continue;
    if(constraint.type==='p'&&constraints.some(current=>current.contype==='p'))continue;
    await exec(`alter table ${name} add constraint ${quoteIdentifier(constraint.name)} ${constraint.definition}`);
    constraints.push({conname:constraint.name,contype:constraint.type,definition:constraint.definition});
   }
  }
 }
}
