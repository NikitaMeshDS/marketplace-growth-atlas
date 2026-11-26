export const defaultFloor = 2000;
export const floors = [0, 1000, defaultFloor, 3000];
const floorByText = new Map(floors.map(value => [String(value), value]));

export function decodeRoute(hash, regions) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const tab = params.get("section");
  const region = params.get("region");
  const candidate = params.get("candidate");
  return {
    tab: tab === "pilot" || tab === "review" ? tab : "atlas",
    region: regions.includes(region) ? region : "",
    floor: floorByText.get(params.get("floor")) ?? defaultFloor,
    selectedId: /^\d+$/.test(candidate ?? "") ? candidate : null,
    reviewFloor: floorByText.get(params.get("review-floor")) ?? defaultFloor,
    reviewCohort: params.get("cohort") === "common" ? "common" : "all",
  };
}

export function encodeRoute({ tab, region, floor, selectedId, reviewFloor, reviewCohort }) {
  const params = new URLSearchParams();
  if (tab !== "atlas") params.set("section", tab);
  if (region) params.set("region", region);
  if (floor !== defaultFloor) params.set("floor", floor);
  if (selectedId) params.set("candidate", selectedId);
  if (reviewFloor !== defaultFloor) params.set("review-floor", reviewFloor);
  if (reviewCohort === "common") params.set("cohort", reviewCohort);
  return params.size ? "#" + params : "";
}
