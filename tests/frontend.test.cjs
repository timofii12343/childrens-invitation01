'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {JSDOM}=require('jsdom');const {setup}=require('./helpers.cjs');
let s,dom,w,failParticipation=false,failRegister=false,lastId;
const waitFor=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI did not settle');};
const click=id=>w.document.getElementById(id).click();const $=id=>w.document.getElementById(id);
const submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
before(async()=>{
 s=await setup();await s.addAdmin(1,'first@example.test','StrongPassword-123');
 dom=new JSDOM(readFileSync('public/index.html','utf8'),{url:'https://invite.test',runScripts:'outside-only'});w=dom.window;
 w.AbortSignal=AbortSignal;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let cookie='';w.fetch=async(url,opts={})=>{
  const parsed=new URL(url,'https://invite.test');const route=parsed.pathname.slice(5);
  if((route==='participation'&&failParticipation)||(route==='register'&&failRegister))return {ok:false,status:503,json:async()=>({error:'Тестовая сетевая ошибка'})};
  const r=await s.call(route,{method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):{},url:parsed.pathname+parsed.search,cookie});
  if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];if(route==='register'&&r.status===200)lastId=r.data.id;
  return {ok:r.status<400,status:r.status,json:async()=>r.data};
 };
 w.eval(readFileSync('public/app.js','utf8'));
});
after(async()=>{dom.window.close();await s.close();});
test('existing invitation content and imagery preserved; church replaces surname',()=>{
 assert.equal($('church').required,true);assert.equal($('children').min,'1');assert.equal($('surname'),null);
 const current=readFileSync('public/index.html','utf8');
 const start='<header class="hero">',end='<section class="rsvp"';assert.equal(require('node:crypto').createHash('sha256').update(current.slice(current.indexOf(start),current.indexOf(end))).digest('hex'),'07c5731b1f13c6b283bdfe10e702cd61b4f617ff1edbe175a6e44d33804a5338');
 assert.match(readFileSync('public/style.css','utf8'),/@media\(max-width:680px\)/);
});
test('failed main save preserves fields and shows no participation modal',async()=>{
 failRegister=true;$('church').value='Церковь Лемго';$('children').value='3';submit('rsvp-form');await waitFor(()=>$('rsvp-status').textContent.includes('ошибка'));
 assert.equal($('church').value,'Церковь Лемго');assert.equal($('rsvp-button').disabled,false);assert.equal($('participation-dialog').open,false);failRegister=false;
});
test('successful save opens optional modal; double submission creates one row',async()=>{
 submit('rsvp-form');submit('rsvp-form');await waitFor(()=>$('participation-dialog').open);assert.equal($('rsvp-button').disabled,true);
 const r=await s.db.query('SELECT count(*)::int AS n FROM invitation_registrations');assert.equal(r.rows[0].n,1);
});
test('optional save failure keeps text and existing registration; retry succeeds',async()=>{
 $('participation').value='<img src=x onerror=alert(1)>\nПесня';failParticipation=true;submit('participation-form');await waitFor(()=>$('participation-status').textContent.includes('ошибка'));
 assert.equal($('participation-dialog').open,true);assert.match($('participation').value,/Песня/);assert.equal($('save-participation').disabled,false);
 assert.equal((await s.db.query('SELECT participation FROM invitation_registrations WHERE id=$1',[lastId])).rows[0].participation,null);
 failParticipation=false;submit('participation-form');await waitFor(()=>!$('participation-dialog').open);assert.match($('rsvp-status').textContent,/подтверждено/);
 assert.match((await s.db.query('SELECT participation FROM invitation_registrations WHERE id=$1',[lastId])).rows[0].participation,/Песня/);
});
test('login, private table, text rendering, deletion and logout work through same real API',async()=>{
 click('open-admin');await waitFor(()=>$('login-form').hidden===false);$('email').value='first@example.test';$('password').value='wrong';submit('login-form');await waitFor(()=>$('login-status').textContent.includes('Неверный'));assert.equal($('dashboard').hidden,true);
 $('password').value='StrongPassword-123';submit('login-form');await waitFor(()=>$('requests').children.length===1);
 assert.equal($('total-children').textContent,'3');assert.equal($('total-requests').textContent,'1');assert.equal($('total-participation').textContent,'1');assert.equal($('requests').querySelector('img'),null);assert.match($('requests').textContent,/onerror/);
 $('requests').querySelectorAll('button')[1].click();assert.equal($('delete-dialog').open,true);click('confirm-delete');await waitFor(()=>$('total-requests').textContent==='0');assert.equal($('total-children').textContent,'0');
 click('logout');await waitFor(()=>$('login-status').textContent.includes('вышли'));assert.equal($('dashboard').hidden,true);assert.equal($('requests').children.length,0);
});
test('frontend contains no DB/Supabase secrets or client session storage',()=>{
 for(const file of ['public/app.js','public/index.html','public/style.css'])assert.doesNotMatch(readFileSync(file,'utf8'),/DATABASE_URL|REGISTRATION_SECRET|IP_HASH_SECRET|SUPABASE|localStorage|sessionStorage|postgres(?:ql)?:\/\//);
 const env=readFileSync('.env.example','utf8');assert.ok(env.trim().split('\n').every(line=>/^[A-Z_]+=$/.test(line)));
});

test('skip button closes optional modal and preserves registration with NULL participation',async()=>{
 // Simulate a fresh family visiting the form; no client storage is used.
 $('rsvp-button').disabled=false;$('church').disabled=false;$('children').disabled=false;
 $('church').value='Другая церковь';$('children').value='2';submit('rsvp-form');await waitFor(()=>$('participation-dialog').open);
 $('participation').value='Несохранённый текст';click('skip-participation');await waitFor(()=>!$('participation-dialog').open);
 const row=(await s.db.query('SELECT participation,children_count FROM invitation_registrations WHERE id=$1',[lastId])).rows[0];assert.equal(row.participation,null);assert.equal(row.children_count,2);assert.match($('rsvp-status').textContent,/подтверждено/);
});
