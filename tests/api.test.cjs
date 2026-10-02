'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {setup}=require('./helpers.cjs');const security=require('../lib/security.cjs');
let s,first,second,cookie,cookie2;
before(async()=>{s=await setup();await s.addAdmin(1,'first@example.test','StrongPassword-123');await s.addAdmin(2,'second@example.test','OtherPassword-456');});after(async()=>s.close());
test('registration persists church and children; receipt stored only as hash',async()=>{
 first=await s.call('register',{body:s.registration('  Церковь Лемго  ',3)});assert.equal(first.status,200);
 const row=(await s.db.query('SELECT * FROM invitation_registrations WHERE id=$1',[first.data.id])).rows[0];assert.equal(row.church,'Церковь Лемго');assert.equal(row.children_count,3);assert.equal(row.participation,null);assert.notEqual(row.participation_token_hash,first.data.token);
});
test('same concurrent request is idempotent; changed replay denied',async()=>{
 const b=s.registration('Другая церковь',5);const r=await Promise.all([s.call('register',{body:b}),s.call('register',{body:b})]);assert.equal(r[0].status,200);assert.deepEqual(r[0].data,r[1].data);second=r[0];
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM invitation_registrations WHERE request_id=$1',[b.request_id])).rows[0].n,1);assert.equal((await s.call('register',{body:{...b,children_count:7}})).status,409);
});
test('participation persists in same row; forged receipt denied',async()=>{
 assert.equal((await s.call('participation',{body:{...first.data,participation:'Хор\nПесня'}})).status,200);assert.equal((await s.db.query('SELECT participation FROM invitation_registrations WHERE id=$1',[first.data.id])).rows[0].participation,'Хор\nПесня');
 assert.equal((await s.call('participation',{body:{...first.data,token:'x'.repeat(43),participation:'Чужой текст'}})).status,403);
});
test('skip sets NULL without removing registration',async()=>{
 assert.equal((await s.call('participation',{body:{...second.data,participation:'Текст'}})).status,200);assert.equal((await s.call('participation',{body:{...second.data,participation:null}})).status,200);
 const row=(await s.db.query('SELECT participation,children_count FROM invitation_registrations WHERE id=$1',[second.data.id])).rows[0];assert.equal(row.participation,null);assert.equal(row.children_count,5);assert.equal((await s.call('register',{body:s.registration('Третья церковь',2)})).status,200);
});
test('server validates input, JSON, method and origin',async()=>{
 for(const b of [s.registration('',1),s.registration('Церковь',0),s.registration('Церковь',1.5),s.registration('<script>',2),{...s.registration(),request_id:'bad'},{...s.registration(),website:'spam'},null,'{broken'])assert.equal((await s.call('register',{body:b})).status,400);
 assert.equal((await s.call('register',{body:s.registration(),origin:'https://evil.test'})).status,403);assert.equal((await s.call('register',{method:'GET'})).status,405);assert.equal((await s.call('register',{body:s.registration(),headers:{'content-type':'text/plain'}})).status,415);assert.equal((await s.call('participation',{body:{...first.data,participation:'a'.repeat(5001)}})).status,400);
});
test('public callers cannot read, edit, delete or forge administrator session',async()=>{
 for(const o of [{method:'GET'},{method:'DELETE',body:{id:first.data.id}},{method:'PATCH',body:{id:first.data.id,church:'Other',children_count:1}},{method:'GET',cookie:'__Host-lemgo_session='+'x'.repeat(43)}])assert.equal((await s.call('registrations',o)).status,401);assert.equal((await s.call('session',{method:'GET'})).status,401);
});
test('wrong passwords and unknown accounts denied; passwords use scrypt',async()=>{
 for(const email of ['first@example.test','unknown@example.test']){const r=await s.call('login',{body:{email,password:'wrong'}});assert.equal(r.status,401);assert.equal(r.data.error,'Неверный email или пароль.');assert.equal(r.headers['set-cookie'],undefined);}
 const h=(await s.db.query('SELECT password_hash FROM invitation_admins WHERE slot=1')).rows[0].password_hash;assert.match(h,/^scrypt\$/);assert.ok(!h.includes('StrongPassword'));assert.equal(await security.verifyPassword('wrong',h),false);
});
test('both administrators sign in with HttpOnly Secure SameSite cookies',async()=>{
 const a=await s.call('login',{body:{email:'FIRST@example.test',password:'StrongPassword-123'}}),b=await s.call('login',{body:{email:'second@example.test',password:'OtherPassword-456'}});assert.equal(a.status,200);assert.equal(b.status,200);cookie=a.headers['set-cookie'].split(';')[0];cookie2=b.headers['set-cookie'].split(';')[0];
 for(const r of [a,b]){assert.match(r.headers['set-cookie'],/HttpOnly/);assert.match(r.headers['set-cookie'],/Secure/);assert.match(r.headers['set-cookie'],/SameSite=Strict/);assert.equal(r.data.token,undefined);}
 assert.equal((await s.call('session',{method:'GET',cookie})).data.admin.display_name,'Тимофей');assert.equal((await s.call('session',{method:'GET',cookie:cookie2})).data.admin.display_name,'Сергей Власенко');
 const hashes=(await s.db.query('SELECT token_hash FROM invitation_sessions')).rows.map(r=>r.token_hash);assert.ok(hashes.every(h=>h.length===64&&!cookie.includes(h)));
});
test('shared statistics: 3 requests, 10 children, 1 participation',async()=>{
 for(const c of [cookie,cookie2]){const r=await s.call('registrations',{method:'GET',cookie:c});assert.equal(r.status,200);assert.deepEqual(r.data.totals,{requests:3,children:10,participation:1});assert.equal(r.data.rows.length,3);assert.equal(r.data.rows[0].participation_token_hash,undefined);}
});
test('edit and delete recalculate totals; deleted request cannot be replayed',async()=>{
 assert.equal((await s.call('registrations',{method:'PATCH',cookie,body:{id:first.data.id,church:'Исправленная церковь',children_count:4,participation:'Песня'}})).status,200);assert.equal((await s.call('registrations',{method:'DELETE',cookie:cookie2,body:{id:second.data.id}})).status,200);
 assert.deepEqual((await s.call('registrations',{method:'GET',cookie})).data.totals,{requests:2,children:6,participation:1});assert.equal((await s.call('participation',{body:{...second.data,participation:'Песня'}})).status,403);
 const row=(await s.db.query('SELECT request_id,original_church,original_children_count FROM invitation_registrations WHERE id=$1',[second.data.id])).rows[0];assert.equal((await s.call('register',{body:{request_id:row.request_id,church:row.original_church,children_count:row.original_children_count}})).status,410);
});
test('valid cookie does not bypass CSRF',async()=>{
 assert.equal((await s.call('registrations',{method:'DELETE',cookie,origin:'https://evil.test',body:{id:first.data.id}})).status,403);assert.equal((await s.call('logout',{cookie,origin:''})).status,403);
});
test('logout invalidates database session and expired sessions denied',async()=>{
 const r=await s.call('logout',{cookie});assert.equal(r.status,200);assert.match(r.headers['set-cookie'],/Max-Age=0/);assert.equal((await s.call('registrations',{method:'GET',cookie})).status,401);await s.db.query("UPDATE invitation_sessions SET expires_at=now() - interval '1 second'");assert.equal((await s.call('registrations',{method:'GET',cookie:cookie2})).status,401);
});
test('database constraints enforce only two admins and positive counts',async()=>{
 await assert.rejects(()=>s.db.query('INSERT INTO invitation_admins(id,slot,email,display_name,password_hash) VALUES ($1,3,$2,$3,$4)',[randomUUID(),'third@example.test','Third','hash']));await assert.rejects(()=>s.db.query('UPDATE invitation_registrations SET children_count=0 WHERE id=$1',[first.data.id]));
});
test('persistent request rate limit',async()=>{
 for(let i=0;i<10;i++)assert.equal((await s.call('register',{body:s.registration(),ip:'203.0.113.20'})).status,200);assert.equal((await s.call('register',{body:s.registration(),ip:'203.0.113.20'})).status,429);
});
test('persistent email login rate limit',async()=>{
 for(let i=0;i<10;i++)assert.equal((await s.call('login',{body:{email:'brute@example.test',password:'wrong'},ip:'203.0.113.30'})).status,401);assert.equal((await s.call('login',{body:{email:'brute@example.test',password:'wrong'},ip:'203.0.113.31'})).status,429);
});
