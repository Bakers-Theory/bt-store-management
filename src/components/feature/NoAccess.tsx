export function NoAccess() {
  return (
    <div className="px-5 py-[60px] text-center text-ink-muted">
      <div className="mb-3 text-5xl">🔒</div>
      <h3 className="mb-2">No Access Granted</h3>
      <p className="text-sm">
        Your account doesn&apos;t have access to any section yet.
        <br />
        Please contact the bakery owner to grant you access.
      </p>
    </div>
  );
}
