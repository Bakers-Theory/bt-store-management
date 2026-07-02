"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { CURRENCIES } from "@/lib/constants";
import { exportExcelReport } from "@/lib/excel";
import { MyAccount } from "./MyAccount";
import { UserManagement } from "./UserManagement";

export function Settings() {
  const router = useRouter();
  const user = useCurrentUser();
  const bakery = useBakeryStore((s) => s.bakery);
  const saveSettings = useBakeryStore((s) => s.saveSettings);
  const uploadLogo = useBakeryStore((s) => s.uploadLogo);
  const removeLogo = useBakeryStore((s) => s.removeLogo);
  const clearAllData = useBakeryStore((s) => s.clearAllData);
  const toast = useUIStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(bakery.name);
  const [tagline, setTagline] = useState(bakery.tagline);
  const [address, setAddress] = useState(bakery.address);
  const [phone, setPhone] = useState(bakery.phone);
  const [gst, setGst] = useState(bakery.gst);
  const [currency, setCurrency] = useState(bakery.currency);
  const [taxRate, setTaxRate] = useState(String(bakery.taxRate));
  const [lowStockAlert, setLowStockAlert] = useState(String(bakery.lowStockAlert));

  // Non-owners get the account view.
  if (user && user.role !== "Owner") return <MyAccount />;

  const onLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => uploadLogo(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const save = () => {
    saveSettings({
      name: name.trim(),
      tagline: tagline.trim(),
      address: address.trim(),
      phone: phone.trim(),
      gst: gst.trim(),
      currency,
      taxRate: parseFloat(taxRate) || 0,
      lowStockAlert: parseInt(lowStockAlert) || 5,
    });
    toast("✅ Settings saved");
    router.push("/dashboard");
  };

  const doExport = async () => {
    const { bakery, items, bills, logs } = useBakeryStore.getState();
    const r = await exportExcelReport({ bakery, items, bills, logs });
    toast(r.ok ? "📊 Excel report downloaded" : r.error ?? "Export failed");
  };

  const clearData = () => {
    if (!confirm("This will delete all items, bills, and history. Are you sure?")) return;
    if (!confirm("Last chance — really delete everything?")) return;
    clearAllData();
    toast("🗑 All data cleared");
    router.push("/dashboard");
  };

  return (
    <>
      <div className="card">
        <h3 className="mb-3.5">🏪 Bakery Profile</h3>
        <div className="form-group text-center">
          <label className="form-label">Bakery Logo</label>
          <div
            className="cursor-pointer rounded-xl border-2 border-dashed border-line-strong bg-cream p-5 text-center transition-colors hover:border-brown"
            onClick={() => fileRef.current?.click()}
          >
            {bakery.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bakery.logo} className="mx-auto mb-2 block h-20 w-20 rounded-xl object-cover" alt="logo" />
            ) : (
              <div className="mb-2 text-5xl">🧁</div>
            )}
            <div className="text-[13px] text-ink-muted">Tap to upload logo</div>
            <div className="mt-1 text-[11px] text-ink-light">Appears on bills &amp; receipt</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
          {bakery.logo && (
            <button className="btn-sm btn-secondary mt-2" onClick={() => removeLogo()}>✕ Remove Logo</button>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Bakery Name *</label>
          <input type="text" value={name} placeholder="Your Bakery Name" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Tagline</label>
          <input type="text" value={tagline} placeholder="Fresh & Delicious" onChange={(e) => setTagline(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input type="tel" value={phone} placeholder="9876543210" onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">GST Number</label>
            <input type="text" value={gst} placeholder="Optional" onChange={(e) => setGst(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3.5">⚙ App Settings</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Currency Symbol</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Tax Rate (%)</label>
            <input type="number" min="0" max="100" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Low Stock Alert (qty below)</label>
          <input type="number" min="0" value={lowStockAlert} onChange={(e) => setLowStockAlert(e.target.value)} />
        </div>
      </div>

      <button className="btn-primary w-full p-3.5 text-base" onClick={save}>
        💾 Save Settings
      </button>

      <div className="card mt-4">
        <h3 className="mb-1.5">📊 Reports</h3>
        <p className="mb-3 text-xs text-ink-muted">
          Download a full Excel workbook with your inventory, sales, stock log and business growth analysis.
        </p>
        <button className="btn-success w-full p-3 text-sm" onClick={doExport}>
          ⬇ Download Excel Report
        </button>
      </div>

      <UserManagement />

      <div className="card mt-4">
        <h3 className="mb-2.5 text-danger">⚠ Danger Zone</h3>
        <button className="btn-danger btn-sm w-full" onClick={clearData}>🗑 Clear All Data</button>
      </div>

      <div className="p-5 text-center text-xs text-ink-light">
        Bakers Theory v2.0
        <br />
        Runs locally on your device
      </div>
    </>
  );
}
