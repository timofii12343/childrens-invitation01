'use strict';
const { PGlite }=require('@electric-sql/pglite');
const { readFileSync }=require('node:fs');
const { randomUUID }=require('node:crypto');
const { createHandler }=require('../lib/api.cjs');
const security=require('../lib/security.cjs');
exports.setup=async()=>{
 process.env.REGISTRATION_SECRET='r'.repeat(48);process.env.IP_HASH_SECRET='i'.repeat(48);process.env.APP_ORIGIN='https://invite.test';process.env.VERCEL='1';
 const db=new PGlite();await db.exec(readFileSync(require('node:path').join(__dirname,'../database/001_postgres.sql'),'utf8'));
 let tail=Promise.resolve();const connect=async()=>{const prior=tail;let unlock;tail=new Promise(r=>{unlock=r;});await prior;return {query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(r=>r.at(-1)||{rows:[]}),release:unlock};};
 const call=async(route,{method='POST',body={},cookie='',ip='203.0.113.1',origin='https://invite.test',url,headers={}}={})=>{
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(s){this.data=JSON.parse(s);}};
  await createHandler(route,{connect})({method,url:url||'/api/'+route,headers:{host:'invite.test',origin,'content-type':'application/json','x-vercel-forwarded-for':ip,cookie,...headers},body},res);
  return {status:res.statusCode,data:res.data,headers:res.headers};
 };
 const addAdmin=async(slot,email,password)=>db.query('INSERT INTO invitation_admins(id,slot,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),slot,email,slot===1?'Тимофей':'Сергей Власенко',await security.hashPassword(password)]);
 return {db,call,addAdmin,close:()=>db.close(),registration:(church='Церковь Лемго',children_count=3)=>({church,children_count,request_id:randomUUID(),website:''})};
};
