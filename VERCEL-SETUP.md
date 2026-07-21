# ตั้งค่าระบบล็อกอินและโปรไฟล์บน Vercel

## Environment Variables

เพิ่มใน Vercel > Project > Settings > Environment Variables แล้ว Redeploy:

- `VITE_GOOGLE_CLIENT_ID` — OAuth 2.0 Web Client ID
- `GOOGLE_CLIENT_ID` — ค่าเดียวกับด้านบน
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — อีเมล Service Account
- `GOOGLE_PRIVATE_KEY` — Private key จากไฟล์ JSON
- `SESSION_SECRET` — สุ่มข้อความยาวอย่างน้อย 32 ตัวอักษร
- `SPREADSHEET_ID` — `14DxHuvOkNPv9l51Yx-pm6-kHwpUeaVkwZWympl7NVjE`

## Google Cloud

1. สร้าง OAuth 2.0 Client ประเภท Web application
2. เพิ่ม Authorized JavaScript origins:
   - `https://mcu-kalasin-smart-portfolio.vercel.app`
   - โดเมนจริงของหน่วยงาน (เมื่อมี)
3. เปิด Google Sheets API
4. สร้าง Service Account และ JSON key
5. แชร์ Google Sheets ให้ `GOOGLE_SERVICE_ACCOUNT_EMAIL` เป็น Editor

ระบบจะรับเฉพาะบัญชีที่อีเมลตรงกับแท็บ `Users` และมีสถานะ `ACTIVE`
