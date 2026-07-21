import React,{useMemo,useState}from'react';
import{Search,ShieldCheck,Users,UserCheck,UserRoundCog,X,Save}from'lucide-react';

export default function AdminCenter({data,onSave,busy}){
 const[q,setQ]=useState(''),[editing,setEditing]=useState(null);
 const rows=useMemo(()=>{const s=q.trim().toLowerCase();return(data?.people||[]).filter(p=>!s||`${p.personId} ${p.name} ${p.email} ${p.position} ${p.department}`.toLowerCase().includes(s))},[data,q]);
 const sum=data?.summary||{};
 return <section className="admin-center">
  <div className="admin-hero"><div><small>ADMIN CONTROL CENTER</small><h2>ศูนย์ผู้ดูแลระบบ</h2><p>บริหารบัญชี สิทธิ์ และความครบถ้วนของบุคลากรในที่เดียว</p></div><span><ShieldCheck/>สิทธิ์ผู้ดูแลได้รับการยืนยัน</span></div>
  <div className="admin-stats"><Stat icon={<Users/>} label="บุคลากรทั้งหมด" value={sum.total||0}/><Stat icon={<UserCheck/>} label="เปิดใช้งาน" value={sum.active||0}/><Stat icon={<ShieldCheck/>} label="ผู้ดูแลระบบ" value={sum.admins||0}/><Stat icon={<UserRoundCog/>} label="ข้อมูลยังไม่ครบ" value={sum.incomplete||0}/></div>
  <div className="panel admin-list"><div className="admin-list-head"><div><h2>จัดการบัญชีบุคลากร</h2><p>แก้ไขอีเมล บทบาท และสถานะการใช้งาน พร้อมบันทึกประวัติอัตโนมัติ</p></div><label><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อ รหัส อีเมล หรือตำแหน่ง"/></label></div>
   <div className="admin-table"><div className="admin-row admin-th"><span>บุคลากร</span><span>อีเมล</span><span>บทบาท</span><span>สถานะ</span><span>ข้อมูล</span><span></span></div>{rows.map(p=><div className="admin-row" key={p.personId}><span className="admin-person">{p.photoUrl?<img src={p.photoUrl}/>:<i>{(p.name||'ผ').charAt(0)}</i>}<b>{p.name}<small>{p.personId} · {p.position||'รอข้อมูล'}</small></b></span><span className={p.email?'':'muted'}>{p.email||'ยังไม่ผูกอีเมล'}</span><span><Badge type={p.role}>{roleLabel(p.role)}</Badge></span><span><Badge type={p.status}>{statusLabel(p.status)}</Badge></span><span className={p.dataStatus==='ข้อมูลครบถ้วน'?'ok-text':'warn-text'}>{p.dataStatus||'รอตรวจสอบ'}</span><span><button className="admin-edit" onClick={()=>setEditing({...p})}>จัดการ</button></span></div>)}</div>
  </div>
  {editing&&<div className="back admin-back"><form className="admin-modal" onSubmit={e=>{e.preventDefault();onSave({personId:editing.personId,email:editing.email,role:editing.role,status:editing.status}).then(()=>setEditing(null))}}><button type="button" className="x" onClick={()=>setEditing(null)}><X/></button><UserRoundCog className="big"/><h2>จัดการบัญชีบุคลากร</h2><p>{editing.name} · {editing.personId}</p><label>อีเมล Google<input type="email" value={editing.email||''} onChange={e=>setEditing(v=>({...v,email:e.target.value}))} placeholder="name@gmail.com"/></label><div className="formgrid"><label>บทบาท<select value={editing.role||'USER'} onChange={e=>setEditing(v=>({...v,role:e.target.value}))}><option value="USER">บุคลากร</option><option value="REVIEWER">กรรมการ</option><option value="ADMIN">ผู้ดูแลระบบ</option><option value="SUPER_ADMIN">ผู้ดูแลสูงสุด</option></select></label><label>สถานะ<select value={editing.status||'PENDING'} onChange={e=>setEditing(v=>({...v,status:e.target.value}))}><option value="ACTIVE">เปิดใช้งาน</option><option value="PENDING">รอเปิดใช้งาน</option><option value="INACTIVE">ระงับใช้งาน</option></select></label></div><button disabled={busy} className="primary submit"><Save/>{busy?'กำลังบันทึก…':'บันทึกสิทธิ์และบัญชี'}</button></form></div>}
 </section>
}
function Stat({icon,label,value}){return <article>{icon}<p><small>{label}</small><b>{value}</b></p></article>}
function Badge({type,children}){return <em className={`admin-badge ${String(type||'').toLowerCase()}`}>{children}</em>}
function roleLabel(x){return({USER:'บุคลากร',REVIEWER:'กรรมการ',ADMIN:'ผู้ดูแล',SUPER_ADMIN:'ผู้ดูแลสูงสุด'})[x]||x}
function statusLabel(x){return({ACTIVE:'เปิดใช้งาน',PENDING:'รอเปิด',INACTIVE:'ระงับ'})[x]||x}
