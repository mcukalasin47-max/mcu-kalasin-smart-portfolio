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
  else if(body.action==='adminOverview')result=await adminOverview(body.token);
  else if(body.action==='adminUpdateUser')result=await adminUpdateUser(body.token,body.payload||{});
  else if(body.action==='adminCreatePerson')result=await adminCreatePerson(body.token,body.payload||{});
  else if(body.action==='adminSetPersonActive')result=await adminSetPersonActive(body.token,body.payload||{});
  else if(body.action==='portfolioHome')result=await portfolioHome(body.token);
  else if(body.action==='createWork')result=await createWork(body.token,body.payload||{});
  else if(body.action==='setWorkState')result=await setWorkState(body.token,body.payload||{});
  else if(body.action==='addEvidenceLink')result=await addEvidenceLink(body.token,body.payload||{});
  else if(body.action==='uploadEvidence')result=await uploadEvidence(body.token,body.payload||{});
  else if(body.action==='reviewerQueue')result=await reviewerQueue(body.token);
  else if(body.action==='saveReview')result=await saveReview(body.token,body.payload||{});
  else if(body.action==='publicPortfolio')result=await publicPortfolio(body.slug);
  else if(body.action==='adminAudit')result=await adminAudit(body.token);
  else if(body.action==='adminBackup')result=await adminBackup(body.token);
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
 const session=verifySession(token);const target=isAdmin(session)&&payload.personId?String(payload.personId):session.personId;
 if(!isAdmin(session)&&target!==session.personId)throw new PublicError('ไม่มีสิทธิ์แก้ไขข้อมูลของผู้อื่น',403);
 const rows=await table('Personnel');const row=rows.find(r=>r.personId===target);if(!row)throw new PublicError('ไม่พบข้อมูลบุคลากร',404);
 const allowed=isAdmin(session)?ADMIN_FIELDS:OWNER_FIELDS;
 const map={prefix:'คำนำหน้า/สมณศักดิ์',name:'ชื่อ-ฉายา/นามสกุล',position:'ตำแหน่ง',department:'ฝ่ายงาน',personnelType:'ประเภทบุคลากร',email:'อีเมล',phone:'โทรศัพท์',photoUrl:'photoUrl',portfolioSlug:'portfolioSlug',status:'สถานะ'};
 const changes=[];for(const[key,header]of Object.entries(map)){if(!(key in payload)||!allowed.includes(header))continue;const next=sanitize(payload[key],key),old=row[header]||'';if(key==='phone'&&next&&!/^0\d{8,9}$/.test(next))throw new PublicError('หมายเลขโทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก',400);if(next!==old)changes.push({key,header,next,old,col:row.__headers.indexOf(header)+1});}
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
async function adminOverview(token){
 const session=verifySession(token);requireAdmin(session);
 const [people,users]=await Promise.all([table('Personnel'),table('Users')]);
 const byPerson=new Map(users.map(u=>[u.personId,u]));
 const rows=people.map(p=>{const u=byPerson.get(p.personId)||{};return{personId:p.personId,name:p['ชื่อ-ฉายา/นามสกุล'],position:p['ตำแหน่ง'],department:p['ฝ่ายงาน'],email:u.email||p['อีเมล']||'',role:normalizeRole(u.role),status:normalizeStatus(u.status),lastLoginAt:u.lastLoginAt||'',missing:p['ข้อมูลที่ยังขาด']||'',dataStatus:p['สถานะข้อมูล']||'',photoUrl:p.photoUrl||''}});
 return{ok:true,summary:{total:rows.length,active:rows.filter(r=>r.status==='ACTIVE').length,admins:rows.filter(r=>['ADMIN','SUPER_ADMIN'].includes(r.role)).length,incomplete:rows.filter(r=>r.dataStatus!=='ข้อมูลครบถ้วน').length},people:rows};
}
async function adminUpdateUser(token,payload){
 const session=verifySession(token);requireAdmin(session);
 const personId=String(payload.personId||'').trim();if(!personId)throw new PublicError('ไม่พบรหัสบุคลากร',400);
 const users=await table('Users');const user=users.find(u=>u.personId===personId);if(!user)throw new PublicError('ไม่พบบัญชีผู้ใช้',404);
 const email=String(payload.email??user.email??'').trim().toLowerCase();
 const role=String(payload.role||user.role||'USER').trim().toUpperCase();
 const status=String(payload.status||user.status||'PENDING').trim().toUpperCase();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new PublicError('รูปแบบอีเมลไม่ถูกต้อง',400);
 if(email&&users.some(u=>u.personId!==personId&&String(u.email||'').trim().toLowerCase()===email))throw new PublicError('อีเมลนี้ถูกผูกกับบุคลากรคนอื่นแล้ว',409);
 if(!['USER','REVIEWER','ADMIN','SUPER_ADMIN'].includes(role))throw new PublicError('บทบาทไม่ถูกต้อง',400);
 if(!['ACTIVE','INACTIVE','PENDING'].includes(status))throw new PublicError('สถานะไม่ถูกต้อง',400);
 if(personId===session.personId&&status!=='ACTIVE')throw new PublicError('ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่',400);
 const updates=[['email',email],['role',role],['status',status]];
 for(const[field,value]of updates){const col=user.__headers.indexOf(field)+1;if(col<1)continue;const old=user[field]||'';if(old!==value){await updateCell('Users',user.__row,col,value);await audit(session.email,personId,'ADMIN_UPDATE_USER',field,old,value,'SUCCESS',session.role)}}
 if(email){const people=await table('Personnel');const person=people.find(p=>p.personId===personId);if(person&&person['อีเมล']!==email){await updateCell('Personnel',person.__row,person.__headers.indexOf('อีเมล')+1,email);await audit(session.email,personId,'ADMIN_SYNC_PERSONNEL','อีเมล',person['อีเมล']||'',email,'SUCCESS',session.role)}}
 return adminOverview(token);
}
async function adminCreatePerson(token,payload){
 const session=verifySession(token);requireAdmin(session);
 const name=sanitize(payload.name,'name');if(!name)throw new PublicError('กรุณาระบุชื่อบุคลากร',400);
 const email=String(payload.email||'').trim().toLowerCase();if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new PublicError('รูปแบบอีเมลไม่ถูกต้อง',400);
 const [people,users]=await Promise.all([table('Personnel'),table('Users')]);
 if(email&&users.some(u=>String(u.email||'').trim().toLowerCase()===email))throw new PublicError('อีเมลนี้มีบัญชีอยู่แล้ว',409);
 const next=n=>String(Math.max(0,...n.map(x=>Number(String(x||'').replace(/\D/g,''))||0))+1).padStart(3,'0');
 const personId=`P${next(people.map(p=>p.personId))}`,userId=`U${next(users.map(u=>u.userId))}`;
 const prefix=sanitize(payload.prefix,'prefix'),position=sanitize(payload.position,'position'),department=sanitize(payload.department,'department'),personnelType=sanitize(payload.personnelType,'personnelType');
 const role=String(payload.role||'USER').toUpperCase(),status=String(payload.status||(email?'ACTIVE':'PENDING')).toUpperCase();
 if(!['USER','REVIEWER','ADMIN','SUPER_ADMIN'].includes(role))throw new PublicError('บทบาทไม่ถูกต้อง',400);
 if(!['ACTIVE','INACTIVE','PENDING'].includes(status))throw new PublicError('สถานะไม่ถูกต้อง',400);
 const slug=String(payload.portfolioSlug||personId.toLowerCase()).trim().replace(/[^a-z0-9-]/gi,'-').replace(/-+/g,'-');
 const missing=[!email&&'อีเมล','โทรศัพท์','รูปบุคลากร'].filter(Boolean).join(', ');
 await appendValues('Personnel!A:M',[[personId,prefix,name,position,department,personnelType,email,'','',slug,'ใช้งาน',missing,'รอข้อมูลเพิ่มเติม']]);
 await appendValues('Users!A:F',[[userId,personId,email,role,status,'']]);
 await audit(session.email,personId,'ADMIN_CREATE_PERSON','บัญชี','','สร้างบุคลากรใหม่','SUCCESS',`${role}/${status}`);
 return adminOverview(token);
}
async function adminSetPersonActive(token,payload){
 const session=verifySession(token);requireAdmin(session);const personId=String(payload.personId||'').trim();
 if(!personId)throw new PublicError('ไม่พบรหัสบุคลากร',400);if(personId===session.personId&&!payload.active)throw new PublicError('ไม่สามารถระงับบัญชีที่กำลังใช้งานอยู่',400);
 const [users,people]=await Promise.all([table('Users'),table('Personnel')]);const user=users.find(u=>u.personId===personId),person=people.find(p=>p.personId===personId);
 if(!user||!person)throw new PublicError('ไม่พบบัญชีบุคลากร',404);
 const nextStatus=payload.active?'ACTIVE':'INACTIVE',personStatus=payload.active?'ใช้งาน':'ระงับ';
 await updateCell('Users',user.__row,user.__headers.indexOf('status')+1,nextStatus);await updateCell('Personnel',person.__row,person.__headers.indexOf('สถานะ')+1,personStatus);
 await audit(session.email,personId,payload.active?'ADMIN_RESTORE_PERSON':'ADMIN_ARCHIVE_PERSON','สถานะ',user.status,nextStatus,'SUCCESS',session.role);
 return adminOverview(token);
}
async function portfolioHome(token){
 const session=verifySession(token),[works,evidence,rounds,reviews]=await Promise.all([table('Works'),table('Evidence'),table('EvaluationRounds'),table('Reviews')]);
 const mine=isAdmin(session)?works:works.filter(w=>w.personId===session.personId),ids=new Set(mine.map(w=>w.workId));
 const state=w=>String(w.status||w['สถานะ']||'').toUpperCase();
 return{ok:true,works:mine,evidence:evidence.filter(e=>ids.has(e.workId)),rounds,reviews:isAdmin(session)||isReviewer(session)?reviews:reviews.filter(r=>r.personId===session.personId),summary:{total:mine.filter(w=>state(w)!=='TRASH').length,published:mine.filter(w=>String(w.visibility).toUpperCase()==='PUBLIC'&&state(w)!=='TRASH').length,pending:mine.filter(w=>['SUBMITTED','PENDING'].includes(state(w))).length,trash:mine.filter(w=>state(w)==='TRASH').length}};
}
async function createWork(token,payload){
 const session=verifySession(token),name=sanitize(payload.name,'name');if(!name)throw new PublicError('กรุณาระบุชื่อผลงาน',400);
 const works=await table('Works'),workId=`W${String(Math.max(0,...works.map(w=>Number(String(w.workId||'').replace(/\D/g,''))||0))+1).padStart(5,'0')}`,now=new Date().toISOString();
 await appendValues('Works!A:L',[[workId,session.personId,name,sanitize(payload.category,'category'),payload.startDate||'',payload.endDate||'',sanitize(payload.description,'description'),sanitize(payload.round,'round'),payload.submit?'SUBMITTED':'DRAFT',payload.visibility==='PUBLIC'?'PUBLIC':'PRIVATE',now,now]]);
 await audit(session.email,session.personId,'CREATE_WORK','workId','',workId,'SUCCESS',name);return{ok:true,workId,...await portfolioHome(token)};
}
async function setWorkState(token,payload){
 const session=verifySession(token),works=await table('Works'),work=works.find(w=>w.workId===String(payload.workId||''));if(!work)throw new PublicError('ไม่พบผลงาน',404);if(!isAdmin(session)&&work.personId!==session.personId)throw new PublicError('ไม่มีสิทธิ์แก้ไขผลงานนี้',403);
 const action=String(payload.state||'').toUpperCase(),statusCol=work.__headers.indexOf('สถานะ')+1,visibilityCol=work.__headers.indexOf('visibility')+1,updatedCol=work.__headers.indexOf('updatedAt')+1;
 if(['TRASH','DRAFT','SUBMITTED','APPROVED','REVISION'].includes(action))await updateCell('Works',work.__row,statusCol,action);else if(['PUBLIC','PRIVATE'].includes(action))await updateCell('Works',work.__row,visibilityCol,action);else throw new PublicError('สถานะผลงานไม่ถูกต้อง',400);
 if(updatedCol>0)await updateCell('Works',work.__row,updatedCol,new Date().toISOString());await audit(session.email,work.personId,'SET_WORK_STATE','state','',action,'SUCCESS',work.workId);return portfolioHome(token);
}
async function addEvidenceLink(token,payload){
 const session=verifySession(token),works=await table('Works'),work=works.find(w=>w.workId===String(payload.workId||''));if(!work)throw new PublicError('ไม่พบผลงาน',404);if(!isAdmin(session)&&work.personId!==session.personId)throw new PublicError('ไม่มีสิทธิ์เพิ่มหลักฐาน',403);
 const url=String(payload.url||'').trim();if(!/^https:\/\//.test(url))throw new PublicError('ลิงก์หลักฐานต้องขึ้นต้นด้วย https://',400);const evidence=await table('Evidence'),id=`E${String(evidence.length+1).padStart(5,'0')}`;
 await appendValues('Evidence!A:J',[[id,work.workId,sanitize(payload.name,'name')||'หลักฐานประกอบ','LINK','',url,sanitize(payload.description,'description'),session.email,new Date().toISOString(),'ACTIVE']]);await audit(session.email,work.personId,'ADD_EVIDENCE','evidenceId','',id,'SUCCESS',url);return portfolioHome(token);
}
async function uploadEvidence(token,payload){
 const session=verifySession(token);if(!process.env.DRIVE_FOLDER_ID)throw new PublicError('ผู้ดูแลยังไม่ได้กำหนด DRIVE_FOLDER_ID ใน Vercel',503);const raw=String(payload.data||''),m=raw.match(/^data:([^;]+);base64,(.+)$/);if(!m)throw new PublicError('รูปแบบไฟล์ไม่ถูกต้อง',400);const bytes=Buffer.from(m[2],'base64');if(bytes.length>8*1024*1024)throw new PublicError('ไฟล์ต้องมีขนาดไม่เกิน 8 MB',413);
 const file=await driveCreate(sanitize(payload.fileName,'fileName')||'evidence',m[1],bytes),home=await addEvidenceLink(token,{workId:payload.workId,name:payload.name||payload.fileName,url:file.webViewLink,description:payload.description});await audit(session.email,session.personId,'UPLOAD_DRIVE','fileId','',file.id,'SUCCESS',file.name);return home;
}
async function reviewerQueue(token){const session=verifySession(token);if(!isReviewer(session)&&!isAdmin(session))throw new PublicError('สงวนสิทธิ์สำหรับกรรมการและผู้ดูแล',403);const[allReviews,people,works]=await Promise.all([table('Reviews'),table('Personnel'),table('Works')]),reviews=isAdmin(session)?allReviews:allReviews.filter(r=>String(r.reviewerEmail||r['อีเมลกรรมการ']||'').toLowerCase()===session.email);return{ok:true,reviews,people:people.map(p=>({personId:p.personId,name:p['ชื่อ-ฉายา/นามสกุล'],position:p['ตำแหน่ง']})),works:works.filter(w=>String(w.status||w['สถานะ']).toUpperCase()==='SUBMITTED')}}
async function saveReview(token,payload){const session=verifySession(token);if(!isReviewer(session)&&!isAdmin(session))throw new PublicError('ไม่มีสิทธิ์บันทึกผลประเมิน',403);const reviews=await table('Reviews'),row=reviews.find(r=>r.reviewId===payload.reviewId);if(!row)throw new PublicError('ไม่พบรายการประเมิน',404);const assigned=String(row.reviewerEmail||row['อีเมลกรรมการ']||'').toLowerCase();if(!isAdmin(session)&&assigned!==session.email)throw new PublicError('รายการนี้ไม่ได้มอบหมายให้บัญชีของคุณ',403);const values={สถานะ:String(payload.status||'กำลังประเมิน'),คะแนนรวม:String(payload.score||''),ข้อเสนอแนะ:sanitize(payload.comment,'comment'),'วันที่ประเมิน':new Date().toISOString()};for(const[k,v]of Object.entries(values)){const c=row.__headers.indexOf(k)+1;if(c>0)await updateCell('Reviews',row.__row,c,v)}await audit(session.email,row.personId,'SAVE_REVIEW','reviewId','',row.reviewId,'SUCCESS',values.สถานะ);return reviewerQueue(token)}
async function publicPortfolio(slug){const[people,works,evidence]=await Promise.all([table('Personnel'),table('Works'),table('Evidence')]),person=people.find(p=>String(p.portfolioSlug||p.personId).toLowerCase()===String(slug||'').toLowerCase());if(!person)throw new PublicError('ไม่พบ Portfolio',404);const pub=works.filter(w=>w.personId===person.personId&&String(w.visibility).toUpperCase()==='PUBLIC'&&String(w['สถานะ']).toUpperCase()!=='TRASH'),ids=new Set(pub.map(w=>w.workId));return{ok:true,profile:{name:person['ชื่อ-ฉายา/นามสกุล'],prefix:person['คำนำหน้า/สมณศักดิ์'],position:person['ตำแหน่ง'],department:person['ฝ่ายงาน'],photoUrl:person.photoUrl},works:pub,evidence:evidence.filter(e=>ids.has(e.workId)&&String(e['สถานะ']).toUpperCase()!=='TRASH')}}
async function adminAudit(token){const session=verifySession(token);requireAdmin(session);const rows=await table('AuditLog');return{ok:true,rows:rows.slice(-300).reverse()}}
async function adminBackup(token){const session=verifySession(token);requireAdmin(session);if(!process.env.DRIVE_FOLDER_ID)throw new PublicError('กรุณากำหนด DRIVE_FOLDER_ID ก่อนสำรองข้อมูล',503);const names=['Personnel','Works','Evidence','EvaluationRounds','Indicators','Reviews','Users','Config','AuditLog'],data={createdAt:new Date().toISOString(),createdBy:session.email,sheets:{}};for(const n of names)data.sheets[n]=await table(n);const file=await driveCreate(`MCU-Smart-Portfolio-Backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,'application/json',Buffer.from(JSON.stringify(data,null,2)));await pruneBackups();await audit(session.email,session.personId,'ADMIN_BACKUP','driveFileId','',file.id,'SUCCESS',file.name);return{ok:true,file}}
async function driveCreate(name,mimeType,bytes){const token=await accessToken(),boundary=`mcu-${crypto.randomUUID()}`,meta=JSON.stringify({name,parents:[process.env.DRIVE_FOLDER_ID]}),body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--`)]),r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body});if(!r.ok){const detail=await r.text();console.error(`Drive upload ${r.status}: ${detail}`);if(r.status===403)throw new PublicError('Google Drive ปฏิเสธสิทธิ์อัปโหลด กรุณาตรวจว่าเปิด Drive API และแชร์โฟลเดอร์ให้ Service Account เป็นผู้แก้ไข',403);if(r.status===404)throw new PublicError('ไม่พบโฟลเดอร์ Google Drive กรุณาตรวจค่า DRIVE_FOLDER_ID',404);throw new PublicError(`อัปโหลด Google Drive ไม่สำเร็จ (รหัส ${r.status})`,502)}return r.json()}
async function pruneBackups(){const token=await accessToken(),q=encodeURIComponent(`'${process.env.DRIVE_FOLDER_ID}' in parents and name contains 'MCU-Smart-Portfolio-Backup-' and trashed=false`),r=await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime%20desc&pageSize=100&fields=files(id,name,createdTime)`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return;const files=(await r.json()).files||[];for(const file of files.slice(10))await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}})}
async function health(){const users=await table('Users');return{ok:true,service:'MCU Smart Portfolio API',version:'3.0.1',auth:'Vercel OIDC / Google WIF',database:'Google Sheets connected',users:users.length}}
async function profileById(id){const r=(await table('Personnel')).find(x=>x.personId===id);if(!r)throw new PublicError('ไม่พบโปรไฟล์บุคลากร',404);return{personId:r.personId,prefix:r['คำนำหน้า/สมณศักดิ์'],name:r['ชื่อ-ฉายา/นามสกุล'],position:r['ตำแหน่ง'],department:r['ฝ่ายงาน'],personnelType:r['ประเภทบุคลากร'],email:r['อีเมล'],phone:r['โทรศัพท์'],photoUrl:r.photoUrl,portfolioSlug:r.portfolioSlug,status:r['สถานะ'],missing:r['ข้อมูลที่ยังขาด'],dataStatus:r['สถานะข้อมูล']}}
function safeUser(u){return{userId:u.userId,personId:u.personId,email:u.email,role:u.role,status:u.status}}
function isAdmin(session){return['ADMIN','SUPER_ADMIN'].includes(String(session?.role||'').toUpperCase())}
function isReviewer(session){return String(session?.role||'').toUpperCase()==='REVIEWER'}
function requireAdmin(session){if(!isAdmin(session))throw new PublicError('สงวนสิทธิ์สำหรับผู้ดูแลระบบ',403)}
function normalizeRole(value){const x=String(value||'USER').trim().toUpperCase();return x==='PERSONNEL'?'USER':x}
function normalizeStatus(value){const x=String(value||'PENDING').trim().toUpperCase();return x==='PENDING_EMAIL'?'PENDING':x}

async function table(name){const values=await sheetGet(`${name}!A1:Z1000`);const headers=values.shift()||[];return values.filter(r=>r.some(Boolean)).map((r,i)=>{const o={__row:i+2,__headers:headers};headers.forEach((h,j)=>o[h]=r[j]||'');return o})}
async function sheetGet(range){const token=await accessToken();const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`Sheets read ${r.status}: ${await r.text()}`);return(await r.json()).values||[]}
async function updateCell(sheet,row,col,value){const token=await accessToken();const range=`${sheet}!${columnName(col)}${row}`;const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;const r=await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({range,majorDimension:'ROWS',values:[[String(value??'')]]})});if(!r.ok)throw new Error(`Sheets update ${r.status}: ${await r.text()}`)}
async function audit(email,personId,action,field,oldValue,newValue,result,details){const token=await accessToken();const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('AuditLog!A:J')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;const values=[[`AUD-${crypto.randomUUID()}`,new Date().toISOString(),email,personId,action,field,oldValue,newValue,result,details]];const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values})});if(!r.ok)throw new Error(`Audit append ${r.status}: ${await r.text()}`)}
async function appendValues(range,values){const token=await accessToken();const url=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values})});if(!r.ok)throw new Error(`Sheets append ${r.status}: ${await r.text()}`)}
async function accessToken(){
 const audience=`//iam.googleapis.com/projects/${process.env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${process.env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
 const client=ExternalAccountClient.fromJSON({
  type:'external_account',audience,subject_token_type:'urn:ietf:params:oauth:token-type:jwt',
  // The service account only sees resources explicitly shared with it. Full Drive scope
  // is required to create children inside an existing user-owned shared folder.
  scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'],
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
