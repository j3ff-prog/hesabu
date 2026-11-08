-- Run after all migrations. Checks who can read and write support messages and push subscriptions.
\set ON_ERROR_STOP off
insert into auth.users values ('00000000-0000-0000-0000-0000000000b1','254711000001@tallify.app'),('00000000-0000-0000-0000-0000000000b2','254711000002@tallify.app'),('00000000-0000-0000-0000-0000000000b3','254711000003@tallify.app'),('00000000-0000-0000-0000-0000000000b4','254711000004@tallify.app');
insert into shops (id,name,owner_phone,created_by) values ('00000000-0000-0000-0000-00000000cc01','S1','','00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-00000000cc02','S2','','00000000-0000-0000-0000-0000000000b4');
insert into members (shop_id,user_id,role,name,phone) values
 ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b1','owner','Own','254711000001'),
 ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b2','attendant','Att','254711000002'),
 ('00000000-0000-0000-0000-00000000cc02','00000000-0000-0000-0000-0000000000b4','owner','Other','254711000004');
insert into platform_admins values ('00000000-0000-0000-0000-0000000000b3');
grant all on all tables in schema public to authenticated;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.try(sql text) returns text language plpgsql as $$ declare n int; begin execute sql; get diagnostics n = row_count; return 'ok:' || n; exception when others then return 'denied'; end $$;
grant execute on function pg_temp.try(text) to authenticated;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select 'RESULT owner can write support: ' || (pg_temp.try($$insert into support_messages (shop_id,user_id,body,sender) values ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b1','help me','Own')$$) = 'ok:1');
select 'RESULT owner cannot fake an admin reply: ' || (pg_temp.try($$insert into support_messages (shop_id,user_id,from_admin,body) values ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b1',true,'fake')$$) = 'denied');
select 'RESULT owner cannot write to another shop: ' || (pg_temp.try($$insert into support_messages (shop_id,user_id,body) values ('00000000-0000-0000-0000-00000000cc02','00000000-0000-0000-0000-0000000000b1','x')$$) = 'denied');
select 'RESULT owner sees 1 message: ' || ((select count(*) from support_messages) = 1);
select 'RESULT owner can save a push subscription: ' || (pg_temp.try($$insert into push_subscriptions (endpoint,user_id,shop_id,p256dh,auth) values ('https://e/1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000cc01','k','a')$$) = 'ok:1');
select 'RESULT owner cannot subscribe to another shop: ' || (pg_temp.try($$insert into push_subscriptions (endpoint,user_id,shop_id,p256dh,auth) values ('https://e/2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000cc02','k','a')$$) = 'denied');
select 'RESULT owner cannot be a null-shop subscriber: ' || (pg_temp.try($$insert into push_subscriptions (endpoint,user_id,shop_id,p256dh,auth) values ('https://e/3','00000000-0000-0000-0000-0000000000b1',null,'k','a')$$) = 'denied');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select 'RESULT attendant sees no support chat: ' || ((select count(*) from support_messages) = 0);
select 'RESULT attendant cannot write support: ' || (pg_temp.try($$insert into support_messages (shop_id,user_id,body) values ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b2','x')$$) = 'denied');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select 'RESULT other shop sees nothing of S1: ' || ((select count(*) from support_messages) = 0);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select 'RESULT admin sees all messages: ' || ((select count(*) from support_messages) = 1);
select 'RESULT admin can reply: ' || (pg_temp.try($$insert into support_messages (shop_id,user_id,from_admin,body,sender) values ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-0000000000b3',true,'hello','Support')$$) = 'ok:1');
select 'RESULT admin can subscribe: ' || (pg_temp.try($$insert into push_subscriptions (endpoint,user_id,shop_id,p256dh,auth) values ('https://e/4','00000000-0000-0000-0000-0000000000b3',null,'k','a')$$) = 'ok:1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select 'RESULT owner sees the reply: ' || ((select count(*) from support_messages) = 2);
select 'RESULT owner cannot see other phones subscriptions: ' || ((select count(*) from push_subscriptions) = 1);
