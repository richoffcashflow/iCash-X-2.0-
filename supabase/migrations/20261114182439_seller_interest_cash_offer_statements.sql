-- Extend only explicit first-person interest statements. Price questions alone,
-- conditional requests, ownership and another property's interest remain out.
-- Original transcripts, contact evidence and whole-call refusal guards stay intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare d text;before_hash constant text:='d724e64cd2be5c56372422738c380cd1';after_hash constant text:='18f28005c86c49c6f15e69cd7bcc7c1d';
 old_pattern constant text:=$old$^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$$old$;
 new_pattern constant text:=$new$^((how much cash|what can you offer|what('s| is) your (cash )?offer|how much are you offering)[?] +)?(((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?|(i am|i'm|we are|we're) (interested in|open to) a cash offer( (on|for) (my|our|the) (house|home|property))?)[.! ,]*( +(how much cash|what can you offer|what('s| is) your (cash )?offer|how much are you offering)[?])?[.! ]*$$new$;
begin
 d:=pg_get_functiondef('icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)'::regprocedure);
 if md5(d)=after_hash then return;end if;
 if md5(d)<>before_hash then raise exception 'Seller interest statement prerequisite changed';end if;
 if (length(d)-length(replace(d,old_pattern,'')))/length(old_pattern)<>1 then
  raise exception 'Seller interest statement pattern changed';
 end if;
 execute replace(d,old_pattern,new_pattern);
 if md5(pg_get_functiondef('icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)'::regprocedure))<>after_hash then
  raise exception 'Seller interest statement installation mismatch';
 end if;
end $patch$;
commit;
