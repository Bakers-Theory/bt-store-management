"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import {
  PERMISSION_CATALOG,
  PRESET_ROLES,
  ROLE_PRESETS,
  presetForPerms,
} from "@/lib/permissions";
import type { PermissionKey, PresetRole, User } from "@/lib/types";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const sameSet = (a: PermissionKey[], b: PermissionKey[]) =>
  a.length === b.length && a.every((k) => b.includes(k));

export function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null; // null = add
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useUIStore((s) => s.toast);

  const [name, setName] = useState(user?.name ?? "");
  const [uidField, setUidField] = useState(user?.userId ?? "");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<PermissionKey[]>(user?.permissions ?? []);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // The badge is derived, so picking a preset and then editing a box downgrades
  // to "Custom" on its own — there is no separate role field to keep in sync.
  const activePreset = presetForPerms(perms);

  const applyPreset = (role: PresetRole) => setPerms([...ROLE_PRESETS[role]]);

  const toggle = (key: PermissionKey) =>
    setPerms((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const toggleGroup = (keys: PermissionKey[], on: boolean) =>
    setPerms((prev) =>
      on
        ? [...prev, ...keys.filter((k) => !prev.includes(k))]
        : prev.filter((k) => !keys.includes(k)),
    );

  const save = async () => {
    if (!name.trim() || (!user && !uidField.trim())) {
      setErr("Name and User ID are required.");
      return;
    }
    if (!user && !password) {
      setErr("Set a password for the new staff member.");
      return;
    }
    setBusy(true);
    setErr("");

    const res = user
      ? await fetch("/api/staff", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: user.id,
            name: name.trim(),
            permissions: perms,
            password: password || undefined,
          }),
        })
      : await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: uidField.trim(),
            name: name.trim(),
            password,
            permissions: perms,
          }),
        });

    const body = await res.json();
    if (!res.ok) {
      setErr(body.error ?? "Could not save user");
      setBusy(false);
      return;
    }
    toast(user ? "User updated" : "User created", "success");
    onSaved();
    onClose();
  };

  const canSave = user
    ? name.trim().length > 0 &&
      (name.trim() !== user.name ||
        password.length > 0 ||
        !sameSet(perms, user.permissions))
    : name.trim().length > 0 && uidField.trim().length > 0 && password.length > 0;

  return (
    <Modal title={user ? "Edit staff" : "Add staff"} onClose={onClose}>
      <div className="mb-3.5">
        <label className={labelCls}>Full name *</label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. Ramesh Sharma"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>User ID *</label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. phone number or username"
          value={uidField}
          disabled={!!user}
          onChange={(e) => setUidField(e.target.value)}
        />
        {user && (
          <div className="mt-1 text-[11px] text-ink-light">
            User ID can&apos;t be changed after creation.
          </div>
        )}
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>{user ? "Reset password (optional)" : "Password *"}</label>
        <input
          type="text"
          className={inputCls}
          placeholder={user ? "Leave blank to keep current" : "Set a password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="mb-3.5">
        <label className={labelCls}>Role</label>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_ROLES.map((role) => {
            const on = activePreset === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => applyPreset(role)}
                aria-pressed={on}
                className={`rounded-[9px] px-3 py-[7px] text-[12.5px] font-bold transition-colors ${
                  on
                    ? "bg-brown text-warm-white"
                    : "border border-line bg-warm-white text-ink-muted"
                }`}
              >
                {role}
              </button>
            );
          })}
          <span
            className={`inline-flex items-center rounded-[9px] px-3 py-[7px] text-[12.5px] font-bold ${
              activePreset === "Custom"
                ? "bg-[#f4e7d2] text-[#8a6a3c]"
                : "text-ink-light"
            }`}
          >
            {activePreset === "Custom" ? "Custom" : `${perms.length} permissions`}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-ink-light">
          Pick a role to fill in the permissions below, then adjust any of them.
        </div>
      </div>

      <div className="mb-3.5">
        <label className={labelCls}>Permissions</label>
        <div className="mt-1.5 flex flex-col gap-3.5">
          {PERMISSION_CATALOG.map((group) => {
            const keys = group.perms.map((p) => p.key);
            const allOn = keys.every((k) => perms.includes(k));
            return (
              <div key={group.title}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10.5px] font-bold tracking-[.09em] text-line-strong">
                    {group.title.toUpperCase()}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleGroup(keys, !allOn)}
                    className="text-[11.5px] font-bold text-brown"
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.perms.map((p) => (
                    <label
                      key={p.key}
                      title={p.hint}
                      className="flex items-start gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium"
                    >
                      <input
                        type="checkbox"
                        checked={perms.includes(p.key)}
                        onChange={() => toggle(p.key)}
                        className="mt-0.5 h-[18px] w-auto shrink-0 accent-brown"
                      />
                      <span className="min-w-0">
                        <span className="block leading-tight">{p.label}</span>
                        <span className="block text-[11px] font-normal leading-tight text-ink-light">
                          {p.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2.5 text-[11px] text-ink-light">
          Clearing all data and the store audit trail stay with the Owner and
          can&apos;t be granted.
        </div>
      </div>

      {err && <div className="mb-2.5 text-[13px] font-bold text-danger">{err}</div>}
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
        onClick={save}
        disabled={busy || !canSave}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Saving…" : user ? "Save changes" : "Create staff"}
      </button>
    </Modal>
  );
}
