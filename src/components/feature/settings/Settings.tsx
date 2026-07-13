"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Croissant, Loader2, Trash2, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { MyAccount } from "./MyAccount";
import { UserManagement } from "./UserManagement";
import { ChangePasswordCard } from "./ChangePasswordCard";
import { ListManager } from "./ListManager";
import { tabCls } from "@/components/ui/tabClass";

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
  const [taxRate, setTaxRate] = useState(String(bakery.taxRate));
  const [lowStockAlert, setLowStockAlert] = useState(String(bakery.lowStockAlert));
  const [expiringSoonDays, setExpiringSoonDays] = useState(String(bakery.expiringSoonDays));
  const [tab, setTab] = useState<"store" | "staff">("store");
  const [phoneErr, setPhoneErr] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Non-owners get the account view.
  if (user && user.role !== "Owner") return <MyAccount />;

  const dirty =
    name !== bakery.name ||
    tagline !== bakery.tagline ||
    address !== bakery.address ||
    phone !== bakery.phone ||
    gst !== bakery.gst ||
    taxRate !== String(bakery.taxRate) ||
    lowStockAlert !== String(bakery.lowStockAlert) ||
    expiringSoonDays !== String(bakery.expiringSoonDays);

  const onLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => void uploadLogo(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (phone && phone.length !== 10) {
      setPhoneErr("Phone number must be exactly 10 digits");
      return;
    }
    setSavingSettings(true);
    try {
      await saveSettings({
        name: name.trim(),
        tagline: tagline.trim(),
        address: address.trim(),
        phone: phone.trim(),
        gst: gst.trim(),
        currency: "₹",
        taxRate: parseFloat(taxRate) || 0,
        lowStockAlert: parseInt(lowStockAlert) || 5,
        expiringSoonDays: parseInt(expiringSoonDays) || 3,
      });
      toast("Settings saved");
    } finally {
      setSavingSettings(false);
    }
  };

  const clearData = async () => {
    if (!confirm("This will delete all items, bills, and history. Are you sure?")) return;
    if (!confirm("Last chance — really delete everything?")) return;
    setClearing(true);
    try {
      await clearAllData();
      toast("All data cleared");
      router.push("/dashboard");
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex w-fit gap-1.5 rounded-xl bg-[#f4e7d2] p-1">
        <button className={tabCls(tab === "store")} onClick={() => setTab("store")}>
          Store
        </button>
        <button className={tabCls(tab === "staff")} onClick={() => setTab("staff")}>
          Staff &amp; data
        </button>
      </div>

      {tab === "store" && (
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
                  inputMode="numeric"
                  maxLength={10}
                  className={inputCls}
                  value={phone}
                  placeholder="9876543210"
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setPhoneErr("");
                  }}
                  onBlur={() =>
                    setPhoneErr(
                      phone && phone.length !== 10
                        ? "Phone number must be exactly 10 digits"
                        : "",
                    )
                  }
                />
                {phoneErr && (
                  <div className="mt-1 text-[11px] font-semibold text-danger">{phoneErr}</div>
                )}
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
              <div>
                <label className={labelCls}>Expiring-soon window (days)</label>
                <input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={expiringSoonDays}
                  onChange={(e) => setExpiringSoonDays(e.target.value)}
                />
              </div>
            </div>
            <button
              onClick={save}
              disabled={savingSettings || !dirty}
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingSettings && <Loader2 size={16} className="animate-spin" />}
              {savingSettings ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {/* Item options */}
        <ListManager />
      </div>
      )}

      {tab === "staff" && (
        <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Staff & permissions */}
        <UserManagement />
        <div className="flex flex-col gap-4">
          <ChangePasswordCard />

          {/* Danger zone */}
          <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
            <h3 className="mb-1.5 text-[15.5px] font-extrabold text-danger">Danger zone</h3>
            <p className="mb-3 text-xs text-ink-muted">
              Permanently delete all items, bills and stock history. This cannot be undone.
            </p>
            <button
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-danger p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={clearData}
              disabled={clearing}
            >
              {clearing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}{" "}
              {clearing ? "Clearing…" : "Clear all data"}
            </button>
          </div>
        </div>
      </div>
        </>
      )}

      <div className="p-5 text-center text-xs text-ink-light">
        © Baker&apos;s Theory 2026
      </div>
    </>
  );
}
