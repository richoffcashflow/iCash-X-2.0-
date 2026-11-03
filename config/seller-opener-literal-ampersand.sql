-- Preserve literal saved identity punctuation already counted as one GSM unit.
-- No normalization, longer copy, replay, price or contact-authority changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare item record;d text;original text;needle text:='[^A-Za-z0-9 .,!?]';replacement text:='[^A-Za-z0-9 .,!?&]';
begin
 for item in select * from(values
  ('icash_seller_identity_opener(text,text)','4da84d4880ec9f7ad128761e5358a5b4',1),
  ('icash_seller_recipient_opener(uuid,uuid,text,text,text)','447fff1b6f7f1e641df6e1e400fc7c67',1),
  ('icash_seller_opener_candidate_body(uuid,uuid)','57b038641afe4800048966a3ce6e3595',1),
  ('icash_queue_seller_opener(uuid,uuid)','95f6c8570b66d80578ca48347715fe12',2)
 ) expected(signature,checksum,occurrences) loop
  d:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  original:=replace(d,replacement,needle);
  if md5(original)<>item.checksum or (length(original)-length(replace(original,needle,'')))<>length(needle)*item.occurrences then
   raise exception 'Seller opener identity prerequisite changed: %',item.signature;
  end if;
  if d=replace(original,needle,replacement) then continue;end if;
  if d<>original then raise exception 'Partially updated seller opener identity: %',item.signature;end if;
  execute replace(original,needle,replacement);
 end loop;
end $patch$;
commit;

