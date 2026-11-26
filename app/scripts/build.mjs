import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import { parse } from "csv-parse/sync";
import { feature } from "topojson-client";

const app = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(app, "..");
const draft = path.join(root, "demo.html.tmp");

async function table(file) {
  return parse(await readFile(path.join(root, "evidence", file), "utf8"), {
    columns: true, skip_empty_lines: true, bom: true,
  });
}

const [candidates, history, comparisons, benchmark, regional, regionalCoverage] = await Promise.all([
  table("pilot-candidates.csv"), table("shortlist.csv"), table("floor-comparison.csv"),
  table("backtest.csv"), table("regional-floor-comparison.csv"), table("regional-coverage.csv"),
]);
const atlas = JSON.parse(await readFile(path.join(app, "node_modules/world-atlas/countries-110m.json"), "utf8"));
const countries = feature(atlas, atlas.objects.countries).features;
const outline = countries.find(country => country.properties.name === "Russia");
if (!outline) throw new Error("Natural Earth basemap does not have a matching feature");

const number = value => value === "" ? null : Number(value);
const data = {
  candidates: candidates.map(row => ({
    id: row.territory_id, name: row.name, region: row.region_name, center: row.center,
    lat: number(row.lat), lon: number(row.lon), base: number(row.year_ago),
    last: number(row.rank_signal), score: number(row.score),
  })),
  history,
  comparisons,
  regional,
  reviewedRegions: new Set(regionalCoverage.filter(row => row.status === "compared").map(row => row.region)).size,
  benchmark: benchmark.filter(row => row.lag === "1" && row.target === "2024-12"),
  outline: outline.geometry.coordinates,
};

const result = await esbuild.build({
  entryPoints: ["src/main.jsx"],
  absWorkingDir: app,
  outdir: "_bundle",
  bundle: true,
  minify: true,
  target: "es2022",
  write: false,
  loader: { ".woff": "dataurl", ".woff2": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "atlas-evidence",
    setup(build) {
      build.onResolve({ filter: /^atlas-evidence$/ }, () => ({ path: "atlas-evidence", namespace: "evidence" }));
      build.onLoad({ filter: /.*/, namespace: "evidence" }, () => ({
        contents: JSON.stringify(data), loader: "json",
      }));
    },
  }],
});
const script = result.outputFiles.find(file => file.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const style = result.outputFiles.find(file => file.path.endsWith(".css")).text;
const template = await readFile(path.join(app, "index.html"), "utf8");
const notices = await Promise.all(["react", "react-dom", "lucide-react", "@fontsource-variable/manrope"].map(async dependency => {
  const license = await readFile(path.join(app, "node_modules", dependency, "LICENSE"), "utf8");
  return `${dependency}\n${license}`;
}));
const attribution = `<!-- Distributed components\n${notices.join("\n\n").replaceAll("--", "—")}\n-->\n`;
const html = template.replace("/* ATLAS_CSS */", () => style).replace("/* ATLAS_JS */", () => script)
  .replace("</body>", () => attribution + "</body>");
await writeFile(draft, html);
await rename(draft, path.join(root, "demo.html"));
console.log("Собран автономный demo.html");
