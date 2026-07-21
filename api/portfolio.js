import crypto from'node:crypto';
import{OAuth2Client,ExternalAccountClient}from'google-auth-library';
import{getVercelOidcToken}from'@vercel/oidc';

const SHEET_ID=process.env.SPREADSHEET_ID||'14DxHuvOkNPv9l51Yx-pm6-kHwpUeaVkwZWympl7NVjE';
const CLIENT_ID=process.env.GOOGLE_CLIENT_ID||process.env.VITE_GOOGLE_CLIENT_ID;
const SESSION_SECRET=process.env.SESSION_SECRET||'';
const OWNER_FIELDS=['คำนำหน้า/สมณศักดิ์','ชื่อ-ฉายา/นามสกุล','โทรศัพท์','photoUrl'];
const ADMIN_FIELDS=['คำนำหน้า/สมณศักดิ์','ชื่อ-ฉายา/นามสกุล','ตำแหน่ง','ฝ่ายงาน','ประเภทบุคลากร','อีเมล','โทรศัพท์','photoUrl','portfolioSlug','สถานะ'];

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,message:'Method not allowed'});
 try{
  assertConfig();
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  let result;
  if(body.action==='login')result=await login(body.credential);
  else if(body.action==='getProfile')result=await getProfile(body.token);
  else if(body.action==='updateProfile')result=await updateProfile(body.token,body.payload||{});
  else if(body.action==='listPersonnel')result=await listPersonnel(body.token);
  else if(body.action==='health')result=await health();
  else throw new PublicError('ไม่พบคำสั่งที่ร้องขอ',400);
  return res.status(200).json(result);
 }catch(error){console.error(error);return res.status(error.status||500).json({ok:false,message:error.publicMessage||'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง'});}
}

async function login(credential){
 if(!credential)throw new PublicError('ไม่พบข้อมูลยืนยันตัวตนจาก Google',400);
 const client=new OAuth2Client(CLIENT_ID);
 const ticket=await client.verifyIdToken({idToken:credential,audience:CLIENT_ID});
 const identity=ticket.getPayload();
 if(!identity?.email_verified)throw new PublicError('อีเมล Google ยังไม่ได้รับการยืนยัน',401);
 const email=String(identity.email).toLowerCase().trim();
 const users=await table('Users');
 const user=users.find(r=>String(r.email).toLowerCase().trim()===email);
 if(!user)throw new PublicError('อีเมลนี้ยังไม่ได้ผูกกับบัญชีบุคลากร กรุณาติดต่อผู้ดูแลระบบ',403);
 if(String(user.status).toUpperCase()!=='ACTIVE')throw new PublicError('บัญชีนี้ยังไม่เปิดใช้งาน',403);
 const token=signSession({email,personId:user.personId,role:user.role,name:identity.name||''});
 await updateCell('Users',user.__row,6,new Date().toISOString());
 await audit(email,user.personId,'LOGIN','','','','SUCCESS','Google Identity Services');
 return{ok:true,token,user:safeUser(user),profile:await profileById(user.personId)};
}

async function getProfile(token){const session=verifySession(token);return{ok:true,user:session,profile:await profileById(session.personId)}}

async function updateProfile(token,payload){
 const session=verifySession(token);const target=session.role==='ADMIN'&&payload.personId?String(payload.personId):session.personId;
 if(session.role!=='ADMIN'&&target!==session.personId)throw new PublicError('ไม่มีสิทธิ์แก้ไขข้อมูลของผู้อื่น',403);
 const rows=await table('Personnel');const row=rows.find(r=>r.personId===target);if(!row)throw new PublicError('ไม่พบข้อมูลบุคลากร',404);
 const allowed=session.role==='ADMIN'?ADMIN_FIELDS:OWNER_FIELDS;
 const map={prefix:'คำนำหน้า/สมณศักดิ์',name:'ชื่อ-ฉายา/นามสกุล',position:'ตำแหน่ง',department:'ฝ่ายงาน',personnelType:'ประเภทบุคลากร',email:'อีเมล',phone:'โทรศัพท์',photoUrl:'photoUrl',portfolioSlug:'portfolioSlug',status:'สถานะ'};
 const changes=[];for(const[key,header]of Object.entries(map)){if(!(key in payload)||!allowed.includes(header))continue;const next=sanitize(payload[key],key),old=row[header]||'';if(next!==old)changes.push({key,header,next,old,col:row.__headers.indexOf(header)+1});}
 if(!changes.length)return{ok:true,changed:0,profile:await profileById(target)};
 for(const c of changes)await updateCell('Personnel',row.__row,c.col,c.next);
 const merged={...row};changes.forEach(c=>merged[c.header]=c.next);
 const missing=[['โทรศัพท์','โทรศัพท์'],['อีเมล','อีเมล'],['photoUrl','รูปบุคลากร']].filter(([h])=>!merged[h]).map(([,label])=>label);
 await updateCell('Personnel',row.__row,row.__headers.indexOf('ข้อมูลที่ยังขาด')+1,missing.join(', '));
 await updateCell('Personnel',row.__row,row.__headers.indexOf('สถานะข้อมูล')+1,missing.length?'รอข้อมูลเพิ่มเติม':'ข้อมูลครบถ้วน');
 for(const c of changes)await audit(session.email,target,'UPDATE_PROFILE',c.header,c.old,c.next,'SUCCESS',session.role);
 return{ok:true,changed:changes.length,profile:await profileById(target)};
}

async function listPersonnel(token){verifySession(token);const rows=await table('Personnel');return{ok:true,people:rows.map(r=>({personId:r.personId,prefix:r['คำนำหน้า/สมณศักดิ์'],name:r['ชื่อ-ฉายา/นามสกุล'],position:r['ตำแหน่ง'],department:r['ฝ่ายงาน'],personnelType:r['ประเภทบุคลากร'],photoUrl:r.photoUrl,portfolioSlug:r.portfolioSlug,dataStatus:r['สถานะข้อมูล']}))}}
async function health(){const users=await table('Users');return{ok:true,service:'MCU Smart Portfolio API',version:'2.2.1',auth:'Vercel OIDC / Google WIF',database:'Google Sheets connected',users:users.length}}
async function profileById(id){const r=(await table('Personnel')).find(x=>x.personId===id);if(!r)throw new PublicError('ไม่พบโปรไฟล์บุคลากร',404);return{personId:r.personId,prefix:r['คำนำหน้า/สมณศักดิ์'],name:r['ชื่อ-ฉายา/นามสกุล'],position:r['ตำแหน่ง'],department:r['ฝ่ายงาน'],personnelType:r['ประเภทบุคลากร'],email:r['อีเมล'],phone:r['โทรศัพท์'],photoUrl:r.photoUrl,portfolioSlug:r.portfolioSlug,status:r['สถานะ'],missing:r['ข้อมูลที่ยังขาด'],dataStatus:r['สถานะข้อมูล']}}
function safeUser(u){return{userId:u.userId,personId:u.personId,email:u.email,role:u.role,status:u.status}}

async function table(name){const values=await sheetGet(`${name}!A1:Z1000`);const headers=values.shift()||[];return values.filter(r=>r.some(Boolean)).map((r,i)=>{const o={__row:i+2,__headers:headers};headers.forEach((h,j)=>o[h]=r[j]||'');return o})}
async function sheetGet(range){const token=await accessToken();const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`Sheets read ${r.status}: ${await r.text()}`);return(await r.json()).values||[]}
async function updateCell(sheet,row,col,value){const token=await accessToken();const range=`${sheet}!${columnName(col)}${row}`;const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;const r=await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({range,majorDimension:'ROWS',values:[[value]]})});if(!r.ok)throw new Error(`Sheets update ${r.status}: ${await r.text()}`)}
async function audit(email,personId,action,field,oldValue,newValue,result,details){const token=await accessToken();const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('AuditLog!A:J')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;const values=[[`AUD-${crypto.randomUUID()}`,new Date().toISOString(),email,personId,action,field,oldValue,newValue,result,details]];const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values})});if(!r.ok)throw new Error(`Audit append ${r.status}: ${await r.text()}`)}
async function accessToken(){
 const audience=`//iam.googleapis.com/projects/${process.env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${process.env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
 const client=ExternalAccountClient.fromJSON({
  type:'external_account',audience,subject_token_type:'urn:ietf:params:oauth:token-type:jwt',
  scopes:['https://www.googleapis.com/auth/spreadsheets'],
  token_url:'https://sts.googleapis.com/v1/token',
  service_account_impersonation_url:`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${process.env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
  // Keep Vercel's normal Team audience; do not forward Google's supplier context.
  subject_token_supplier:{getSubjectToken:()=>getVercelOidcToken()}
 });
 if(!client)throw new Error('Unable to initialize Google Workload Identity client');
 const token=await client.getAccessToken();return typeof token==='string'?token:token.token;
}

function signSession(user){const header=b64({alg:'HS256',typ:'JWT'}),payload=b64({...user,exp:Math.floor(Date.now()/1000)+43200});const data=`${header}.${payload}`;return`${data}.${hmac(data)}`}
function verifySession(token){if(!token)throw new PublicError('กรุณาเข้าสู่ระบบ',401);const parts=String(token).split('.');if(parts.length!==3)throw new PublicError('เซสชันไม่ถูกต้อง',401);const expected=hmac(`${parts[0]}.${parts[1]}`),a=Buffer.from(parts[2]),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new PublicError('เซสชันไม่ถูกต้อง',401);const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());if(payload.exp<Math.floor(Date.now()/1000))throw new PublicError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',401);return payload}
function b64(value){return Buffer.from(JSON.stringify(value)).toString('base64url')}function hmac(value){return crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('base64url')}
function sanitize(value,key){const v=String(value??'').trim();if(v.length>500)throw new PublicError('ข้อมูลยาวเกินกำหนด',400);if(key==='photoUrl'&&v&&!/^https:\/\//i.test(v))throw new PublicError('URL รูปภาพต้องขึ้นต้นด้วย https://',400);return v.replace(/[<>]/g,'')}
function columnName(n){let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function assertConfig(){for(const key of['GOOGLE_CLIENT_ID','SESSION_SECRET','SPREADSHEET_ID','GCP_PROJECT_NUMBER','GCP_SERVICE_ACCOUNT_EMAIL','GCP_WORKLOAD_IDENTITY_POOL_ID','GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'])if(!process.env[key]&&!(key==='GOOGLE_CLIENT_ID'&&CLIENT_ID))throw new Error(`Missing ${key}`)}
class PublicError extends Error{constructor(message,status=400){super(message);this.publicMessage=message;this.status=status}}
