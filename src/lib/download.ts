/** Saves text as a file from the browser. Nothing is sent anywhere: the file is built in memory. */
export function downloadTextFile(fileName: string, text: string, mime = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
