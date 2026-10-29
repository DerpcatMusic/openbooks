/** Save text as a CSV file (UTF-8 with a BOM so Excel reads Hebrew); name without the extension. */
export function saveCsv(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, "-")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
