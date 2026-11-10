-- Synthetic history: completed provider calls whose local end timestamps are absent.
insert into icash_call_recordings(id,account_id,operation_key,agent_id,contact_key,state,call_sid)
 select md5('recording-'||g)::uuid,'00000000-0000-4000-8000-000000000001','history:'||g,'agent','contact:'||g,'active','CA'||g
 from generate_series(1,10000) g;
insert into icash_recorded_gate_terminal_receipts(recording_id,account_id,call_sid,receipt)
 select id,account_id,call_sid,jsonb_build_object('status','completed') from icash_call_recordings where operation_key like 'history:%';
-- Active and unknown rows must survive the history prefilter.
insert into icash_call_recordings(id,account_id,operation_key,agent_id,contact_key,state,call_sid)
 values('00000000-0000-4000-8000-000000099998','00000000-0000-4000-8000-000000000001','active:fixture','agent','active','active','CAactive'),
 ('00000000-0000-4000-8000-000000099999','00000000-0000-4000-8000-000000000001','unknown:fixture','agent','unknown','failed',null);
analyze;
