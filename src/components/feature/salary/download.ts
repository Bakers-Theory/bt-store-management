/**
 * Trigger a client-side file download without leaving the page.
 * Shared by the attendance and salary exports.
 */
export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8;` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
