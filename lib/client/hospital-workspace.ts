export const SELECTED_HOSPITAL_STORAGE_KEY = "converge.activeHospitalId";

export function getSelectedHospitalId(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("hospitalId");
  return fromUrl || window.localStorage.getItem(SELECTED_HOSPITAL_STORAGE_KEY) || "";
}

export function hospitalApiUrl(path: string): string {
  const hospitalId = getSelectedHospitalId();
  if (!hospitalId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}hospitalId=${encodeURIComponent(hospitalId)}`;
}
