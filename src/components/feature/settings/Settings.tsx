"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Croissant, Download, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { CURRENCIES } from "@/lib/constants";
import { exportExcelReport } from "@/lib/excel";
import { MyAccount } from "./MyAccount";
import { UserManagement } from "./UserManagement";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

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
    reader.onload = (ev) => void uploadLogo(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    await saveSettings({
      name: name.trim(),
      tagline: tagline.trim(),
      address: address.trim(),
      phone: phone.trim(),
      gst: gst.trim(),
      currency,
      taxRate: parseFloat(taxRate) || 0,
      lowStockAlert: parseInt(lowStockAlert) || 5,
    });
    toast("Settings saved");
    router.push("/dashboard");
  };

  const doExport = async () => {
    const { bakery, items, bills, logs } = useBakeryStore.getState();
    const r = await exportExcelReport({ bakery, items, bills, logs });
    toast(r.ok ? "Excel report downloaded" : r.error ?? "Export failed");
  };

  const clearData = async () => {
    if (!confirm("This will delete all items, bills, and history. Are you sure?")) return;
    if (!confirm("Last chance — really delete everything?")) return;
    await clearAllData();
    toast("All data cleared");
    router.push("/dashboard");
  };

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Bakery profile */}
        <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          <h3 className="mb-4 text-[15.5px] font-extrabold">Bakery profile</h3>

          <div className="mb-3.5 text-center">
            <div
              className="cursor-pointer rounded-xl border-2 border-dashed border-line-strong bg-cream p-5 text-center transition-colors hover:border-brown"
              onClick={() => fileRef.current?.click()}
            >
              {bakery.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bakery.logo} className="mx-auto mb-2 block h-20 w-20 rounded-xl object-cover" alt="logo" />
              ) : (
                <div className="mb-2 flex justify-center">
                  <Croissant size={48} />
                </div>
              )}
              <div className="text-[13px] text-ink-muted">Tap to upload logo</div>
              <div className="mt-1 text-[11px] text-ink-light">Appears on bills &amp; receipt</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
            {bakery.logo && (
              <button
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-danger"
                onClick={() => removeLogo()}
              >
                <X size={16} /> Remove logo
              </button>
            )}
          </div>

          <div className="flex flex-col gap-[13px]">
            <div>
              <label className={labelCls}>Bakery name</label>
              <input
                type="text"
                className={inputCls}
                value={name}
                placeholder="Your Bakery Name"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Tagline</label>
              <input
                type="text"
                className={inputCls}
                value={tagline}
                placeholder="Fresh & Delicious"
                onChange={(e) => setTagline(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Address</label>
              <textarea rows={2} className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  type="tel"
                  className={inputCls}
                  value={phone}
                  placeholder="9876543210"
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>GST number</label>
                <input
                  type="text"
                  className={inputCls}
                  value={gst}
                  placeholder="Optional"
                  onChange={(e) => setGst(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Currency</label>
                <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tax rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  className={inputCls}
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Low-stock alert threshold</label>
              <input
                type="number"
                min="0"
                className={inputCls}
                value={lowStockAlert}
                onChange={(e) => setLowStockAlert(e.target.value)}
              />
            </div>
            <button
              onClick={save}
              className="mt-1.5 w-full rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white"
            >
              Save changes
            </button>
          </div>
        </div>

        {/* Staff & permissions */}
        <UserManagement />
      </div>

      <div className="mt-4 rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <h3 className="mb-1.5 text-[15.5px] font-extrabold">Reports</h3>
        <p className="mb-3 text-xs text-ink-muted">
          Download a full Excel workbook with your inventory, sales, stock log and business growth analysis.
        </p>
        <button
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white"
          onClick={doExport}
        >
          <Download size={16} /> Download Excel report
        </button>
      </div>

      <div className="mt-4 rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <h3 className="mb-2.5 text-[15.5px] font-extrabold text-danger">Danger zone</h3>
        <button
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-danger p-2.5 text-sm font-bold text-warm-white"
          onClick={clearData}
        >
          <Trash2 size={16} /> Clear all data
        </button>
      </div>

      <div className="p-5 text-center text-xs text-ink-light">
        Bakers Theory v0.1
        <br />
        Runs locally on your device
      </div>
    </>
  );
}
