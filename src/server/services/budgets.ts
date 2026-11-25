// service layer: งบประมาณต่อหมวด (ใช้ซ้ำทุกเดือน)
// หน้าเว็บ (API) และ MCP เรียกฟังก์ชันชุดนี้ชุดเดียวกัน
// เงินเก็บเป็นสตางค์ (เหมือน transactions) วันที่/เดือนเป็นเวลาไทย

import { type Db, newId, nowIso } from "../db";
import { satangToBaht } from "../money";
import { type Category, listCategories, ServiceError } from "./transactions";

// งบของ 1 หมวด
export interface Budget {
  categoryId: string;
  categoryName: string;
  icon: string;
  amountSatang: number;
  amount: number; // บาท
}

// สถานะงบของหมวด เทียบกับยอดใช้จริงในเดือนนั้น
export type BudgetState = "green" | "yellow" | "red"; // <80% / 80–100% / >100%

export interface BudgetStatusItem {
  categoryId: string;
  categoryName: string;
  icon: string;
  budgetSatang: number;
  budget: number; // บาท
  spentSatang: number;
  spent: number; // บาท
  remainingSatang: number; // ติดลบได้ถ้าเกินงบ
  remaining: number; // บาท
  percent: number; // ใช้ไปกี่ % ของงบ (ปัดเป็นจำนวนเต็ม)
  status: BudgetState;
}

export interface BudgetStatus {
  month: string; // YYYY-MM
  items: BudgetStatusItem[];
  totalBudgetSatang: number;
  totalSpentSatang: number;
  totalBudget: number; // บาท
  totalSpent: number; // บาท
}

// หาหมวด "รายจ่าย" จาก id หรือชื่อ (ไม่สนตัวพิมพ์ใหญ่เล็ก)
function findExpenseCategory(categories: Category[], ref: string): Category | undefined {
  const key = ref.trim().toLowerCase();
  const pool = categories.filter((c) => c.kind === "expense");
  return pool.find((c) => c.id === ref) ?? pool.find((c) => c.name.toLowerCase() === key);
}

interface BudgetRow {
  category_id: string;
  name: string;
  icon: string;
  amount_satang: number;
}

const SELECT_BUDGET = `SELECT b.category_id, c.name, c.icon, b.amount_satang
  FROM budgets b JOIN categories c ON c.id = b.category_id
  WHERE b.user_id = ?`;

function toBudget(r: BudgetRow): Budget {
  return {
    categoryId: r.category_id,
    categoryName: r.name,
    icon: r.icon,
    amountSatang: r.amount_satang,
    amount: satangToBaht(r.amount_satang),
  };
}

export interface SetBudgetInput {
  category: string; // id หรือชื่อหมวดรายจ่าย
  amountSatang: number; // งบต่อเดือน (> 0)
}

// ตั้ง/แก้งบของหมวด (upsert: หมวดเดิมจะทับค่าใหม่ ไม่สร้างซ้ำ)
export async function setBudget(db: Db, userId: string, input: SetBudgetInput): Promise<Budget> {
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0) {
    throw new ServiceError("invalid_input", "งบต้องมากกว่า 0");
  }
  const cat = findExpenseCategory(await listCategories(db, userId), input.category);
  if (!cat) throw new ServiceError("invalid_input", `ไม่พบหมวดรายจ่าย "${input.category}"`);
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO budgets (id, user_id, category_id, amount_satang, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, category_id)
       DO UPDATE SET amount_satang = excluded.amount_satang, updated_at = excluded.updated_at`,
    )
    .bind(newId(), userId, cat.id, input.amountSatang, now, now)
    .run();
  const row = await db.prepare(`${SELECT_BUDGET} AND b.category_id = ?`).bind(userId, cat.id).first<BudgetRow>();
  if (!row) throw new ServiceError("not_found", "บันทึกงบไม่สำเร็จ");
  return toBudget(row);
}

// ลบงบของหมวด
export async function removeBudget(db: Db, userId: string, category: string): Promise<void> {
  const cat = findExpenseCategory(await listCategories(db, userId), category);
  if (!cat) throw new ServiceError("invalid_input", `ไม่พบหมวดรายจ่าย "${category}"`);
  const existing = await db
    .prepare("SELECT id FROM budgets WHERE user_id = ? AND category_id = ?")
    .bind(userId, cat.id)
    .first<{ id: string }>();
  if (!existing) throw new ServiceError("not_found", "หมวดนี้ยังไม่ได้ตั้งงบ");
  await db.prepare("DELETE FROM budgets WHERE user_id = ? AND category_id = ?").bind(userId, cat.id).run();
}

// งบทั้งหมด
export async function listBudgets(db: Db, userId: string): Promise<Budget[]> {
  const { results } = await db
    .prepare(`${SELECT_BUDGET} ORDER BY c.sort, c.name`)
    .bind(userId)
    .all<BudgetRow>();
  return results.map(toBudget);
}

// ตรวจรูปแบบเดือน YYYY-MM (01–12)
function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ServiceError("invalid_input", `เดือนไม่ถูกต้อง: ${month} (ต้องเป็น YYYY-MM)`);
  }
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function stateOf(percent: number): BudgetState {
  if (percent < 80) return "green";
  if (percent <= 100) return "yellow";
  return "red";
}

// งบ + ยอดใช้จริงของเดือนนั้น + สถานะสีต่อหมวด
export async function getBudgetStatus(db: Db, userId: string, month: string): Promise<BudgetStatus> {
  const { from, to } = monthRange(month);
  const budgets = await listBudgets(db, userId);

  // ยอดรายจ่ายจริงต่อหมวดในเดือนนั้น (ไม่รวมที่ลบแล้ว)
  const { results: spentRows } = await db
    .prepare(
      `SELECT category_id, SUM(amount_satang) AS total
       FROM transactions
       WHERE user_id = ? AND kind = 'expense' AND deleted_at IS NULL
         AND occurred_on >= ? AND occurred_on <= ?
       GROUP BY category_id`,
    )
    .bind(userId, from, to)
    .all<{ category_id: string | null; total: number }>();
  const spentByCat = new Map<string, number>();
  for (const r of spentRows) if (r.category_id) spentByCat.set(r.category_id, r.total);

  let totalBudgetSatang = 0;
  let totalSpentSatang = 0;
  const items: BudgetStatusItem[] = budgets.map((b) => {
    const spentSatang = spentByCat.get(b.categoryId) ?? 0;
    const remainingSatang = b.amountSatang - spentSatang;
    const percent = Math.round((spentSatang / b.amountSatang) * 100);
    totalBudgetSatang += b.amountSatang;
    totalSpentSatang += spentSatang;
    return {
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      icon: b.icon,
      budgetSatang: b.amountSatang,
      budget: b.amount,
      spentSatang,
      spent: satangToBaht(spentSatang),
      remainingSatang,
      remaining: satangToBaht(remainingSatang),
      percent,
      status: stateOf(percent),
    };
  });

  return {
    month,
    items,
    totalBudgetSatang,
    totalSpentSatang,
    totalBudget: satangToBaht(totalBudgetSatang),
    totalSpent: satangToBaht(totalSpentSatang),
  };
}
