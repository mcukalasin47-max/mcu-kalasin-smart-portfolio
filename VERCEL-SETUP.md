# ตั้งค่าระบบล็อกอินและ Google Sheets บน Vercel (Keyless OIDC)

ระบบใช้ Vercel OIDC เชื่อม Google Workload Identity Federation จึงไม่ต้องสร้างหรือจัดเก็บ Service Account JSON key

## Google Cloud ที่ต้องพร้อม

1. เปิด Google Sheets API และ IAM Service Account Credentials API
2. OAuth Web Client ต้องมี Authorized JavaScript origin ของโดเมน Production
3. Workload Identity Pool `vercel` และ Provider `vercel` ต้องเปิดใช้งาน
4. Provider ต้องเชื่อม Service Account และจำกัด subject เป็น:
   `owner:mcukalasin47-1471s-projects:project:mcu-kalasin-smart-portfolio:environment:production`
5. แชร์ Spreadsheet ให้ Service Account เป็น Editor

## Environment Variables บน Vercel

เพิ่มใน Project > Settings > Environment Variables สำหรับ Production แล้ว Redeploy:

- `VITE_GOOGLE_CLIENT_ID` — OAuth 2.0 Web Client ID
- `GOOGLE_CLIENT_ID` — ค่าเดียวกับด้านบน
- `SESSION_SECRET` — สุ่มข้อความยาวอย่างน้อย 32 ตัวอักษร ห้ามส่งผ่านแชตหรือบันทึกใน Git
- `SPREADSHEET_ID` — `14DxHuvOkNPv9l51Yx-pm6-kHwpUeaVkwZWympl7NVjE`
- `GCP_PROJECT_NUMBER` — `504861672126`
- `GCP_SERVICE_ACCOUNT_EMAIL` — `smart-portfolio-api@mcu-kalasin-smart-portfolio.iam.gserviceaccount.com`
- `GCP_WORKLOAD_IDENTITY_POOL_ID` — `vercel`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` — `vercel`

ไม่ต้องตั้ง `GOOGLE_PRIVATE_KEY` หรืออัปโหลดไฟล์ JSON ใด ๆ

## Vercel OIDC

ใน Project > Settings > Security เปิด Secure backend access with OIDC federation และเลือก Issuer mode เป็น Team เพื่อให้ตรงกับ Google Provider issuer

## ตรวจระบบหลัง Redeploy

ส่ง POST ไป `/api/portfolio` ด้วย body `{"action":"health"}` ควรได้ `ok: true` และ version `2.1.0`

ระบบจะอนุญาตให้เข้าสู่ระบบเฉพาะอีเมลที่ตรงกับแท็บ `Users` และมีสถานะ `ACTIVE`
