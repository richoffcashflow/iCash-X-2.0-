import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {isCarrierTextNotice} from '../lib/carrier-text-notice.ts';
const source=readFileSync(new URL('../config/carrier-text-notice-classification.sql',import.meta.url),'utf8');
const definition=source.slice(source.indexOf('create function public.icash_is_carrier_text_notice'),source.indexOf('$fn$;',source.indexOf('create function public.icash_is_carrier_text_notice'))+6);
const notice='Free Msg: Receiver 12125550123 unable to receive message - Message Blocking is active';
const cases=[
 [notice.replace('Blocking','BlocKing'),[],false],[notice.replace('Msg','Mſg'),[],false],
 [notice.replaceAll(' ','\u00a0'),[],false],[notice.replaceAll(' ','\ufeff'),[],false],['\u00a0'+notice+'\u00a0',[],false],['\ufeff'+notice+'\ufeff',[],false],['\t\r\f\v'+notice+'\n',[],true],[notice,[],true],[notice+'.',[],true],['  free msg: Receiver +12125550123 unable\nto receive message - Message Blocking is active!\n',[],true],
 ['Free Msg: Receiver unable to receive message - Message Blocking is active',[],false],['Free Msg: Message Blocking is active',[],false],
 [null,[],false],['',[],false],[notice,null,false],[notice,[{url:'https://example.invalid/photo.jpg'}],false],
 ['I got "'+notice+'". Can you call me?',[],false],['"'+notice+'"',[],false],[notice+' I want to sell.',[],false],
 ['Message Blocking is active',[],false],['Free Msg: Unknown service notice',[],false],['Free Msg: Message Blocking is inactive',[],false],
 ['Free Msg: Receiver 123 unable to receive message - Message Blocking is active',[],false],
 ['STOP',[],false],[notice+' STOP contacting me',[],false],['I would sell for $200,000.',[],false],['Yes',[],false],
 ['I fixed message blocking. Text me about the house.',[],false],['Unable to receive message yesterday, but I can now.',[],false]
];
const pg=await PGlite.create();
try{
 await pg.exec(definition);
 for(const [body,attachments,expected] of cases){
  assert.equal(isCarrierTextNotice(body,attachments),expected,String(body));
  const {rows}=await pg.query('select icash_is_carrier_text_notice($1,$2) result',[body,attachments]);
  assert.equal(rows[0].result,expected,String(body));
 }
 console.log(`Carrier notice classification: ${cases.length} exact SQL/TypeScript parity cases passed; quotes, mixed prose, attachments, STOP and unknown formats preserved.`);
}finally{await pg.close();}
