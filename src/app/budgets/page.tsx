"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/money/app-shell";
import { CategoryIcon } from "@/components/money/category-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError, type BudgetStatus, type Category, formatBaht } from "@/lib/api";
import { cn } from "@/lib/utils";

// สีแถบความคืบหน้าตามสถานะงบ
const BAR: Record<string, string> = { green: "bg-brand", yellow: "bg-amber-500", red: "bg-destructive" };

function BudgetsView() {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // โหลดงบของเดือนนี้ + หมวดรายจ่าย (ไว้เลือกตั้งงบ)
  async function reload() {
    const [s, cats] = await Promise.all([
      api<BudgetStatus>("/api/budgets"),
      api<Category[]>("/api/categories"),
    ]);
    setStatus(s);
    setCategories(cats.filter((c) => c.kind === "expense"));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, cats] = await Promise.all([
          api<BudgetStatus>("/api/budgets"),
          api<Category[]>("/api/categories"),
        ]);
        if (!alive) return;
        setStatus(s);
        setCategories(cats.filter((c) => c.kind === "expense"));
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "โหลดไม่สำเร็จ");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setError("");
    const value = Number(amount);
    if (!category) return setError("เลือกหมวดก่อน");
    if (!Number.isFinite(value) || value <= 0) return setError("ใส่จำนวนงบมากกว่า 0");
    setSaving(true);
    try {
      await api("/api/budgets", { method: "PUT", body: { category, amount: value } });
      setAmount("");
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function remove(categoryId: string) {
    setError("");
    try {
      await api(`/api/budgets/${encodeURIComponent(categoryId)}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-5">
      {/* ฟอร์มตั้ง/แก้งบ */}
      <Card>
        <CardHeader>
          <CardTitle>ตั้งงบประมาณต่อเดือน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label>หมวดรายจ่าย</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกหมวด" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>งบต่อเดือน (บาท)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                placeholder="5000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก…" : "ตั้งงบ"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">ตั้งซ้ำหมวดเดิมจะเป็นการแก้ค่าเดิม</p>
        </CardContent>
      </Card>

      {/* สรุปรวม */}
      {status && status.items.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">งบรวมเดือนนี้</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatBaht(status.totalBudgetSatang)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">ใช้ไปแล้ว</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  status.totalSpentSatang > status.totalBudgetSatang && "text-destructive",
                )}
              >
                {formatBaht(status.totalSpentSatang)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* รายการงบต่อหมวด */}
      <Card>
        <CardHeader>
          <CardTitle>งบแต่ละหมวด</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status ? (
            <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
          ) : status.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่ได้ตั้งงบหมวดไหนเลย ลองตั้งด้านบน</p>
          ) : (
            status.items.map((b) => (
              <div key={b.categoryId} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <CategoryIcon name={b.icon} className="size-4 text-muted-foreground" />
                  <span className="flex-1">{b.categoryName}</span>
                  <span className="tabular-nums">
                    {formatBaht(b.spentSatang)} / {formatBaht(b.budgetSatang)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => remove(b.categoryId)}
                    aria-label={`ลบงบ ${b.categoryName}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", BAR[b.status])}
                    style={{ width: `${Math.min(b.percent, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{b.percent}% ของงบ</span>
                  <span className={cn(b.remainingSatang < 0 && "text-destructive")}>
                    {b.remainingSatang < 0 ? `เกินงบ ${formatBaht(-b.remainingSatang)}` : `เหลือ ${formatBaht(b.remainingSatang)}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <BudgetsView />
    </AppShell>
  );
}
