-- Only future title replies use the corrected exception classifier. The runner
-- owns this transaction and its migration-history receipt; no old row is reset.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $migration$
declare definition text; after_definition text; before_metadata jsonb; after_metadata jsonb;
 old_body text:=$old$ body:=split_part(replace(new.body_text,E'\r',''),E'\n>',1);
 body:=split_part(body,E'\nFrom:',1);body:=split_part(body,E'\nOn ',1);$old$;
 new_body text:=$new$ -- Interpret current unquoted text only; retain the complete original reply.
 body:='';
 for reason in select regexp_split_to_table(replace(new.body_text,E'\r',''),E'\n') loop
  exit when reason ~* '^\s*(On .+wrote:|From:|Sent:|Begin forwarded message:|--\s*$)';
  continue when reason ~* '^\s*>';
  body:=body||E'\n'||reason;
 end loop;
 body:=replace(replace(body,'’',''''),'‘','''');
 reason:=null;$new$;
 old_payment text:=$old$(new|changed|updated|replace|different).{0,70}(wire|bank|routing|account|payee)$old$;
 new_payment text:=$new$(new|change|changed|updated|replace|different).{0,70}(wire|bank|routing|account|payee)$new$;
 old_issue text:=$old$ elsif body ~* '\m(dispute|lien|probate|lawsuit|legal review|attorney review|human|real person)\M' then reason:='title_issue';
 else return new;end if;$old$;
 new_issue text:=$new$ else
  -- Suppress only a complete current message of recognized negative assertions
  -- and narrow salutations. Any other text retains the original issue hold;
  -- an unfamiliar qualifier must never disappear between sentence/line splits.
  if body ~* '\m(disputes?|liens?|probate|lawsuits?|legal reviews?|attorney reviews?|humans?|real persons?)\M' and exists(
   select 1 from regexp_split_to_table(body,E'[\n.!;]+') part
   where btrim(part)<>''
   and btrim(part) !~* '^(hello|hi|good morning|good afternoon|good evening|thanks|thank you|regards|best regards),?$'
   and btrim(part) !~* $negative$^((there (is|are) no (disputes?|liens?|lawsuits?))|(there (is not|isn't|are not|aren't) (a |any )?(disputes?|liens?|lawsuits?))|(no (disputes?|liens?|lawsuits?)( (is|are|was|were|has been|have been))? (present|found|identified|recorded|pending))|(no (probate|legal reviews?|attorney reviews?|humans?|real persons?)( (is|are))? (needed|required))|((a )?(probate|legal reviews?|attorney reviews?|humans?|real persons?) (is not|isn't|are not|aren't) (needed|required))|(we (do not|don't) (need|require) (a |an |any )?(disputes?|liens?|probate|lawsuits?|legal reviews?|attorney reviews?|humans?|real persons?)))$$negative$
  ) then reason:='title_issue';
  else return new;end if;
 end if;$new$;
begin
 select pg_get_functiondef(p.oid),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'config',p.proconfig,'acl',p.proacl::text)
 into definition,before_metadata from pg_proc p where p.oid='public.icash_closing_reply_review()'::regprocedure;
 if md5(definition) is distinct from 'e4b0354865c030ac2f1e08f83a585ba2' then raise exception 'Title reply review predecessor changed';end if;
 if before_metadata is distinct from jsonb_build_object('owner','postgres','definer',false,'volatility','v','parallel','u','config',array['search_path=""'],'acl','{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Title reply review metadata changed';end if;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1
 or (length(definition)-length(replace(definition,old_payment,'')))/length(old_payment)<>1
 or (length(definition)-length(replace(definition,old_issue,'')))/length(old_issue)<>1 then raise exception 'Title reply review source boundary changed';end if;
 execute replace(replace(replace(definition,old_body,new_body),old_payment,new_payment),old_issue,new_issue);
 select pg_get_functiondef(p.oid),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'config',p.proconfig,'acl',p.proacl::text)
 into after_definition,after_metadata from pg_proc p where p.oid='public.icash_closing_reply_review()'::regprocedure;
 if md5(after_definition) is distinct from '69845816123c51ef71cf746b10070521' then raise exception 'Title reply review result source changed';end if;
 if after_metadata is distinct from before_metadata then raise exception 'Title reply review metadata was not preserved';end if;
end $migration$;
