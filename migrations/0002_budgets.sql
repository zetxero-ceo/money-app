-- งบประมาณต่อหมวด (ใช้ซ้ำทุกเดือน) เฉพาะหมวดรายจ่าย
-- 1 หมวด = 1 งบ (ตั้งซ้ำหมวดเดิมจะเป็นการแก้ค่าเดิม ไม่สร้างใหม่)
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),  -- งบต่อเดือน (เก็บเป็นสตางค์)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, category_id)
);
